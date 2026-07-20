// Nook — Rust core: window orchestration, focus timer, idle watch, settings,
// stats/gamification, and the companion's physical movement across the screen.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use chrono::{Days, Local, Timelike};
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Minutes of active focus before a break is due.
    pub focus_minutes: u64,
    /// Length of the break overlay countdown, in seconds.
    pub break_seconds: u64,
    /// System idle seconds before focus resets (counts as a rest).
    pub idle_seconds: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            focus_minutes: 50,
            break_seconds: 120,
            idle_seconds: 300,
        }
    }
}

impl Settings {
    fn clamp(mut self) -> Self {
        self.focus_minutes = self.focus_minutes.clamp(1, 240);
        self.break_seconds = self.break_seconds.clamp(30, 3600);
        self.idle_seconds = self.idle_seconds.clamp(60, 3600);
        self
    }
}

/* ─── Stats & gamification ─────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DayStats {
    pub taken: u32,
    pub skipped: u32,
    pub focus_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakEvent {
    /// RFC3339 local timestamp.
    pub at: String,
    pub skipped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub slug: String,
    pub unlocked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Keyed by local date "YYYY-MM-DD". Trimmed to the last ~45 days.
    pub days: BTreeMap<String, DayStats>,
    pub streak: u32,
    pub best_streak: u32,
    pub last_streak_day: Option<String>,
    pub achievements: Vec<Achievement>,
    /// Rolling break log (newest last), capped so the file stays small.
    pub recent: Vec<BreakEvent>,
}

fn today_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn yesterday_key() -> String {
    (Local::now().date_naive() - Days::new(1))
        .format("%Y-%m-%d")
        .to_string()
}

impl Stats {
    /// A streak is only alive if its last day is today or yesterday.
    fn normalize_streak(&mut self) {
        let alive = matches!(
            self.last_streak_day.as_deref(),
            Some(d) if d == today_key() || d == yesterday_key()
        );
        if !alive {
            self.streak = 0;
        }
    }

    fn trim(&mut self) {
        while self.days.len() > 45 {
            let first = self.days.keys().next().cloned();
            match first {
                Some(k) => self.days.remove(&k),
                None => break,
            };
        }
        if self.recent.len() > 60 {
            let overflow = self.recent.len() - 60;
            self.recent.drain(0..overflow);
        }
    }
}

fn unlock(stats: &mut Stats, fresh: &mut Vec<&'static str>, slug: &'static str) {
    if stats.achievements.iter().any(|a| a.slug == slug) {
        return;
    }
    stats.achievements.push(Achievement {
        slug: slug.into(),
        unlocked_at: Local::now().to_rfc3339(),
    });
    fresh.push(slug);
}

/// Record a break outcome, update streaks, detect achievements, persist,
/// and broadcast the new stats. Returns freshly unlocked achievement slugs.
fn record_break(app: &AppHandle, skipped: bool) {
    let state = app.state::<AppState>();
    let (snapshot, fresh) = {
        let mut stats = state.stats.lock().unwrap();
        let now = Local::now();
        let today = today_key();

        let prev_was_skip = stats.recent.last().map(|e| e.skipped).unwrap_or(false);

        let (taken_today, skipped_today) = {
            let entry = stats.days.entry(today.clone()).or_default();
            if skipped {
                entry.skipped += 1;
            } else {
                entry.taken += 1;
            }
            (entry.taken, entry.skipped)
        };

        stats.recent.push(BreakEvent {
            at: now.to_rfc3339(),
            skipped,
        });

        let mut fresh: Vec<&'static str> = Vec::new();
        if !skipped {
            match stats.last_streak_day.as_deref() {
                Some(d) if d == today => {}
                Some(d) if d == yesterday_key() => {
                    stats.streak += 1;
                    stats.last_streak_day = Some(today.clone());
                }
                _ => {
                    stats.streak = 1;
                    stats.last_streak_day = Some(today.clone());
                }
            }
            stats.best_streak = stats.best_streak.max(stats.streak);

            let lifetime: u32 = stats.days.values().map(|d| d.taken).sum();
            let hour = now.hour();
            unlock(&mut stats, &mut fresh, "first-break");
            if taken_today >= 3 {
                unlock(&mut stats, &mut fresh, "daily-3");
            }
            if taken_today >= 3 && skipped_today == 0 {
                unlock(&mut stats, &mut fresh, "steady-day");
            }
            if stats.streak >= 3 {
                unlock(&mut stats, &mut fresh, "streak-3");
            }
            if stats.streak >= 7 {
                unlock(&mut stats, &mut fresh, "streak-7");
            }
            if stats.streak >= 14 {
                unlock(&mut stats, &mut fresh, "streak-14");
            }
            if hour < 9 {
                unlock(&mut stats, &mut fresh, "early-bird");
            }
            if hour >= 21 {
                unlock(&mut stats, &mut fresh, "night-owl");
            }
            if prev_was_skip {
                unlock(&mut stats, &mut fresh, "comeback");
            }
            if lifetime >= 50 {
                unlock(&mut stats, &mut fresh, "fifty");
            }
        }

        stats.normalize_streak();
        stats.trim();
        let _ = save_json(&state.stats_path, &*stats);
        (stats.clone(), fresh)
    };

    let _ = app.emit("nook://stats-changed", snapshot);
    for slug in fresh {
        let _ = app.emit("nook://achievement", slug);
    }
}

/* ─── Persistence helpers ──────────────────────────────────────────── */

fn config_file(app: &AppHandle, name: &str) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(name)
}

fn load_json<T: Default + for<'de> Deserialize<'de>>(path: &PathBuf) -> T {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<T>(&s).ok())
        .unwrap_or_default()
}

fn save_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/* ─── App state ────────────────────────────────────────────────────── */

/// Escalation ladder timeout: once a break is due, the companion asks first;
/// if the ask goes unanswered this long, the overlay opens on its own.
const BREAK_GRACE_SECONDS: u64 = 45;

/// Companion window sizes (logical px). Compact hosts the creature and a
/// small quip bubble; card mode grows to hold the break conversation card.
const COMPACT_W: f64 = 260.0;
const COMPACT_H: f64 = 240.0;
const CARD_W: f64 = 540.0;
const CARD_H: f64 = 480.0;

/// How far above the bottom-right corner Nook perches (logical px).
/// Keeps it clear of the dock while still below mid-screen.
const PERCH_BOTTOM_LIFT: f64 = 100.0;

/// Right edge, a short lift above the bottom corner — below the vertical middle.
fn preferred_perch(
    mon_x: i32,
    mon_y: i32,
    mon_w: u32,
    mon_h: u32,
    win_w: i32,
    win_h: i32,
    scale: f64,
) -> (i32, i32) {
    let lift = (PERCH_BOTTOM_LIFT * scale).round() as i32;
    let x = mon_x + mon_w as i32 - win_w;
    let y = mon_y + mon_h as i32 - win_h - lift;
    (x, y)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct CompanionPos {
    x: i32,
    y: i32,
}

struct AppState {
    settings: Arc<Mutex<Settings>>,
    settings_path: PathBuf,
    stats: Arc<Mutex<Stats>>,
    stats_path: PathBuf,
    companion_path: PathBuf,
    /// Where the companion lives when it isn't out on a walk (physical px).
    home_pos: Arc<Mutex<Option<(i32, i32)>>>,
    /// Active focus elapsed this cycle — shared so the UI can poll.
    focus_seconds: Arc<Mutex<u64>>,
    /// True while the break overlay is up; the focus clock freezes.
    break_open: Arc<AtomicBool>,
    /// True while a walk/glide thread is animating the companion window.
    walking: Arc<AtomicBool>,
    /// Set to abort an in-flight walk (e.g. the user grabbed the creature).
    walk_cancel: Arc<AtomicBool>,
}

/* ─── Settings commands ────────────────────────────────────────────── */

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn get_focus_seconds(state: State<'_, AppState>) -> u64 {
    *state.focus_seconds.lock().unwrap()
}

#[tauri::command]
fn get_stats(state: State<'_, AppState>) -> Stats {
    let mut stats = state.stats.lock().unwrap();
    stats.normalize_streak();
    stats.clone()
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let next = settings.clamp();
    save_json(&state.settings_path, &next)?;
    *state.settings.lock().unwrap() = next.clone();
    let _ = app.emit("nook://settings-changed", next.clone());
    Ok(next)
}

/* ─── Break windows ────────────────────────────────────────────────── */

fn open_break(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.break_open.store(true, Ordering::SeqCst);
    // The companion asked from mid-screen; get it out of the way so it never
    // overlaps the break overlay's breathing sphere / clock. We hide rather
    // than walk-home because the opaque overlay covers the walk anyway.
    state.walk_cancel.store(true, Ordering::SeqCst);
    if let Some(c) = app.get_webview_window("companion") {
        let _ = c.hide();
    }
    if app.get_webview_window("break").is_some() {
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "break", WebviewUrl::App("index.html".into()))
        .title("Break")
        .fullscreen(true)
        .decorations(false)
        .always_on_top(true)
        .build();
}

#[tauri::command]
fn open_break_window(app: AppHandle) {
    open_break(&app);
}

#[tauri::command]
fn close_break_window(app: AppHandle, state: State<'_, AppState>, skipped: bool) {
    if let Some(w) = app.get_webview_window("break") {
        let _ = w.close();
    }
    // Bring the companion back (hidden while the overlay was up) so its
    // celebrate/droop reaction plays before it strolls home.
    if let Some(c) = app.get_webview_window("companion") {
        let _ = c.show();
    }
    // Break resolved either way — restart the focus cycle.
    *state.focus_seconds.lock().unwrap() = 0;
    state.break_open.store(false, Ordering::SeqCst);
    record_break(&app, skipped);
    let event = if skipped {
        "nook://break-skipped"
    } else {
        "nook://break-done"
    };
    let _ = app.emit(event, ());
    // Let the reaction (celebrate / droop) play at center, then head home.
    send_companion_home(&app, 1400);
}

/// Skip straight from the conversation card — no overlay involved.
#[tauri::command]
fn skip_break(app: AppHandle, state: State<'_, AppState>) {
    *state.focus_seconds.lock().unwrap() = 0;
    record_break(&app, true);
    let _ = app.emit("nook://break-skipped", ());
    send_companion_home(&app, 1200);
}

/* ─── Companion window: spawn, drag-settle, walks ──────────────────── */

fn spawn_companion(app: &AppHandle) {
    let Ok(w) = WebviewWindowBuilder::new(app, "companion", WebviewUrl::App("index.html".into()))
        .title("Companion")
        .inner_size(COMPACT_W, COMPACT_H)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .build()
    else {
        return;
    };

    let state = app.state::<AppState>();
    let scale = w.scale_factor().unwrap_or(1.0);
    let (win_w, win_h) = ((COMPACT_W * scale) as i32, (COMPACT_H * scale) as i32);

    // Always perch lower-right: right edge, a short lift above the corner.
    let target = w.primary_monitor().ok().flatten().map(|mon| {
        let mp = mon.position();
        let ms = mon.size();
        preferred_perch(mp.x, mp.y, ms.width, ms.height, win_w, win_h, scale)
    });

    if let Some((x, y)) = target {
        let _ = w.set_position(PhysicalPosition::new(x, y));
        *state.home_pos.lock().unwrap() = Some((x, y));
        let _ = save_json(&state.companion_path, &CompanionPos { x, y });
    }
}

/// Swap the companion window between compact and card sizes, keeping its
/// bottom-center anchored so the creature doesn't jump on screen.
fn resize_companion(app: &AppHandle, card: bool) {
    let Some(w) = app.get_webview_window("companion") else {
        return;
    };
    let scale = w.scale_factor().unwrap_or(1.0);
    let (tw, th) = if card {
        (CARD_W, CARD_H)
    } else {
        (COMPACT_W, COMPACT_H)
    };
    let (tw_p, th_p) = ((tw * scale) as i32, (th * scale) as i32);
    let (pos, size) = match (w.outer_position(), w.outer_size()) {
        (Ok(p), Ok(s)) => (p, s),
        _ => return,
    };
    if size.width as i32 == tw_p && size.height as i32 == th_p {
        return;
    }
    let cx = pos.x + size.width as i32 / 2;
    let bottom = pos.y + size.height as i32;
    let mut nx = cx - tw_p / 2;
    let mut ny = bottom - th_p;
    if let Ok(Some(mon)) = w.current_monitor() {
        let mp = mon.position();
        let ms = mon.size();
        nx = nx.min(mp.x + ms.width as i32 - tw_p).max(mp.x);
        ny = ny.min(mp.y + ms.height as i32 - th_p).max(mp.y);
    }
    let _ = w.set_size(tauri::LogicalSize::new(tw, th));
    let _ = w.set_position(PhysicalPosition::new(nx, ny));
}

fn ease_in_out(t: f64) -> f64 {
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

/// Animate the companion window along the screen: to the middle of the
/// monitor ("summon") or back to its remembered perch ("home"). The window
/// itself hops gently along the path — the creature walks, not teleports.
fn walk_companion(app: &AppHandle, kind: &'static str) {
    let Some(w) = app.get_webview_window("companion") else {
        return;
    };
    let state = app.state::<AppState>();
    if state.walking.swap(true, Ordering::SeqCst) {
        return; // one walk at a time
    }
    state.walk_cancel.store(false, Ordering::SeqCst);
    let walking = state.walking.clone();
    let cancel = state.walk_cancel.clone();
    let home = state.home_pos.clone();
    let app = app.clone();

    thread::spawn(move || {
        let finish = |app: &AppHandle, walking: &AtomicBool, kind: &str| {
            walking.store(false, Ordering::SeqCst);
            let _ = app.emit("nook://walk-finished", kind);
        };

        let start = match w.outer_position() {
            Ok(p) => p,
            Err(_) => {
                finish(&app, &walking, kind);
                return;
            }
        };
        let scale = w.scale_factor().unwrap_or(1.0);

        let target: Option<(f64, f64)> = if kind == "summon" {
            match (w.current_monitor(), w.outer_size()) {
                (Ok(Some(mon)), Ok(size)) => {
                    let mp = mon.position();
                    let ms = mon.size();
                    Some((
                        mp.x as f64 + (ms.width as f64 - size.width as f64) / 2.0,
                        mp.y as f64 + ms.height as f64 * 0.42 - size.height as f64 / 2.0,
                    ))
                }
                _ => None,
            }
        } else {
            home.lock().unwrap().map(|(x, y)| (x as f64, y as f64))
        };

        let Some((tx, ty)) = target else {
            finish(&app, &walking, kind);
            return;
        };
        let (sx, sy) = (start.x as f64, start.y as f64);
        let dist = ((tx - sx).powi(2) + (ty - sy).powi(2)).sqrt();
        if dist < 6.0 * scale {
            if kind == "summon" {
                resize_companion(&app, true);
            }
            finish(&app, &walking, kind);
            return;
        }

        let ms_total = ((dist / (440.0 * scale)) * 1000.0).clamp(650.0, 2200.0);
        let dir = if tx >= sx { 1.0 } else { -1.0 };
        let _ = app.emit(
            "nook://walk",
            serde_json::json!({ "dir": dir, "ms": ms_total, "kind": kind }),
        );

        // A gentle step-bounce along the path — fewer hops on longer strolls so
        // the gait stays even instead of frantic.
        let hops = (dist / (130.0 * scale)).round().clamp(1.0, 9.0);
        // Time-based sampling: derive position from the real elapsed clock every
        // frame. A slow set_position then never accumulates lag or judder — the
        // motion stays locked to wall-time and simply resamples ahead after a
        // hitch, which is the difference between buttery and stuttery here.
        let started = Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                finish(&app, &walking, "cancelled");
                return;
            }
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            let t = (elapsed / ms_total).min(1.0);
            let e = ease_in_out(t);
            // Bounce eases off toward the end so the arrival is a soft settle.
            let bounce = (t * hops * std::f64::consts::PI).sin().abs();
            let hop = bounce * (1.0 - t * 0.4) * 6.0 * scale;
            let x = sx + (tx - sx) * e;
            let y = sy + (ty - sy) * e - hop;
            let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
            if t >= 1.0 {
                break;
            }
            thread::sleep(Duration::from_millis(8));
        }
        let _ = w.set_position(PhysicalPosition::new(tx.round() as i32, ty.round() as i32));
        if kind == "summon" {
            // Grow into the conversation card before the ask appears.
            resize_companion(&app, true);
        }
        finish(&app, &walking, kind);
    });
}

/// Shrink back to compact and stroll back to the remembered perch, after a
/// short beat so the reaction animation can land first.
fn send_companion_home(app: &AppHandle, delay_ms: u64) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(delay_ms));
        resize_companion(&app, false);
        walk_companion(&app, "home");
    });
}

/// The user grabbed the creature mid-walk — stop steering the window.
#[tauri::command]
fn cancel_companion_walk(state: State<'_, AppState>) {
    state.walk_cancel.store(true, Ordering::SeqCst);
}

/// Pins the companion to its lower-right perch (on launch and after a walk
/// home): right edge, a short lift above the bottom corner. Nook always lives
/// there — below mid-screen, clear of the dock.
#[tauri::command]
fn settle_companion(app: AppHandle, state: State<'_, AppState>) -> String {
    if state.walking.load(Ordering::SeqCst) {
        return "busy".into();
    }
    let Some(w) = app.get_webview_window("companion") else {
        return "right".into();
    };
    let (pos, size) = match (w.outer_position(), w.outer_size()) {
        (Ok(p), Ok(s)) => (p, s),
        _ => return "right".into(),
    };
    let scale = w.scale_factor().unwrap_or(1.0);

    let (mut x, mut y) = (pos.x, pos.y);
    let side = "right";
    if let Ok(Some(mon)) = w.current_monitor() {
        let mp = mon.position();
        let ms = mon.size();
        (x, y) = preferred_perch(
            mp.x,
            mp.y,
            ms.width,
            ms.height,
            size.width as i32,
            size.height as i32,
            scale,
        );
    }

    if x != pos.x || y != pos.y {
        // Soft eased glide into the snapped spot.
        let w2 = w.clone();
        let (fx, fy) = (x, y);
        let (ox, oy) = (pos.x as f64, pos.y as f64);
        thread::spawn(move || {
            const FRAMES: u32 = 11;
            for i in 1..=FRAMES {
                let t = f64::from(i) / f64::from(FRAMES);
                let e = 1.0 - (1.0 - t).powi(3);
                let _ = w2.set_position(PhysicalPosition::new(
                    (ox + (fx as f64 - ox) * e).round() as i32,
                    (oy + (fy as f64 - oy) * e).round() as i32,
                ));
                thread::sleep(Duration::from_millis(15));
            }
        });
    }

    *state.home_pos.lock().unwrap() = Some((x, y));
    let _ = save_json(&state.companion_path, &CompanionPos { x, y });

    // If a break ask was interrupted by the drag, re-open the card in place.
    let due = {
        let target = state.settings.lock().unwrap().focus_minutes.saturating_mul(60);
        *state.focus_seconds.lock().unwrap() >= target
            && !state.break_open.load(Ordering::SeqCst)
    };
    if due {
        resize_companion(&app, true);
    }

    side.into()
}

/* ─── Focus clock ──────────────────────────────────────────────────── */

fn read_idle_seconds() -> u64 {
    match user_idle::UserIdle::get_time() {
        Ok(t) => {
            let secs = t.as_seconds();
            // HIDIdleTime can return garbage on some macOS builds; treat
            // absurd values as "actively using the machine".
            if secs > 24 * 3600 {
                0
            } else {
                secs
            }
        }
        Err(_) => 0,
    }
}

fn spawn_focus_clock(app: AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.settings.clone();
    let focus_seconds = state.focus_seconds.clone();
    let break_open = state.break_open.clone();
    let stats = state.stats.clone();
    let stats_path = state.stats_path.clone();

    thread::spawn(move || {
        let mut was_idle = false;
        // Seconds the ask has gone unanswered; drives the escalation timeout.
        let mut due_for: u64 = 0;
        // Ticks of unsaved daily focus time; flushed periodically.
        let mut dirty_ticks: u32 = 0;
        loop {
            thread::sleep(Duration::from_secs(1));
            if break_open.load(Ordering::SeqCst) {
                due_for = 0;
                continue; // clock freezes while the overlay is up
            }
            let (focus_minutes, idle_threshold) = {
                let s = settings.lock().unwrap();
                (s.focus_minutes, s.idle_seconds)
            };

            let idle_secs = read_idle_seconds();
            let is_idle = idle_secs > idle_threshold;
            if is_idle && !was_idle {
                let _ = app.emit("nook://system-idle", ());
                // Wander home to nap instead of dozing off mid-room.
                send_companion_home(&app, 400);
            }
            if !is_idle && was_idle {
                let _ = app.emit("nook://system-active", ());
                *focus_seconds.lock().unwrap() = 0; // returning from idle counts as a rest
                due_for = 0;
            }
            was_idle = is_idle;

            let target = focus_minutes.saturating_mul(60);
            let due = {
                let mut fs = focus_seconds.lock().unwrap();
                // Hold at the target while the break is pending, so the UI
                // shows a full block instead of silently restarting the cycle.
                if !is_idle && *fs < target {
                    *fs += 1;
                    // Also feed the daily total for the dashboard.
                    let mut st = stats.lock().unwrap();
                    st.days.entry(today_key()).or_default().focus_seconds += 1;
                    dirty_ticks += 1;
                }
                let _ = app.emit("nook://focus-tick", *fs);
                *fs >= target
            };

            if dirty_ticks >= 30 {
                dirty_ticks = 0;
                let snapshot = {
                    let mut st = stats.lock().unwrap();
                    st.normalize_streak();
                    let _ = save_json(&stats_path, &*st);
                    st.clone()
                };
                let _ = app.emit("nook://stats-changed", snapshot);
            }

            if due && !is_idle {
                if due_for == 0 {
                    let _ = app.emit("nook://break-due", ());
                    // The creature physically walks to mid-screen to ask.
                    walk_companion(&app, "summon");
                }
                due_for += 1;
                if due_for >= BREAK_GRACE_SECONDS {
                    // Soft consent never came — escalate to the overlay.
                    due_for = 0;
                    break_open.store(true, Ordering::SeqCst);
                    let handle = app.clone();
                    let _ = app.run_on_main_thread(move || open_break(&handle));
                }
            } else if !due {
                due_for = 0;
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            open_break_window,
            close_break_window,
            skip_break,
            get_settings,
            update_settings,
            get_focus_seconds,
            get_stats,
            settle_companion,
            cancel_companion_walk
        ])
        .setup(|app| {
            let settings_path = config_file(app.handle(), "settings.json");
            let stats_path = config_file(app.handle(), "stats.json");
            let companion_path = config_file(app.handle(), "companion.json");

            let settings: Settings = load_json::<Settings>(&settings_path).clamp();
            let mut stats: Stats = load_json(&stats_path);
            stats.normalize_streak();

            app.manage(AppState {
                settings: Arc::new(Mutex::new(settings)),
                settings_path,
                stats: Arc::new(Mutex::new(stats)),
                stats_path,
                companion_path,
                home_pos: Arc::new(Mutex::new(None)),
                focus_seconds: Arc::new(Mutex::new(0)),
                break_open: Arc::new(AtomicBool::new(false)),
                walking: Arc::new(AtomicBool::new(false)),
                walk_cancel: Arc::new(AtomicBool::new(false)),
            });

            let handle = app.handle().clone();
            spawn_companion(&handle);
            spawn_focus_clock(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running nook");
}
