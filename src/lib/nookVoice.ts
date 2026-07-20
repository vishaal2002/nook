import type { AvatarState, DaySignal } from "../state/store";

/**
 * Nook's voice — short, warm, never naggy. Pools are picked with a small
 * recent-history so the same line doesn't land twice in a row.
 */

const recent: string[] = [];
const RECENT_CAP = 8;

function pick(pool: readonly string[]): string {
  if (pool.length === 0) return "";
  const fresh = pool.filter((l) => !recent.includes(l));
  const choices = fresh.length > 0 ? fresh : [...pool];
  const line = choices[Math.floor(Math.random() * choices.length)];
  recent.push(line);
  if (recent.length > RECENT_CAP) recent.shift();
  return line;
}

/* ─── Pools ─────────────────────────────────────────────────────────── */

const TAP = [
  "Hey. Still here with you.",
  "Blink once for me?",
  "You're doing fine. Soft shoulders.",
  "Quick stretch? Even a tiny one.",
  "I like this quiet with you.",
  "Hydration check — sip something?",
  "Eyes to the far wall for a second.",
  "I'm perched. You're focused. Deal.",
  "Tap me anytime. I talk back.",
  "Your posture just improved. Nice.",
  "One deep breath. I'll wait.",
  "Still glowing. Keep going.",
  "Hi. Missed that little hello.",
  "The work will wait for a blink.",
  "You've got this stretch of focus.",
];

const TAP_DAWN = [
  "Morning soft. Ease in.",
  "Early light looks good on you.",
  "Gentle start. I'm right here.",
  "Coffee? Water? Either works.",
];

const TAP_DUSK = [
  "Day's softening. So can you.",
  "Nice run so far. Easy finish.",
  "Golden hour — give your eyes a treat.",
  "Almost evening. Soft shoulders.",
];

const TAP_NIGHT = [
  "Late focus? Keep it kind.",
  "Night mode: shorter sprints help.",
  "I'm still up if you are.",
  "Dim lights, soft blinks.",
];

const DOUBLE_TAP = [
  "Double tap! Feeling chatty.",
  "Okay okay — I'm listening.",
  "Two taps means you like me.",
  "Secret handshake accepted.",
  "Boop. That was a good one.",
  "You found my favorite button.",
  "I'm blushing in teal.",
  "Again? Don't mind if I do.",
];

const IDLE = [
  "Just watching the screen glow with you.",
  "Quiet is nice too.",
  "Whenever you're ready, tap me.",
  "Still keeping an eye on your eyes.",
  "No rush. I'll be here.",
  "A little fidget never hurt.",
  "Thinking about clouds. And you.",
  "Hmm. Soft day.",
  "Your cursor's been busy.",
  "Remember: blinks are free.",
];

const FOCUS_EARLY = [
  "Fresh focus. Nice start.",
  "Settling in. I've got the timer.",
  "Deep work mode — I'm quiet.",
];

const FOCUS_MID = [
  "Halfway-ish. You're in it.",
  "Solid stretch so far.",
  "Still with you in the middle.",
];

const FOCUS_LATE = [
  "Break's coming soon. Hang tight.",
  "Almost time to soften.",
  "You're near the edge of a pause.",
  "A sip now makes the finish easier.",
];

const BREAK_SOON = [
  "Break time's close. Soft landing ahead.",
  "I'm about to wander over.",
  "Eyes first, then stretch.",
];

const CELEBRATE = [
  "Nice break. You're glowing.",
  "That reset counted. Well done.",
  "Back already? Looking brighter.",
  "Mmm. That was a good pause.",
  "Glow up. Literally.",
  "Stretched, sipped, returned. Perfect.",
];

const DISAPPOINT = [
  "Okay. Next time, maybe.",
  "Skipped — I'll try softer next round.",
  "No hard feelings. I'll check in later.",
  "Alright. Eyes still matter though.",
  "Next break's on me. Gentler ask.",
];

const WAKE = [
  "Welcome back!",
  "Oh — you're moving again.",
  "Nap over? Hi.",
  "There you are.",
  "I kept your spot warm.",
];

const STREAK = [
  "That streak looks warm from here.",
  "Consistency suits you.",
  "Day after day — I notice.",
];

export interface AskLine {
  title: string;
  body: string;
}

const ASKS: AskLine[] = [
  {
    title: "Time for a breather",
    body: "You've been in deep focus for a while. Stretch, sip, look far away — I'll hold your spot.",
  },
  {
    title: "Quick pause?",
    body: "Your eyes could use a horizon. A couple of minutes and we're right back at it.",
  },
  {
    title: "Let's stretch",
    body: "Lovely run of focus. A tiny reset now keeps the rhythm easy.",
  },
  {
    title: "Eyes need sky",
    body: "Screens shrink the world. Look past the glass for a minute — I'll wait.",
  },
  {
    title: "Soft reset",
    body: "Shoulders down, jaw loose, one long exhale. Then we continue.",
  },
  {
    title: "Sip & stand",
    body: "Water, a stand-up, a far window. Small ritual, big return.",
  },
  {
    title: "Blink break",
    body: "You've been staring hard. A short pause keeps the glow from dimming.",
  },
  {
    title: "Come walk with me",
    body: "I walked over for a reason. Take the break — your future self will thank you.",
  },
];

export type VoiceContext = {
  daySignal: DaySignal;
  /** 0–1 progress through the current focus block. */
  focusProgress: number;
  breakDue: boolean;
  streak: number;
};

/** Tap greeting — mixes time-of-day, focus stage, and general warmth. */
export function tapLine(ctx: VoiceContext): string {
  if (ctx.breakDue) return pick(BREAK_SOON);
  if (ctx.streak >= 3 && Math.random() < 0.25) return pick(STREAK);

  const pools: string[][] = [TAP];
  if (ctx.daySignal === "dawn") pools.push(TAP_DAWN);
  if (ctx.daySignal === "dusk") pools.push(TAP_DUSK);
  if (ctx.daySignal === "night") pools.push(TAP_NIGHT);

  if (ctx.focusProgress < 0.25) pools.push(FOCUS_EARLY);
  else if (ctx.focusProgress < 0.7) pools.push(FOCUS_MID);
  else if (ctx.focusProgress < 0.95) pools.push(FOCUS_LATE);
  else pools.push(BREAK_SOON);

  return pick(pools[Math.floor(Math.random() * pools.length)]);
}

export function doubleTapLine(): string {
  return pick(DOUBLE_TAP);
}

export function idleLine(ctx: VoiceContext): string {
  if (ctx.breakDue) return pick(BREAK_SOON);
  if (ctx.focusProgress >= 0.85) return pick(FOCUS_LATE);
  if (Math.random() < 0.3) {
    if (ctx.daySignal === "night") return pick(TAP_NIGHT);
    if (ctx.daySignal === "dawn") return pick(TAP_DAWN);
  }
  return pick(IDLE);
}

export function reactionLine(avatar: AvatarState): string | undefined {
  if (avatar === "celebrating") return pick(CELEBRATE);
  if (avatar === "disappointed") return pick(DISAPPOINT);
  if (avatar === "waving") return pick(WAKE);
  return undefined;
}

export function wakeLine(): string {
  return pick(WAKE);
}

export function celebrateLine(): string {
  return pick(CELEBRATE);
}

export function disappointLine(): string {
  return pick(DISAPPOINT);
}

export function askLine(): AskLine {
  return ASKS[Math.floor(Math.random() * ASKS.length)];
}
