import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type TargetAndTransition } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { cardIn, gentle, lively, press } from "../motion/springs";
import { useNook, type AvatarState, type Side } from "../state/store";
import { formatMinutesLabel } from "../lib/gamification";
import {
  askLine,
  doubleTapLine,
  idleLine,
  reactionLine,
  tapLine,
  type VoiceContext,
} from "../lib/nookVoice";
import { appear, arrival, disappear, greet, primeAudio, startFootsteps } from "../lib/sound";

/**
 * Transparent, always-on-top window the creature lives in. The window itself
 * is moved by Rust (walks to ask, walks home); everything here is the
 * creature's inner life: idle fidgets, blinks, the corner dock, the
 * conversation card, and the synthesized footstep/greeting audio.
 *
 * Nook is pinned to the right edge — tap for a hello, double-tap for a
 * chatty aside. Idle chatter bubbles up on its own now and then.
 */

const BODY_W = 92;
const BODY_H = 80;

/** Pick a value by which edge the companion is perched on. */
function bySide<T>(side: Side, right: T, left: T, float: T): T {
  if (side === "right") return right;
  if (side === "left") return left;
  return float;
}

/** States shown at mid-screen where the creature stands larger, like a chat. */
const CENTER_STATES: Set<AvatarState> = new Set(["asking", "celebrating", "disappointed"]);

/* ─── Creature visuals ─────────────────────────────────────────────── */

/** Bottom-anchored squash & stretch per state. The window supplies travel;
 *  the body supplies personality. */
function bodyAnim(avatar: AvatarState, facing: number, walkDir: number): TargetAndTransition {
  switch (avatar) {
    case "sleeping":
      return {
        y: 4, scaleY: [0.93, 0.96, 0.93], scaleX: [1.04, 1.02, 1.04], rotate: -3, opacity: 0.92,
        transition: { duration: 5, repeat: Infinity, ease: "easeInOut" },
      };
    case "walking":
      return {
        y: [0, -7, 0], scaleY: [0.95, 1.05, 0.95], scaleX: [1.04, 0.97, 1.04],
        rotate: walkDir * 5, opacity: 1,
        transition: { duration: 0.38, repeat: Infinity, ease: "easeInOut", rotate: gentle },
      };
    case "asking":
      return {
        y: [0, -2.5, 0], scaleY: [1, 1.025, 1], rotate: 0, opacity: 1,
        transition: { duration: 1.1, repeat: Infinity, ease: "easeInOut" },
      };
    case "celebrating":
      return {
        y: [0, -18, 0, -10, 0],
        scaleY: [1, 1.1, 0.9, 1.06, 1],
        scaleX: [1, 0.94, 1.08, 0.96, 1],
        rotate: 0, opacity: 1,
        transition: { duration: 0.85, repeat: 2, ease: "easeOut" },
      };
    case "disappointed":
      return { y: 5, scaleY: 0.92, scaleX: 1.05, rotate: facing * 3, opacity: 1, transition: gentle };
    case "waving":
      return {
        rotate: [0, -8, 6, -8, 0], scaleY: [1, 1.03, 1, 1.03, 1], y: 0, opacity: 1,
        transition: { duration: 0.9, ease: "easeInOut" },
      };
    default: // idle / bored
      return {
        y: [0, -1.5, 0], scaleY: [1, 0.972, 1], scaleX: [1, 1.025, 1], rotate: 0, opacity: 1,
        transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
      };
  }
}

function mouthPath(avatar: AvatarState): { d: string; fill?: boolean } {
  switch (avatar) {
    case "celebrating":
    case "waving":
      return { d: "M3 2 Q8 9.5 13 2 Z", fill: true };
    case "asking":
      return { d: "M8 2.2 a2.6 3 0 1 0 0.01 0" };
    case "disappointed":
      return { d: "M3 6 Q8 1.5 13 6" };
    case "sleeping":
      return { d: "M5 4 Q8 5.5 11 4" };
    default:
      return { d: "M3 2 Q8 7.5 13 2" };
  }
}

function Eye({ x, avatar }: Readonly<{ x: number; avatar: AvatarState }>) {
  const closed = avatar === "sleeping";
  const happy = avatar === "celebrating" || avatar === "waving";
  // Default: an occasional double-blink; closed lids while asleep; curved
  // happy squints while celebrating or waving.
  let anim: TargetAndTransition = { scaleY: [1, 1, 0.08, 1, 0.08, 1], y: 0 };
  let transition: TargetAndTransition["transition"] = {
    duration: 4.6, times: [0, 0.9, 0.925, 0.95, 0.975, 1], repeat: Infinity,
  };
  if (closed) {
    anim = { scaleY: 0.12 };
    transition = gentle;
  } else if (happy) {
    anim = { scaleY: 0.55, y: -1 };
    transition = gentle;
  }
  return (
    <motion.div
      animate={anim}
      transition={transition}
      style={{
        position: "absolute", top: 26, left: x,
        width: 9, height: 11, borderRadius: 6, background: "var(--ink)",
      }}
    >
      <div style={{
        position: "absolute", top: 2, left: 2, width: 3, height: 3,
        borderRadius: "50%", background: "rgba(255, 255, 255, 0.85)",
      }} />
    </motion.div>
  );
}

function Foot({ side, walking }: Readonly<{ side: "l" | "r"; walking: boolean }>) {
  return (
    <motion.div
      animate={walking ? { y: [0, -5, 0] } : { y: 0 }}
      transition={
        walking
          ? { duration: 0.38, repeat: Infinity, ease: "easeInOut", delay: side === "l" ? 0 : 0.19 }
          : gentle
      }
      style={{
        position: "absolute", bottom: -4, left: side === "l" ? 24 : 52,
        width: 17, height: 9, borderRadius: "50% 50% 45% 45%",
        background: "linear-gradient(180deg, #3f8a87, #37807d)",
        boxShadow: "inset 0 1px 2px rgba(255, 255, 255, 0.3)",
      }}
    />
  );
}

function Zzz() {
  return (
    <div style={{ position: "absolute", top: -6, right: -4, pointerEvents: "none" }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 4, x: 0 }}
          animate={{ opacity: [0, 0.9, 0], y: -22 - i * 4, x: 6 + i * 3 }}
          transition={{ duration: 2.6, delay: i * 0.85, repeat: Infinity, ease: "easeOut" }}
          style={{
            position: "absolute", right: 0,
            font: `600 ${11 + i * 2}px var(--font-display)`, color: "var(--ink)",
            textShadow: "0 1px 3px rgba(255, 255, 255, 0.65)",
          }}
        >
          z
        </motion.span>
      ))}
    </div>
  );
}

const CONFETTI_COLORS = ["#4fa3a0", "#9db8a0", "#f0bfa0", "#8b87b8"];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 130,
        y: -34 - Math.random() * 60,
        rot: (Math.random() - 0.5) * 360,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 3 === 0,
      })),
    []
  );
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ opacity: 1, x: 0, y: 8, rotate: 0, scale: 0.6 }}
          animate={{ opacity: [1, 1, 0], x: p.x, y: [8, p.y, p.y + 26], rotate: p.rot, scale: 1 }}
          transition={{ duration: 1.25, ease: "easeOut", delay: Math.random() * 0.15 }}
          style={{
            position: "absolute", left: BODY_W / 2, top: 18,
            width: p.round ? 6 : 5, height: p.round ? 6 : 9,
            borderRadius: p.round ? "50%" : 2, background: p.color,
          }}
        />
      ))}
    </div>
  );
}

function Creature({
  avatar, facing, walkDir, micro,
}: Readonly<{ avatar: AvatarState; facing: number; walkDir: number; micro: string | null }>) {
  // Idle micro-actions briefly override the base loop.
  let anim = bodyAnim(avatar, facing, walkDir);
  if (avatar === "idle" && micro === "bounce") {
    anim = { y: [0, -11, 0], scaleY: [1, 1.06, 0.96], transition: { duration: 0.55, ease: "easeOut" } };
  } else if (avatar === "idle" && micro === "stretch") {
    anim = { scaleY: [1, 1.1, 1], scaleX: [1, 0.95, 1], y: [0, -3, 0], transition: { duration: 1.3, ease: "easeInOut" } };
  } else if (avatar === "idle" && micro === "tilt") {
    anim = { rotate: [0, facing * 6, 0], y: [0, -2, 0], transition: { duration: 1.4, ease: "easeInOut" } };
  }

  let glance = facing;
  if (micro === "glance-l") glance = -1;
  else if (micro === "glance-r") glance = 1;
  const mouth = mouthPath(avatar);
  const eyesShift = glance * 6;

  return (
    <div style={{ position: "relative", width: BODY_W, height: BODY_H + 10 }}>
      {/* grounding shadow */}
      <motion.div
        animate={{ scaleX: avatar === "walking" ? [1, 0.82, 1] : 1, opacity: avatar === "sleeping" ? 0.18 : 0.26 }}
        transition={avatar === "walking" ? { duration: 0.38, repeat: Infinity, ease: "easeInOut" } : gentle}
        style={{
          position: "absolute", bottom: -3, left: 12, width: BODY_W - 24, height: 12,
          borderRadius: "50%", background: "rgba(15, 30, 40, 0.4)", filter: "blur(5px)",
        }}
      />
      <Foot side="l" walking={avatar === "walking"} />
      <Foot side="r" walking={avatar === "walking"} />
      <motion.div
        animate={anim}
        style={{
          position: "absolute", bottom: 2, left: 0,
          width: BODY_W, height: BODY_H,
          transformOrigin: "50% 100%",
          borderRadius: "48% 48% 44% 44% / 60% 60% 40% 40%",
          background:
            "radial-gradient(circle at 32% 26%, rgba(255, 236, 219, 0.9), transparent 55%), " +
            "linear-gradient(195deg, var(--dawn), var(--lagoon))",
          boxShadow:
            "inset 0 -9px 16px rgba(15, 30, 40, 0.16), inset 0 3px 7px rgba(255, 255, 255, 0.45)",
        }}
      >
        {/* face group shifts to look around / into the room */}
        <motion.div animate={{ x: eyesShift }} transition={gentle} style={{ position: "absolute", inset: 0 }}>
          <Eye x={BODY_W / 2 - 17} avatar={avatar} />
          <Eye x={BODY_W / 2 + 8} avatar={avatar} />
          <svg
            width="16" height="10" viewBox="0 0 16 10"
            style={{ position: "absolute", top: 42, left: BODY_W / 2 - 8, overflow: "visible" }}
          >
            <path
              d={mouth.d}
              fill={mouth.fill ? "var(--ink)" : "none"}
              stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round"
            />
          </svg>
          {/* cheeks */}
          <div style={{
            position: "absolute", top: 40, left: BODY_W / 2 - 30, width: 10, height: 6,
            borderRadius: "50%", background: "rgba(214, 120, 90, 0.4)", filter: "blur(1px)",
          }} />
          <div style={{
            position: "absolute", top: 40, left: BODY_W / 2 + 20, width: 10, height: 6,
            borderRadius: "50%", background: "rgba(214, 120, 90, 0.4)", filter: "blur(1px)",
          }} />
        </motion.div>
        {/* waving arm */}
        <AnimatePresence>
          {avatar === "waving" && (
            <motion.div
              initial={{ opacity: 0, rotate: 30 }}
              animate={{ opacity: 1, rotate: [30, -30, 10, -30, 30] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeInOut" }}
              style={{
                position: "absolute", top: 20, right: -7, width: 9, height: 24,
                transformOrigin: "50% 90%", borderRadius: 6,
                background: "linear-gradient(195deg, var(--dawn), var(--lagoon))",
              }}
            />
          )}
        </AnimatePresence>
      </motion.div>
      {avatar === "sleeping" && <Zzz />}
      {avatar === "celebrating" && <Confetti />}
    </div>
  );
}

/* ─── Corner dock (idle perch) ─────────────────────────────────────── */

/**
 * The resting home: a compact, rounded, floating dock that holds the creature
 * when it's perched at a screen corner. Lifts and brightens on hover, and
 * reveals a tiny "next break" hint so the dock earns its pixels.
 */
function Dock({
  children, hovered, onHoverChange,
}: Readonly<{ children: React.ReactNode; hovered: boolean; onHoverChange: (v: boolean) => void }>) {
  return (
    <motion.div
      onHoverStart={() => onHoverChange(true)}
      onHoverEnd={() => onHoverChange(false)}
      animate={{ y: hovered ? -4 : 0, scale: hovered ? 1.035 : 1 }}
      transition={lively}
      style={{
        position: "relative",
        padding: "12px 18px 10px",
        borderRadius: 30,
        background: "var(--glass-solid)",
        border: "1px solid var(--glass-border)",
        boxShadow: hovered
          ? "inset 0 1px 0 var(--glass-highlight), 0 18px 44px rgba(15, 30, 40, 0.26), 0 4px 12px rgba(15, 30, 40, 0.16)"
          : "inset 0 1px 0 var(--glass-highlight), 0 12px 32px rgba(15, 30, 40, 0.18), 0 2px 6px rgba(15, 30, 40, 0.1)",
        transition: "box-shadow 0.25s ease",
      }}
    >
      {/* soft top sheen for depth */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
        background: "linear-gradient(160deg, rgba(255,255,255,0.14), transparent 55%)",
      }} />
      {children}
    </motion.div>
  );
}

/* ─── Conversation card ────────────────────────────────────────────── */

function StreakChip({ streak }: Readonly<{ streak: number }>) {
  if (streak <= 0) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6, justifySelf: "start",
      padding: "5px 12px", borderRadius: "var(--radius-pill)",
      background: "var(--accent-soft)", color: "var(--accent)",
      font: "600 var(--text-xs)/1.3 var(--font-body)",
    }}>
      🔥 {streak}-day streak on the line
    </div>
  );
}

function BreakCard({
  streak, breakSeconds, side,
}: Readonly<{ streak: number; breakSeconds: number; side: Side }>) {
  const ask = useMemo(() => askLine(), []);
  const tailSide = bySide<React.CSSProperties>(
    side, { right: 46 }, { left: 46 }, { left: "50%", marginLeft: -7 }
  );

  return (
    <motion.div
      {...cardIn}
      className="glass glass-solid"
      style={{
        position: "relative", width: 400, maxWidth: "calc(100% - 8px)",
        padding: "var(--s6)", display: "grid", gap: "var(--s4)",
        borderRadius: 26,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s4)" }}>
        <div style={{
          width: 46, height: 46, borderRadius: 15, flexShrink: 0,
          display: "grid", placeItems: "center", fontSize: 22,
          background: "linear-gradient(140deg, var(--lagoon), var(--sage))",
          boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 6px 16px rgba(79,163,160,0.28)",
        }}>
          🍃
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: "var(--text-lg)", lineHeight: 1.2 }}>{ask.title}</h2>
          <span className="t-soft" style={{ fontSize: "var(--text-sm)" }}>
            {formatMinutesLabel(breakSeconds)} · guided breathing
          </span>
        </div>
      </div>

      <p className="t-soft" style={{ fontSize: "var(--text-md)", lineHeight: 1.55 }}>{ask.body}</p>

      <StreakChip streak={streak} />

      <div style={{ display: "flex", gap: "var(--s3)", marginTop: 2 }}>
        <motion.button
          {...press}
          style={{ flex: 1, padding: "var(--s3) var(--s5)", fontSize: "var(--text-md)", fontWeight: 600 }}
          onClick={() => invoke("open_break_window")}
        >
          Take a break
        </motion.button>
        <motion.button
          {...press}
          className="ghost"
          style={{ padding: "var(--s3) var(--s5)", fontSize: "var(--text-md)" }}
          onClick={() => invoke("skip_break")}
        >
          Skip for now
        </motion.button>
      </div>

      <span className="t-soft" style={{ fontSize: 12, textAlign: "center", opacity: 0.85 }}>
        Breaks brighten your glow · skips dim it
      </span>

      {/* tail pointing down at the creature */}
      <div style={{
        position: "absolute", bottom: -6, width: 13, height: 13, ...tailSide,
        transform: "rotate(45deg)", borderRadius: 3,
        background: "var(--glass-solid)",
        borderBottom: "1px solid var(--glass-border)",
        borderRight: "1px solid var(--glass-border)",
      }} />
    </motion.div>
  );
}

function QuipBubble({ text, side }: Readonly<{ text: string; side: Side }>) {
  const tailSide = bySide<React.CSSProperties>(
    side, { right: 30 }, { left: 30 }, { left: "50%", marginLeft: -5 }
  );
  return (
    <motion.div
      key={text}
      className="glass glass-solid"
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.96 }}
      transition={gentle}
      style={{
        position: "relative", maxWidth: 216,
        padding: "var(--s3) var(--s4)", fontSize: "var(--text-sm)", lineHeight: 1.45,
        borderRadius: 16,
      }}
    >
      {text}
      <div style={{
        position: "absolute", bottom: -4, width: 9, height: 9, ...tailSide,
        transform: "rotate(45deg)", borderRadius: 2,
        background: "var(--glass-solid)",
        borderBottom: "1px solid var(--glass-border)",
        borderRight: "1px solid var(--glass-border)",
      }} />
    </motion.div>
  );
}

/** Tiny hint pill revealed on dock hover — tells you when Nook comes calling. */
function DockHint({ text, side }: Readonly<{ text: string; side: Side }>) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.92 }}
      transition={gentle}
      style={{
        position: "relative", alignSelf: bySide(side, "flex-end", "flex-start", "center"),
        padding: "6px 12px", borderRadius: "var(--radius-pill)",
        background: "var(--glass-solid)", border: "1px solid var(--glass-border)",
        boxShadow: "0 8px 22px rgba(15,30,40,0.16)",
        font: "600 var(--text-xs)/1.2 var(--font-body)", color: "var(--text)",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </motion.div>
  );
}

/* ─── Window shell ─────────────────────────────────────────────────── */

function voiceCtx(): VoiceContext {
  const st = useNook.getState();
  const target = Math.max(st.settings.focusMinutes, 1) * 60;
  return {
    daySignal: st.daySignal,
    focusProgress: Math.min(st.focusSeconds / target, 1),
    breakDue: st.breakDue,
    streak: st.stats?.streak ?? 0,
  };
}

let speakTimer: ReturnType<typeof setTimeout> | undefined;

function speak(line: string, avatar: AvatarState = "waving", holdMs = 2800) {
  const st = useNook.getState();
  if (st.avatar === "asking" || st.avatar === "walking") return;
  clearTimeout(speakTimer);
  st.setQuip(line);
  st.setAvatar(avatar);
  // Audio is fired by the avatar transition effect — avoid double-greets.
  speakTimer = setTimeout(() => {
    const cur = useNook.getState();
    if (cur.avatar === avatar) cur.setAvatar("idle");
    if (cur.quip === line) cur.setQuip(null);
  }, holdMs);
}

function onSingleTap() {
  speak(tapLine(voiceCtx()), "waving", 2800);
}

function onDoubleTap() {
  speak(doubleTapLine(), "celebrating", 2200);
}

async function settleNow(setSide: (s: Side) => void) {
  try {
    const side = await invoke<string>("settle_companion");
    if (side !== "busy") setSide(side as Side);
    const st = useNook.getState();
    if (st.breakDue && st.avatar !== "asking" && st.avatar !== "walking") {
      st.setAvatar("asking");
    }
  } catch {
    /* window may be mid-walk; the walk's own events take over */
  }
}

export default function Companion() {
  const avatar = useNook((s) => s.avatar);
  const breakDue = useNook((s) => s.breakDue);
  const side = useNook((s) => s.side);
  const setSide = useNook((s) => s.setSide);
  const walkDir = useNook((s) => s.walkDir);
  const walkMs = useNook((s) => s.walkMs);
  const quip = useNook((s) => s.quip);
  const streak = useNook((s) => s.stats?.streak ?? 0);
  const breakSeconds = useNook((s) => s.settings.breakSeconds);
  const focusMinutes = useNook((s) => s.settings.focusMinutes);
  const focusSeconds = useNook((s) => s.focusSeconds);
  const daySignal = useNook((s) => s.daySignal);

  const [micro, setMicro] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionQuip = useMemo(() => reactionLine(avatar), [avatar]);

  // Pin to the right edge on launch (and re-open the ask if a break is due).
  useEffect(() => {
    settleNow(setSide);
  }, [setSide]);

  // Idle fidgets: glance around, bounce, stretch, head-tilt — sparse, never on
  // a timer the user can predict.
  useEffect(() => {
    if (avatar !== "idle") {
      setMicro(null);
      return;
    }
    let alive = true;
    let timer: number;
    const fidget = () => {
      if (!alive) return;
      const acts = ["glance-l", "glance-r", "bounce", "stretch", "tilt", null, null];
      setMicro(acts[Math.floor(Math.random() * acts.length)]);
      window.setTimeout(() => alive && setMicro(null), 1500);
      loop();
    };
    const loop = () => {
      timer = window.setTimeout(fidget, 6000 + Math.random() * 9000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [avatar]);

  // Spontaneous idle chatter — Nook speaks up on its own, infrequently.
  useEffect(() => {
    if (avatar !== "idle" || breakDue) return;
    let alive = true;
    let timer: number;
    const chatter = () => {
      if (!alive) return;
      const st = useNook.getState();
      if (st.avatar !== "idle" || st.quip || st.breakDue) {
        loop();
        return;
      }
      const line = idleLine({
        daySignal: st.daySignal,
        focusProgress: Math.min(
          st.focusSeconds / (Math.max(st.settings.focusMinutes, 1) * 60),
          1,
        ),
        breakDue: st.breakDue,
        streak: st.stats?.streak ?? 0,
      });
      st.setQuip(line);
      window.setTimeout(() => {
        const cur = useNook.getState();
        if (cur.quip === line) cur.setQuip(null);
      }, 4200);
      loop();
    };
    const loop = () => {
      // First bubble after a longer quiet; then every ~50–90s.
      timer = window.setTimeout(chatter, 28_000 + Math.random() * 45_000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [avatar, breakDue, daySignal]);

  // Soft milestone nudges as focus progresses — once per band per cycle.
  const milestoneRef = useRef(0);
  useEffect(() => {
    const target = Math.max(focusMinutes, 1) * 60;
    const progress = focusSeconds / target;
    const band = progress >= 0.9 ? 3 : progress >= 0.55 ? 2 : progress >= 0.25 ? 1 : 0;
    if (band === 0) {
      milestoneRef.current = 0;
      return;
    }
    if (band <= milestoneRef.current) return;
    const st = useNook.getState();
    if (st.avatar !== "idle" || st.breakDue || st.quip) return;
    milestoneRef.current = band;
    const line = idleLine({
      daySignal: st.daySignal,
      focusProgress: progress,
      breakDue: st.breakDue,
      streak: st.stats?.streak ?? 0,
    });
    st.setQuip(line);
    // Fire-and-forget — don't clear on the next focus tick.
    window.setTimeout(() => {
      const cur = useNook.getState();
      if (cur.quip === line) cur.setQuip(null);
    }, 3800);
  }, [focusSeconds, focusMinutes, avatar, breakDue, daySignal]);


  // ── Audio: footsteps synced to walks, arrival thud, appear/disappear ──
  const stopStepsRef = useRef<(() => void) | null>(null);
  const prevAvatarRef = useRef(avatar);
  useEffect(() => {
    const prev = prevAvatarRef.current;
    prevAvatarRef.current = avatar;
    if (avatar === "walking" && prev !== "walking") {
      stopStepsRef.current?.();
      stopStepsRef.current = startFootsteps(walkMs);
    }
    if (prev === "walking" && avatar !== "walking") {
      stopStepsRef.current?.();
      stopStepsRef.current = null;
      arrival();
    }
    if (avatar === "waving" && prev !== "waving") greet();
    if (avatar === "celebrating" && prev !== "celebrating") appear();
  }, [avatar, walkMs]);

  const showCard = breakDue && avatar === "asking";
  const prevCardRef = useRef(showCard);
  useEffect(() => {
    if (showCard && !prevCardRef.current) appear();
    if (!showCard && prevCardRef.current) disappear();
    prevCardRef.current = showCard;
  }, [showCard]);

  const onCreatureClick = () => {
    primeAudio();
    // Distinguish single vs double tap without eating the double's first click.
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      onDoubleTap();
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onSingleTap();
    }, 240);
  };

  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
  }, []);

  // Facing: travel direction while walking, otherwise into the room.
  let facing = 0;
  if (avatar === "walking") facing = walkDir;
  else if (side === "right") facing = -1;
  else if (side === "left") facing = 1;

  const bubbleText = showCard ? undefined : quip ?? reactionQuip;
  const docked = (side === "left" || side === "right") && !showCard && avatar !== "walking";
  const bigStage = side === "float" && CENTER_STATES.has(avatar);
  const align = bySide(side, "flex-end", "flex-start", "center");

  // Hint shown on dock hover: how long until the next check-in.
  const target = Math.max(focusMinutes, 1) * 60;
  const remain = Math.max(target - focusSeconds, 0);
  const nextMin = Math.ceil(remain / 60);
  const dockHint = remain <= 0 ? "Break time — tap me" : `Next break ~${nextMin}m · double-tap to chat`;

  const creature = (
    <motion.div
      onClick={onCreatureClick}
      animate={{ scale: bigStage ? 1.4 : 1 }}
      transition={gentle}
      style={{ cursor: "pointer", flexShrink: 0, transformOrigin: "50% 100%" }}
    >
      <Creature avatar={avatar} facing={facing} walkDir={walkDir} micro={micro} />
    </motion.div>
  );

  return (
    <div
      style={{
        height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "flex-end", alignItems: align,
        gap: "var(--s3)", padding: "6px 10px 12px",
        background: "transparent", overflow: "hidden",
      }}
    >
      <AnimatePresence mode="wait">
        {showCard && <BreakCard key="card" streak={streak} breakSeconds={breakSeconds} side={side} />}
        {!showCard && bubbleText && <QuipBubble key={bubbleText} text={bubbleText} side={side} />}
        {!showCard && !bubbleText && docked && hovered && (
          <DockHint key="hint" text={dockHint} side={side} />
        )}
      </AnimatePresence>

      {docked ? (
        <Dock hovered={hovered} onHoverChange={setHovered}>{creature}</Dock>
      ) : (
        creature
      )}
    </div>
  );
}
