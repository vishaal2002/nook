import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useNook, type AvatarState, type Settings, type Side, type Stats } from "./state/store";
import { achievementDef } from "./lib/gamification";
import { celebrateLine, disappointLine, wakeLine } from "./lib/nookVoice";
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

let quipTimer: ReturnType<typeof setTimeout> | undefined;
function flashQuip(text: string, ms = 4000) {
  clearTimeout(quipTimer);
  useNook.getState().setQuip(text);
  quipTimer = setTimeout(() => useNook.getState().setQuip(null), ms);
}

interface WalkPayload {
  dir: number;
  ms: number;
  kind: "summon" | "home" | "cancelled";
}

const s = () => useNook.getState();

function onWalk(payload: WalkPayload) {
  cancelSettle();
  s().setWalkDir(payload.dir >= 0 ? 1 : -1);
  s().setWalkMs(payload.ms);
  s().setSide("float"); // centered in its window while it travels
  s().setAvatar("walking");
}

function adoptSide(side: string) {
  if (side !== "busy") s().setSide(side as Side);
}

function onWalkFinished(kind: string) {
  if (kind === "summon" && s().breakDue) {
    s().setAvatar("asking");
    return;
  }
  if (s().avatar === "walking") settle("idle", 200);
  // Back at the perch: re-derive which edge we're hugging (companion only —
  // settle_companion moves that window, so other windows must not call it).
  if (kind === "home" && getCurrentWindow().label === "companion") {
    invoke<string>("settle_companion").then(adoptSide).catch(() => {});
  }
}

function onSystemIdle() {
  cancelSettle();
  s().setBreakDue(false);
  s().setAvatar("sleeping");
  flashQuip("Going quiet for a bit…", 2500);
}

function onSystemActive() {
  s().setAvatar("waving");
  flashQuip(wakeLine(), 2800);
  settle("idle", 2000);
}

function onAchievement(slug: string) {
  const def = achievementDef(slug);
  s().setAchievement(slug);
  if (def) flashQuip(`${def.emoji} Badge unlocked — ${def.name}!`, 4500);
  setTimeout(() => s().setAchievement(null), 5000);
}

function onBreakDone() {
  s().setBreakDue(false);
  s().setAvatar("celebrating");
  flashQuip(celebrateLine(), 3500);
  settle("idle", 3000);
}

function onBreakSkipped() {
  s().setBreakDue(false);
  s().setAvatar("disappointed");
  flashQuip(disappointLine(), 3000);
  settle("idle", 2500);
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

  useEffect(() => {
    document.documentElement.dataset.daySignal = daySignal;
  }, [daySignal]);

  useEffect(() => {
    const id = setInterval(tickDay, 60_000);
    return () => clearInterval(id);
  }, [tickDay]);

  useEffect(() => {
    const { setSettings, setStats } = useNook.getState();
    invoke<Settings>("get_settings").then(setSettings).catch(() => {});
    invoke<Stats>("get_stats").then(setStats).catch(() => {});
  }, []);

  // Poll focus as the source of truth — events can miss a tick on cold start.
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      invoke<number>("get_focus_seconds")
        .then((n) => {
          if (!cancelled) useNook.getState().setFocusSeconds(n);
        })
        .catch(() => {});
    };
    pull();
    const id = setInterval(pull, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const subs = [
      // The walk event choreographs the avatar from break-due onward.
      listen("nook://break-due", () => s().setBreakDue(true)),
      listen<WalkPayload>("nook://walk", (e) => onWalk(e.payload)),
      listen<string>("nook://walk-finished", (e) => onWalkFinished(e.payload)),
      listen("nook://system-idle", onSystemIdle),
      listen("nook://system-active", onSystemActive),
      listen<number>("nook://focus-tick", (e) => s().setFocusSeconds(e.payload)),
      listen<Settings>("nook://settings-changed", (e) => s().setSettings(e.payload)),
      listen<Stats>("nook://stats-changed", (e) => s().setStats(e.payload)),
      listen<string>("nook://achievement", (e) => onAchievement(e.payload)),
      listen("nook://break-done", onBreakDone),
      listen("nook://break-skipped", onBreakSkipped),
    ];
    const unlisten = (p: Promise<() => void>) => p.then((un) => un());
    return () => {
      cancelSettle();
      subs.forEach(unlisten);
    };
  }, []);

  let surface = <Dashboard />;
  if (label === "companion") surface = <Companion />;
  if (label === "break") surface = <BreakOverlay />;

  // Collapses JS-driven springs under prefers-reduced-motion (CSS media query
  // in base.css only covers CSS animations) — non-negotiable per the spec.
  return <MotionConfig reducedMotion="user">{surface}</MotionConfig>;
}
