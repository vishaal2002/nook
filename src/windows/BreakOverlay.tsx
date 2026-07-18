import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { breathe, enter, press } from "../motion/springs";
import { meshFor, useNook } from "../state/store";

function useCountdown(total: number, onDone: () => void) {
  const [left, setLeft] = useState(total);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    setLeft(total);
  }, [total]);

  useEffect(() => {
    if (left <= 0) {
      done.current();
      return;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  return left;
}

interface Particle {
  id: number;
  x: number;
  size: number;
  blur: number;
  peak: number;
  sway: number;
  dur: number;
  delay: number;
}

/** Two tiers: fine dust motes plus larger out-of-focus bokeh discs. */
function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const bokeh = i % 5 === 0;
    const dustBlur = Math.random() < 0.4 ? 1 : 0;
    return {
      id: i,
      x: Math.random() * 100,
      size: bokeh ? 10 + Math.random() * 8 : 2 + Math.random() * 4,
      blur: bokeh ? 3 + Math.random() * 3 : dustBlur,
      peak: bokeh ? 0.18 + Math.random() * 0.12 : 0.25 + Math.random() * 0.4,
      sway: (Math.random() - 0.5) * 60,
      dur: 14 + Math.random() * 16,
      delay: Math.random() * 12,
    };
  });
}

export default function BreakOverlay() {
  const daySignal = useNook((s) => s.daySignal);
  const breakSeconds = useNook((s) => s.settings.breakSeconds);
  const grad = meshFor(daySignal);

  const closed = useRef(false);
  const close = (skipped: boolean) => {
    if (closed.current) return;
    closed.current = true;
    invoke("close_break_window", { skipped });
  };

  const left = useCountdown(breakSeconds, () => close(false));
  const mm = String(Math.floor(left / 60)).padStart(1, "0");
  const ss = String(left % 60).padStart(2, "0");

  const particles = useMemo(() => makeParticles(18), []);

  return (
    <div
      className={grad}
      style={{ height: "100%", display: "grid", placeItems: "center", position: "relative", overflow: "hidden", color: "var(--foam)" }}
    >
      {/* ambient light drift — slow enough to read as atmosphere, not motion */}
      <motion.div
        animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0], scale: [1, 1.08, 0.96, 1] }}
        transition={{ duration: 38, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute", width: "55vw", height: "55vw", left: "-12vw", top: "-18vw",
          borderRadius: "50%", background: "radial-gradient(circle, rgba(255, 255, 255, 0.1), transparent 60%)",
          filter: "blur(40px)",
        }}
      />
      <motion.div
        animate={{ x: [0, -30, 20, 0], y: [0, 24, -18, 0], scale: [1, 0.94, 1.06, 1] }}
        transition={{ duration: 46, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute", width: "60vw", height: "60vw", right: "-15vw", bottom: "-25vw",
          borderRadius: "50%", background: "radial-gradient(circle, rgba(10, 20, 30, 0.18), transparent 60%)",
          filter: "blur(48px)",
        }}
      />

      {particles.map((p) => (
        <motion.span
          key={p.id}
          initial={{ y: "105vh", opacity: 0 }}
          animate={{ y: "-10vh", x: [0, p.sway, 0], opacity: [0, p.peak, p.peak * 0.6, 0] }}
          transition={{
            duration: p.dur, delay: p.delay, repeat: Infinity, ease: "linear",
            x: { duration: p.dur, delay: p.delay, repeat: Infinity, ease: "easeInOut" },
            opacity: { duration: p.dur, delay: p.delay, repeat: Infinity, times: [0, 0.2, 0.7, 1] },
          }}
          style={{
            position: "absolute", left: `${p.x}%`, width: p.size, height: p.size,
            borderRadius: "50%", background: "rgba(255, 255, 255, 0.8)",
            filter: p.blur ? `blur(${p.blur}px)` : undefined,
          }}
        />
      ))}

      <motion.div {...enter} style={{ position: "relative", display: "grid", placeItems: "center", gap: "var(--s6)", textAlign: "center" }}>
        <div style={{ position: "relative", width: 220, height: 220, display: "grid", placeItems: "center" }}>
          {/* static guide ring marks the full-inhale size */}
          <div style={{
            position: "absolute", inset: -39, borderRadius: "50%",
            border: "1px solid rgba(255, 255, 255, 0.18)",
          }} />
          {/* halo, breathing in sync behind the sphere */}
          <motion.div
            {...breathe}
            style={{
              position: "absolute", inset: -20, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255, 255, 255, 0.22), transparent 65%)",
              filter: "blur(18px)",
            }}
          />
          {/* the sphere: lit top-left, self-shadowed base, rim light */}
          <motion.div
            {...breathe}
            style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              background:
                "radial-gradient(circle at 32% 26%, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.18) 38%, rgba(255, 255, 255, 0.04) 62%, rgba(255, 255, 255, 0.14) 100%)",
              border: "1px solid rgba(255, 255, 255, 0.4)",
              boxShadow:
                "inset 0 -18px 32px rgba(10, 20, 30, 0.18), inset 0 12px 22px rgba(255, 255, 255, 0.28), 0 18px 48px rgba(10, 20, 30, 0.18)",
            }}
          />
          <motion.div
            animate={{ opacity: [0.55, 1, 1, 0.55] }}
            transition={{ duration: 14, times: [0, 0.29, 0.43, 1], repeat: Infinity, ease: "easeInOut" }}
            style={{ position: "relative", font: "600 var(--text-lg) var(--font-body)" }}
          >
            breathe
          </motion.div>
        </div>

        <div style={{
          font: "600 var(--text-countdown) var(--font-display)",
          fontVariantNumeric: "tabular-nums", lineHeight: 1,
          textShadow: "0 4px 32px rgba(10, 20, 30, 0.25)",
        }}>
          {mm}:{ss}
        </div>
        <p style={{ opacity: 0.8, fontSize: "var(--text-lg)" }}>Look at something far away. Unclench your jaw.</p>

        <motion.button className="veil" {...press} onClick={() => close(true)}>
          Skip this one
        </motion.button>
      </motion.div>

      {/* film grain over everything, kills gradient banding */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "var(--grain)", backgroundSize: "140px 140px",
        opacity: 0.06, mixBlendMode: "overlay",
      }} />
    </div>
  );
}
