import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNook, type AvatarState, type Settings } from "./state/store";
import Dashboard from "./windows/Dashboard";
import Companion from "./windows/Companion";
import BreakOverlay from "./windows/BreakOverlay";

/**
 * Reaction states are transient — they settle back to a resting state after
 * a beat (spec: disappointment lasts <3s, never lingers).
 */
let settleTimer: ReturnType<typeof setTimeout> | undefined;
function settle(next: AvatarState, ms: number) {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => useNook.getState().setAvatar(next), ms);
}
function cancelSettle() {
  clearTimeout(settleTimer);
}

/**
 * One React bundle, three windows. Tauri gives each window a label;
 * we render the right surface for it. Keeps the design system and
 * store shared without duplicating builds.
 */
export default function App() {
  const label = getCurrentWindow().label;
  const daySignal = useNook((s) => s.daySignal);
  const tickDay = useNook((s) => s.tickDay);
  const setBreakDue = useNook((s) => s.setBreakDue);
  const setAvatar = useNook((s) => s.setAvatar);
  const setFocusSeconds = useNook((s) => s.setFocusSeconds);
  const setSettings = useNook((s) => s.setSettings);

  useEffect(() => {
    document.documentElement.dataset.daySignal = daySignal;
  }, [daySignal]);

  useEffect(() => {
    const id = setInterval(tickDay, 60_000);
    return () => clearInterval(id);
  }, [tickDay]);

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then(setSettings)
      .catch(() => {});
  }, [setSettings]);

  // Poll focus as the source of truth — events can miss a tick on cold start.
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      invoke<number>("get_focus_seconds")
        .then((n) => {
          if (!cancelled) setFocusSeconds(n);
        })
        .catch(() => {});
    };
    pull();
    const id = setInterval(pull, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setFocusSeconds]);

  useEffect(() => {
    const subs = [
      listen("nook://break-due", () => {
        setBreakDue(true);
        setAvatar("walking");
        settle("asking", 1400); // walk in, then ask — escalation ladder
      }),
      listen("nook://system-idle", () => {
        cancelSettle();
        setAvatar("sleeping");
      }),
      listen("nook://system-active", () => {
        setAvatar("waving");
        settle("idle", 2000);
      }),
      listen<number>("nook://focus-tick", (e) => setFocusSeconds(e.payload)),
      listen<Settings>("nook://settings-changed", (e) => setSettings(e.payload)),
      listen("nook://break-done", () => {
        setBreakDue(false);
        setAvatar("celebrating");
        settle("idle", 3000);
      }),
      listen("nook://break-skipped", () => {
        setBreakDue(false);
        setAvatar("disappointed");
        settle("idle", 2500);
      }),
    ];
    return () => {
      cancelSettle();
      subs.forEach((p) => p.then((un) => un()));
    };
  }, [setAvatar, setBreakDue, setFocusSeconds, setSettings]);

  let surface = <Dashboard />;
  if (label === "companion") surface = <Companion />;
  if (label === "break") surface = <BreakOverlay />;

  // Collapses JS-driven springs under prefers-reduced-motion (CSS media query
  // in base.css only covers CSS animations) — non-negotiable per the spec.
  return <MotionConfig reducedMotion="user">{surface}</MotionConfig>;
}
