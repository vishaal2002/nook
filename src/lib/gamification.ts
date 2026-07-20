import type { DayStats, Stats } from "../state/store";

/**
 * Glow — the daily wellbeing score (0–100). You start the day Steady (60);
 * breaks brighten it, skips dim it, a live streak adds warmth. The math is
 * deliberately simple enough to explain in one sentence.
 */
export const GLOW_TAKE = 10;
export const GLOW_SKIP = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function dateKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function dayStats(stats: Stats | null, key: string): DayStats {
  return stats?.days[key] ?? { taken: 0, skipped: 0, focusSeconds: 0 };
}

export function todayStats(stats: Stats | null): DayStats {
  return dayStats(stats, dateKey());
}

export function glowScore(stats: Stats | null): number {
  const t = todayStats(stats);
  const streakWarmth = Math.min(stats?.streak ?? 0, 5) * 2;
  return clamp(60 + t.taken * GLOW_TAKE + streakWarmth - t.skipped * GLOW_SKIP, 5, 100);
}

/** Yesterday's closing score (no streak warmth — it isn't knowable retroactively). */
export function glowScoreFor(day: DayStats): number {
  return clamp(60 + day.taken * GLOW_TAKE - day.skipped * GLOW_SKIP, 5, 100);
}

export interface GlowMood {
  word: string;
  /** CSS custom property carrying the meter fill for this band. */
  color: string;
}

export function glowMood(score: number): GlowMood {
  if (score >= 85) return { word: "Radiant", color: "var(--score-high)" };
  if (score >= 70) return { word: "Glowing", color: "var(--score-high)" };
  if (score >= 55) return { word: "Steady", color: "var(--score-mid)" };
  if (score >= 35) return { word: "Dimming", color: "var(--score-mid)" };
  return { word: "Flickering", color: "var(--score-low)" };
}

/* ─── Achievements ─────────────────────────────────────────────────── */

export interface AchievementDef {
  slug: string;
  emoji: string;
  name: string;
  desc: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { slug: "first-break", emoji: "🌱", name: "First rest", desc: "Took your very first break" },
  { slug: "daily-3", emoji: "☕", name: "Three today", desc: "Three breaks in a single day" },
  { slug: "steady-day", emoji: "🌿", name: "Clean sheet", desc: "Three breaks, zero skips in a day" },
  { slug: "streak-3", emoji: "🔥", name: "Warm streak", desc: "Kept a 3-day break streak" },
  { slug: "streak-7", emoji: "⚡", name: "One week strong", desc: "Kept a 7-day break streak" },
  { slug: "streak-14", emoji: "🌊", name: "Fortnight flow", desc: "Kept a 14-day break streak" },
  { slug: "early-bird", emoji: "🌅", name: "Early bird", desc: "Took a break before 9 am" },
  { slug: "night-owl", emoji: "🌙", name: "Night owl", desc: "Took a break after 9 pm" },
  { slug: "comeback", emoji: "💪", name: "Comeback", desc: "Took a break right after skipping one" },
  { slug: "fifty", emoji: "🏆", name: "Fifty rests", desc: "Fifty lifetime breaks taken" },
];

export function achievementDef(slug: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.slug === slug);
}

/* ─── Formatting ───────────────────────────────────────────────────── */

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

export function formatMinutesLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const m = seconds / 60;
  return Number.isInteger(m) ? `${m} min` : `${m.toFixed(1)} min`;
}

export function formatClockTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Last 7 local date keys, oldest first, ending today. */
export function lastSevenDays(): string[] {
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(dateKey(d));
  }
  return out;
}
