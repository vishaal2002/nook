# Nook — Foundation Document
*(working name — a warm, small place you return to)*

## 1. Product thesis

Every break app is a cop: it interrupts you and you resent it. Nook is a creature: it lives with you, and taking a break is something you do *together*. The product's single job is to make the user *want* the interruption. Everything — motion, sound, gamification — serves that inversion.

**Non-goals:** productivity analytics dashboards, team features, screen-time policing, guilt mechanics.

## 2. UX strategy

- **Companion-first.** The avatar is the product's face. The dashboard is secondary — a place you *visit*, not live in.
- **Escalation ladder, never a popup.** Break flow: ambient dimming → avatar walks in → speech bubble (dismissible) → fullscreen overlay only after soft consent or timeout. The user always has one graceful escape per stage. Skipping is acknowledged with mild disappointment, never punished.
- **Time-of-day is a first-class input.** Palette, greetings, avatar energy, and ambience all derive from a single `daySignal` (dawn / day / dusk / night) so the whole app breathes on one clock.
- **Respect the OS.** Do-not-disturb, fullscreen apps, and presentations suppress the companion automatically. A companion that interrupts a demo is uninstalled the same day.

## 3. Design system

### Palette — "Tidepool"
Calm, nature-derived, adaptive to daySignal.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#0F1E28` | Night surface / primary text on light |
| `--deepwater` | `#16303F` | Elevated dark surfaces |
| `--mist` | `#ECF1F0` | Day surface |
| `--foam` | `#FAFBFA` | Cards on light |
| `--lagoon` | `#4FA3A0` | Primary accent (actions, rings) |
| `--sage` | `#9DB8A0` | Secondary accent (growth, streaks) |
| `--dawn` | `#F0BFA0` | Companion warmth, celebration |
| `--dusk-violet` | `#8B87B8` | Evening gradient partner |

Gradients are always two adjacent naturals (lagoon→sage, dawn→dusk-violet), never rainbow. Glass = `rgba(surface, 0.6)` + `backdrop-blur(24px)` + 1px inner light border.

### Typography
- **Display:** Sora (SemiBold) — geometric warmth, great big numerals with `font-variant-numeric: tabular-nums` for the countdown.
- **Body/UI:** Instrument Sans — quiet, humanist, disappears politely.
- **Data:** Spline Sans Mono — scores, streak counts.
- Scale: 12 / 14 / 16 / 20 / 28 / 40 / 64 / 120 (overlay countdown).

## 4. Motion system

One physics vocabulary, exported from `src/motion/springs.ts`:

- `gentle` — stiffness 170, damping 26. Default for everything.
- `lively` — 300 / 20. Buttons, celebration pops.
- `lazy` — 80 / 20. Ambient drift, breathing.
- `enter` / `exit` — orchestrated: opacity + 12px y + slight blur; stagger children 40ms.
- **Rules:** nothing animates >600ms except ambience; every interactive element has hover + press states; `prefers-reduced-motion` collapses all springs to 150ms fades — non-negotiable for accessibility.

## 5. Avatar behavior system

A finite state machine (mirrored in the Rive state machine), driven by inputs:
`energy (0–1)`, `daySignal`, `idleSeconds`, `breakDue`, `userAction`.

States: `idle` (blink, sway) → `bored` (after 3m no input: stretch, sip water) → `sleeping` (system idle >5m) → `walking` (pre-break entrance) → `asking` (speech bubble) → `celebrating` / `disappointed` (break outcome) → `waving` (unlock/launch).

Anti-annoyance budget: max 1 unsolicited animation per 10 min, no speech bubbles during typing bursts, disappointment lasts <3s and never repeats twice in a row.

## 6. Database schema (SQLite)

```sql
CREATE TABLE sessions   (id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT, kind TEXT);          -- focus | idle
CREATE TABLE breaks     (id INTEGER PRIMARY KEY, due_at TEXT, taken_at TEXT, skipped INTEGER,
                         activity_id INTEGER, duration_s INTEGER);
CREATE TABLE activities (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, category TEXT, base_s INTEGER);
CREATE TABLE streaks    (id INTEGER PRIMARY KEY, kind TEXT, count INTEGER, best INTEGER, updated_at TEXT);
CREATE TABLE rewards    (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, unlocked_at TEXT, rarity TEXT);
CREATE TABLE plant      (id INTEGER PRIMARY KEY CHECK (id = 1), stage INTEGER, xp INTEGER, species TEXT);
CREATE TABLE settings   (key TEXT PRIMARY KEY, value TEXT);
```

## 7. Roadmap

1. **Shell** — this scaffold: 3 windows, tray, design tokens, timer core, event bus. ✅ started
2. **Companion v1** — placeholder avatar FSM, walk-in, speech bubbles, click-through window.
3. **Break overlay** — breathing activity, countdown, skip/complete flow writing to SQLite.
4. **Activity library** — stretches, eye exercises, hydration; sound design (Tone.js or plain HTMLAudio + preloaded OGGs).
5. **Rive avatar** — author character in Rive editor, wire state machine to FSM inputs.
6. **Gamification** — plant growth, streaks, rarity rewards, confetti.
7. **Ambience** — daySignal palette shifts, weather hook, holiday themes.
8. **Ship** — auto-updater, code signing, plugin API (Tauri commands namespace), Linux transparency fallbacks.

## 8. Plugin architecture (later)

Activities are data + a React component behind a registry (`registerActivity(slug, component, meta)`). Third-party plugins ship as sandboxed remote modules loaded into the break window only — never into the companion or main process.
