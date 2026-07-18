import { create } from "zustand";

export type DaySignal = "dawn" | "day" | "dusk" | "night";
export type AvatarState =
  | "idle" | "bored" | "sleeping" | "walking" | "asking"
  | "celebrating" | "disappointed" | "waving";

export interface Settings {
  focusMinutes: number;
  breakSeconds: number;
  idleSeconds: number;
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
  streak: number;
  settings: Settings;
  setAvatar: (s: AvatarState) => void;
  setBreakDue: (v: boolean) => void;
  setFocusSeconds: (n: number) => void;
  setSettings: (s: Settings) => void;
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
  streak: 0,
  settings: DEFAULT_SETTINGS,
  setAvatar: (avatar) => set({ avatar }),
  setBreakDue: (breakDue) => set({ breakDue }),
  setFocusSeconds: (focusSeconds) => set({ focusSeconds }),
  setSettings: (settings) => set({ settings }),
  tickDay: () => set({ daySignal: computeDaySignal() }),
}));
