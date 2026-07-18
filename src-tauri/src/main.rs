// Nook — Rust core: window orchestration, focus timer, idle watch, settings.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

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

/// Escalation ladder timeout: once a break is due, the companion asks first;
/// if the ask goes unanswered this long, the overlay opens on its own.
const BREAK_GRACE_SECONDS: u64 = 45;

struct AppState {
    settings: Arc<Mutex<Settings>>,
    settings_path: PathBuf,
    /// Active focus elapsed this cycle — shared so the UI can poll.
    focus_seconds: Arc<Mutex<u64>>,
    /// True while the break overlay is up; the focus clock freezes.
    break_open: Arc<AtomicBool>,
}

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("settings.json")
}

fn load_settings(path: &PathBuf) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
        .clamp()
}

fn save_settings(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn get_focus_seconds(state: State<'_, AppState>) -> u64 {
    *state.focus_seconds.lock().unwrap()
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let next = settings.clamp();
    save_settings(&state.settings_path, &next)?;
    *state.settings.lock().unwrap() = next.clone();
    let _ = app.emit("nook://settings-changed", next.clone());
    Ok(next)
}

fn open_break(app: &AppHandle) {
    let state = app.state::<AppState>();
    state.break_open.store(true, Ordering::SeqCst);
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
    // Break resolved either way — restart the focus cycle.
    *state.focus_seconds.lock().unwrap() = 0;
    state.break_open.store(false, Ordering::SeqCst);
    // TODO: persist break outcome to SQLite; drive avatar reaction
    let event = if skipped {
        "nook://break-skipped"
    } else {
        "nook://break-done"
    };
    let _ = app.emit(event, ());
}

const COMPANION_W: f64 = 380.0;
const COMPANION_H: f64 = 240.0;

fn spawn_companion(app: &AppHandle) {
    let _ = WebviewWindowBuilder::new(app, "companion", WebviewUrl::App("index.html".into()))
        .title("Companion")
        .inner_size(COMPANION_W, COMPANION_H)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .build()
        .map(|w| {
            // Hug the right screen edge, a touch below center — clear of the
            // dock and menu bar. Monitor size is in physical pixels while the
            // window is logical — convert, or Retina puts us off-screen.
            if let Ok(Some(monitor)) = w.primary_monitor() {
                let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
                let _ = w.set_position(tauri::LogicalPosition::new(
                    size.width - COMPANION_W,
                    size.height * 0.62 - COMPANION_H / 2.0,
                ));
            }
        });
}

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

fn spawn_focus_clock(
    app: AppHandle,
    settings: Arc<Mutex<Settings>>,
    focus_seconds: Arc<Mutex<u64>>,
    break_open: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let mut was_idle = false;
        // Seconds the ask has gone unanswered; drives the escalation timeout.
        let mut due_for: u64 = 0;
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
                }
                let _ = app.emit("nook://focus-tick", *fs);
                *fs >= target
            };

            if due && !is_idle {
                if due_for == 0 {
                    let _ = app.emit("nook://break-due", ());
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
            get_settings,
            update_settings,
            get_focus_seconds
        ])
        .setup(|app| {
            let path = settings_path(app.handle());
            let settings = Arc::new(Mutex::new(load_settings(&path)));
            let focus_seconds = Arc::new(Mutex::new(0u64));
            let break_open = Arc::new(AtomicBool::new(false));
            app.manage(AppState {
                settings: settings.clone(),
                settings_path: path,
                focus_seconds: focus_seconds.clone(),
                break_open: break_open.clone(),
            });

            let handle = app.handle().clone();
            spawn_companion(&handle);
            spawn_focus_clock(handle, settings, focus_seconds, break_open);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running nook");
}
