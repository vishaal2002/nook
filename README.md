# Nook (working name)

A desktop wellness companion. Not a Pomodoro timer.

## Run

```
npm install
npm run tauri dev
```

Requires Rust toolchain + Tauri 2 prerequisites (https://v2.tauri.app/start/prerequisites/).

## Structure

- `src-tauri/` — Rust core: window orchestration, focus clock, idle detection, tray (soon), SQLite
- `src/windows/` — one React surface per Tauri window label (main / companion / break)
- `src/motion/springs.ts` — the only place spring configs live
- `src/styles/tokens.css` — the design system as CSS variables, daySignal-adaptive
- `docs/FOUNDATION.md` — PRD, design system, avatar FSM, schema, roadmap

## Known scaffold gaps (deliberate)

- Avatar is a placeholder blob — author the real character in Rive, wire state machine inputs to `AvatarState`
- Break outcomes not yet persisted to SQLite
- Companion window is not yet click-through (needs `set_ignore_cursor_events` toggled around the hitbox)
- No tray icon asset yet; `icons/icon.png` must be added before `tauri build`
- Untested compile — scaffold written offline, expect minor API touch-ups against Tauri 2.5
