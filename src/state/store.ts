import { create } from "zustand";

export type DaySignal = "dawn" | "day" | "dusk" | "night";
export type AvatarState =
  | "idle" | "bored" | "sleeping" | "walking" | "asking"
  | "celebrating" | "disappointed" | "waving";

/** Which screen edge the companion is perched on (drives facing + layout). */
export type Side = "left" | "right" | "float";

export interface Settings {
  focusMinutes: number;
  breakSeconds: number;
  idleSeconds: number;
}

export interface DayStats {
  taken: number;
  skipped: number;
  focusSeconds: number;
}

export interface BreakEvent {
  at: string;
  skipped: boolean;
}

export interface AchievementRec {
  slug: string;
  unlockedAt: string;
}

export interface Stats {
  days: Record<string, DayStats>;
  streak: number;
  bestStreak: number;
  lastStreakDay?: string | null;
  achievements: AchievementRec[];
  recent: BreakEvent[];
}

export const DEFAULT_SETTINGS: Settings = {
  focusMinutes: 50,
  breakSeconds: 120,
  idleSeconds: 300,
};

interface NookState {
  daySignal: DaySignal;
  avatar: AvatarState;
  focusSeconds: number;
  breakDue: boolean;
  settings: Settings;
  stats: Stats | null;
  side: Side;
  /** Facing during a walk: 1 = rightward, -1 = leftward. */
  walkDir: 1 | -1;
  /** Duration of the current walk in ms — lets the UI sync footstep audio. */
  walkMs: number;
  /** Transient one-liner in the companion's small bubble. */
  quip: string | null;
  /** Freshly unlocked achievement slug, for toasts / celebration. */
  achievement: string | null;
  setAvatar: (s: AvatarState) => void;
  setBreakDue: (v: boolean) => void;
  setFocusSeconds: (n: number) => void;
  setSettings: (s: Settings) => void;
  setStats: (s: Stats) => void;
  setSide: (s: Side) => void;
  setWalkDir: (d: 1 | -1) => void;
  setWalkMs: (n: number) => void;
  setQuip: (q: string | null) => void;
  setAchievement: (slug: string | null) => void;
  tickDay: () => void;
}

/** daySignal → signature mesh class. Dawn shares the warm dawn/dusk-violet pair. */
export function meshFor(d: DaySignal): string {
  if (d === "night") return "grad-night";
  if (d === "day") return "grad-day";
  return "grad-dusk";
}

export function computeDaySignal(d = new Date()): DaySignal {
  const h = d.getHours();
  if (h < 6) return "night";
  if (h < 9) return "dawn";
  if (h < 17) return "day";
  if (h < 21) return "dusk";
  return "night";
}

export const useNook = create<NookState>((set) => ({
  daySignal: computeDaySignal(),
  avatar: "idle",
  focusSeconds: 0,
  breakDue: false,
  settings: DEFAULT_SETTINGS,
  stats: null,
  side: "right",
  walkDir: -1,
  walkMs: 1200,
  quip: null,
  achievement: null,
  setAvatar: (avatar) => set({ avatar }),
  setBreakDue: (breakDue) => set({ breakDue }),
  setFocusSeconds: (focusSeconds) => set({ focusSeconds }),
  setSettings: (settings) => set({ settings }),
  setStats: (stats) => set({ stats }),
  setSide: (side) => set({ side }),
  setWalkDir: (walkDir) => set({ walkDir }),
  setWalkMs: (walkMs) => set({ walkMs }),
  setQuip: (quip) => set({ quip }),
  setAchievement: (achievement) => set({ achievement }),
  tickDay: () => set({ daySignal: computeDaySignal() }),
}));
