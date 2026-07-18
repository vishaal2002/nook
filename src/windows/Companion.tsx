import { AnimatePresence, motion, type TargetAndTransition } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { gentle, lazy, press } from "../motion/springs";
import { useNook } from "../state/store";

/**
 * Transparent, always-on-top window hugging the right screen edge.
 * The creature peeks in from the side — part of its body sits past the
 * window (= screen) edge and gets clipped, so it reads as leaning in
 * from outside. The speech bubble opens to its left. The blob is a
 * stand-in: swap for <Rive/> once the character is authored.
 */

const bubbleCopy: Partial<Record<string, string>> = {
  asking: "Hey... you've been at it a while. Eyes deserve a rest?",
  walking: "Hey... you've been at it a while.",
  celebrating: "Nice break. You're glowing.",
  disappointed: "Okay. Next time, maybe.",
  waving: "Welcome back!",
};

/** How much of the body hides past the screen edge. */
const PEEK = 26;

/**
 * Side-orientation animation set, anchored at the screen edge
 * (transformOrigin right): the creature squashes *against* the edge and
 * stretches *out* of it. Every state resets opacity so `sleeping`
 * doesn't leak its fade into the next state.
 */
const bodyAnim: Record<string, TargetAndTransition> = {
  idle: {
    x: 0, scaleX: [1, 1.04, 1], scaleY: [1, 0.985, 1], opacity: 1,
    transition: { duration: 4, repeat: Infinity, ease: "easeInOut" },
  },
  bored: {
    rotate: [0, -4, 3, 0], y: [0, 2, 0, -1, 0], opacity: 1,
    transition: { duration: 2.8, repeat: Infinity, ease: "easeInOut" },
  },
  sleeping: {
    rotate: -5, scaleY: [0.94, 0.97, 0.94], scaleX: [1.03, 1.01, 1.03], opacity: 0.7,
    transition: { duration: 6, repeat: Infinity, ease: "easeInOut" },
  },
  walking: {
    x: [0, -8, 0], rotate: [0, -3, 0], scaleX: [1, 1.05, 1], opacity: 1,
    transition: { duration: 1, repeat: Infinity, ease: "easeInOut" },
  },
  asking: {
    x: [0, -5, 0], scaleX: [1, 1.04, 1], scaleY: [1, 0.98, 1], opacity: 1,
    transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
  },
  celebrating: {
    // squash against the edge → pop out → settle back
    x: [0, 4, -16, -18, 0, 0],
    scaleX: [1, 0.86, 1.16, 1.12, 0.9, 1],
    scaleY: [1, 1.12, 0.92, 0.94, 1.1, 1],
    opacity: 1,
    transition: { duration: 0.9, times: [0, 0.18, 0.42, 0.55, 0.8, 1], repeat: 2, ease: "easeOut" },
  },
  disappointed: { x: 10, rotate: 4, scaleX: 0.94, scaleY: 0.96, opacity: 1, transition: gentle },
  waving: {
    rotate: [0, -12, 5, -12, 0], scaleX: [1, 1.04, 1, 1.04, 1], opacity: 1,
    transition: { duration: 0.9, ease: "easeInOut" },
  },
};

const blink = {
  animate: { scaleY: [1, 1, 0.1, 1] },
  transition: { duration: 4, times: [0, 0.9, 0.95, 1], repeat: Infinity },
};

/** Face turned toward the screen: both eyes sit on the left half. */
function Eye({ x }: Readonly<{ x: number }>) {
  const sleeping = useNook((s) => s.avatar) === "sleeping";
  return (
    <motion.div
      animate={sleeping ? { scaleY: 0.1 } : blink.animate}
      transition={sleeping ? lazy : blink.transition}
      style={{
        position: "absolute", top: 24, left: x,
        width: 8, height: 10, borderRadius: 6, background: "var(--ink)",
      }}
    >
      <div style={{
        position: "absolute", top: 2, left: 2, width: 3, height: 3,
        borderRadius: "50%", background: "rgba(255, 255, 255, 0.85)",
      }} />
    </motion.div>
  );
}

export default function Companion() {
  const avatar = useNook((s) => s.avatar);
  const breakDue = useNook((s) => s.breakDue);
  const bubble = bubbleCopy[avatar];

  return (
    <div style={{
      height: "100%", display: "flex", alignItems: "center", justifyContent: "flex-end",
      background: "transparent",
    }}>
      <AnimatePresence>
        {bubble && (
          <motion.div
            key={avatar}
            className="glass"
            initial={{ opacity: 0, x: 10, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 6, scale: 0.96 }}
            transition={gentle}
            style={{
              position: "relative", maxWidth: 280, marginRight: "var(--s4)",
              padding: "var(--s4) var(--s5)", fontSize: "var(--text-md)", lineHeight: 1.45,
              borderRadius: "var(--radius-md)",
            }}
          >
            {bubble}
            {breakDue && (
              <motion.button
                {...press}
                style={{ display: "block", marginTop: "var(--s3)", padding: "var(--s2) var(--s5)", fontSize: "var(--text-sm)" }}
                onClick={() => invoke("open_break_window")}
              >
                Take the break
              </motion.button>
            )}
            {/* tail pointing at the creature */}
            <div style={{
              position: "absolute", right: -5, top: "50%", width: 10, height: 10,
              transform: "translateY(-50%) rotate(45deg)", borderRadius: 2,
              background: "var(--glass)",
              borderTop: "1px solid var(--glass-border)",
              borderRight: "1px solid var(--glass-border)",
            }} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* placeholder creature — replace with Rive */}
      <motion.div
        animate={bodyAnim[avatar] ?? bodyAnim.idle}
        style={{
          width: 76, height: 66, position: "relative", flexShrink: 0,
          marginRight: -PEEK,
          transformOrigin: "100% 50%",
          // rounder on the face side, flatter toward the edge it emerges from
          borderRadius: "52% 44% 44% 52% / 58% 52% 48% 55%",
          background:
            "radial-gradient(circle at 30% 30%, rgba(255, 236, 219, 0.9), transparent 55%), " +
            "linear-gradient(200deg, var(--dawn), var(--lagoon))",
          boxShadow: "inset 0 -8px 14px rgba(15, 30, 40, 0.14), inset 0 3px 6px rgba(255, 255, 255, 0.45)",
          filter: "drop-shadow(-8px 10px 10px rgba(15, 30, 40, 0.28))",
        }}
      >
        <Eye x={10} />
        <Eye x={28} />
        {/* cheeks */}
        <div style={{
          position: "absolute", top: 35, left: 3, width: 10, height: 6,
          borderRadius: "50%", background: "rgba(214, 120, 90, 0.4)", filter: "blur(1px)",
        }} />
        <div style={{
          position: "absolute", top: 35, left: 33, width: 10, height: 6,
          borderRadius: "50%", background: "rgba(214, 120, 90, 0.4)", filter: "blur(1px)",
        }} />
      </motion.div>
    </div>
  );
}
