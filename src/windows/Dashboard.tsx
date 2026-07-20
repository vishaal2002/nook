import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cardLift, enter, gentle, press } from "../motion/springs";
import { meshFor, useNook, type DaySignal, type Settings, type Stats } from "../state/store";
import {
  ACHIEVEMENTS, achievementDef, dayStats, formatClockTime, formatDuration,
  formatMinutesLabel, glowMood, glowScore, glowScoreFor, lastSevenDays, todayStats,
} from "../lib/gamification";
import RhythmSheet from "./RhythmSheet";

const greetings = {
  dawn: "Early light. Gentle start.",
  day: "Good rhythm today.",
  dusk: "The day is softening.",
  night: "Still up? Let's keep it kind.",
};

function formatElapsed(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Animate a number toward its target — the score ticks up, never teleports. */
function useCountUp(target: number, ms = 700) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf: number;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - t0) / ms, 1);
      const e = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (target - from) * e));
      if (t < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/* ── Day arc: the whole day drawn as one curve, the companion carries the
      "now" marker across it. Makes daySignal visible instead of implied. ── */

const ARC = { p0: { x: 0, y: 64 }, p1: { x: 300, y: 4 }, p2: { x: 600, y: 64 } };

function arcPoint(t: number) {
  const u = 1 - t;
  return {
    x: u * u * ARC.p0.x + 2 * u * t * ARC.p1.x + t * t * ARC.p2.x,
    y: u * u * ARC.p0.y + 2 * u * t * ARC.p1.y + t * t * ARC.p2.y,
  };
}

// daySignal boundaries from computeDaySignal: 6h / 9h / 17h / 21h
const PHASE_HOURS = [6, 9, 17, 21];

function DayArc() {
  const now = new Date();
  const pos = arcPoint((now.getHours() * 60 + now.getMinutes()) / (24 * 60));
  return (
    <svg viewBox="0 0 600 84" style={{ width: "100%", display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="mini-blob" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--dawn)" />
          <stop offset="100%" stopColor="var(--lagoon)" />
        </linearGradient>
      </defs>
      <path
        d={`M ${ARC.p0.x} ${ARC.p0.y} Q ${ARC.p1.x} ${ARC.p1.y} ${ARC.p2.x} ${ARC.p2.y}`}
        fill="none" stroke="rgba(250, 251, 250, 0.28)" strokeWidth="1.5"
      />
      {PHASE_HOURS.map((h) => {
        const p = arcPoint(h / 24);
        return <circle key={h} cx={p.x} cy={p.y} r="2" fill="rgba(250, 251, 250, 0.4)" />;
      })}
      <motion.g
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <ellipse cx={pos.x} cy={pos.y - 7} rx="11" ry="9" fill="url(#mini-blob)" />
        <circle cx={pos.x - 3.5} cy={pos.y - 9} r="1.4" fill="var(--ink)" />
        <circle cx={pos.x + 3.5} cy={pos.y - 9} r="1.4" fill="var(--ink)" />
      </motion.g>
    </svg>
  );
}

function Scene({
  daySignal, settings, onOpenRhythm,
}: Readonly<{
  daySignal: DaySignal;
  settings: Settings;
  onOpenRhythm: () => void;
}>) {
  return (
    <motion.section
      {...enter}
      className={meshFor(daySignal)}
      style={{
        position: "relative", overflow: "hidden", borderRadius: "var(--radius-lg)",
        padding: "var(--s6)", color: "var(--foam)", boxShadow: "var(--shadow-glass)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--s5)" }}>
        <div>
          <p className="t-label" style={{ color: "rgba(250, 251, 250, 0.7)" }}>
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="t-hero" style={{ marginTop: "var(--s2)", textShadow: "0 2px 24px rgba(10, 20, 30, 0.25)" }}>
            {greetings[daySignal]}
          </h1>
        </div>
        <motion.button
          className="veil"
          {...press}
          onClick={onOpenRhythm}
          style={{ display: "grid", gap: 1, textAlign: "left", padding: "var(--s2) var(--s4)" }}
        >
          <span style={{ fontWeight: 600 }}>Rhythm</span>
          <span style={{ fontSize: "var(--text-xs)", opacity: 0.85 }}>
            {settings.focusMinutes} min · {formatMinutesLabel(settings.breakSeconds)}
          </span>
        </motion.button>
      </div>
      <div style={{ marginTop: "var(--s6)" }}>
        <DayArc />
      </div>
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "var(--grain)", backgroundSize: "140px 140px",
        opacity: 0.06, mixBlendMode: "overlay",
      }} />
    </motion.section>
  );
}

/* ── Glow: the daily score, drawn as a ring (the view's one hero figure) ── */

function GlowCard({ stats }: Readonly<{ stats: Stats | null }>) {
  const score = glowScore(stats);
  const shown = useCountUp(score);
  const mood = glowMood(score);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const delta = score - glowScoreFor(dayStats(stats, yKey));
  let deltaChip = "even with yesterday";
  if (delta > 0) deltaChip = `▲ ${delta} vs yesterday`;
  if (delta < 0) deltaChip = `▼ ${Math.abs(delta)} vs yesterday`;
  let deltaColor = "var(--text-soft)";
  if (delta > 0) deltaColor = "var(--score-high)";
  if (delta < 0) deltaColor = "var(--score-low)";

  const R = 56;
  const C = 2 * Math.PI * R;

  return (
    <motion.section
      {...enter}
      transition={{ ...gentle, delay: 0.06 }}
      {...cardLift}
      className="glass"
      style={{
        padding: "var(--s5) var(--s6)", display: "flex", alignItems: "center",
        gap: "var(--s5)", minWidth: 0,
      }}
    >
      <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
        <svg viewBox="0 0 132 132" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
          <circle cx="66" cy="66" r={R} fill="none" stroke="var(--accent-soft)" strokeWidth="11" />
          <motion.circle
            cx="66" cy="66" r={R} fill="none"
            stroke={mood.color} strokeWidth="11" strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - score / 100) }}
            transition={{ ...gentle, delay: 0.15 }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          textAlign: "center",
        }}>
          <div>
            <div style={{ font: "600 40px/1 var(--font-display)", letterSpacing: "-0.02em" }}>
              {shown}
            </div>
            <div className="t-label" style={{ marginTop: 3 }}>glow</div>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: "var(--s2)", minWidth: 0 }}>
        <span style={{ font: "600 var(--text-lg)/1.2 var(--font-display)" }}>{mood.word}</span>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: deltaColor }}>{deltaChip}</span>
        <span className="t-soft" style={{ fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
          Breaks +10 · skips −12 · a live streak keeps it warm. It resets to 60 each morning.
        </span>
      </div>
    </motion.section>
  );
}

function FocusBlock({ focusSeconds, settings }: Readonly<{ focusSeconds: number; settings: Settings }>) {
  const target = Math.max(settings.focusMinutes, 1) * 60;
  const value = Math.min(focusSeconds / target, 1);
  const nextInMin = Math.ceil(Math.max(target - focusSeconds, 0) / 60);
  return (
    <motion.section
      {...enter}
      transition={{ ...gentle, delay: 0.1 }}
      {...cardLift}
      className="glass"
      style={{ padding: "var(--s5) var(--s6)", display: "grid", gap: "var(--s4)", alignContent: "center", minWidth: 0 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--s4)" }}>
        <span className="t-label">This block</span>
        <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>
          {value < 1 ? `Nook walks over in ${nextInMin} min` : "Nook is on the way"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s3)" }}>
        <span style={{
          font: "600 var(--text-2xl)/1 var(--font-display)",
          fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em",
        }}>
          {formatElapsed(focusSeconds)}
        </span>
        <span className="t-soft">of {settings.focusMinutes} min</span>
      </div>

      <div style={{ position: "relative", height: 6, borderRadius: "var(--radius-pill)", background: "var(--accent-soft)" }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value * 100}%` }}
          transition={gentle}
          style={{
            position: "absolute", top: 0, bottom: 0, left: 0,
            borderRadius: "var(--radius-pill)",
            background: "linear-gradient(90deg, var(--lagoon), var(--sage))",
            minWidth: focusSeconds > 0 ? 6 : 0,
          }}
        />
        {/* the break waits at the end of the track */}
        <div style={{
          position: "absolute", right: -2, top: "50%", transform: "translateY(-50%)",
          width: 10, height: 10, borderRadius: "50%",
          border: "2px solid var(--accent)", background: "var(--surface-raised)",
        }} />
      </div>
    </motion.section>
  );
}

/* ── KPI row: today's headline numbers in one segmented card ── */

function Kpi({ label, value, sub }: Readonly<{ label: string; value: string; sub: string }>) {
  return (
    <div style={{ display: "grid", gap: "var(--s1)", padding: "var(--s4) var(--s5)", minWidth: 0 }}>
      <span className="t-label">{label}</span>
      <span style={{ font: "600 26px/1.1 var(--font-display)", letterSpacing: "-0.02em" }}>{value}</span>
      <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>{sub}</span>
    </div>
  );
}

function KpiRow({ stats }: Readonly<{ stats: Stats | null }>) {
  const today = todayStats(stats);
  const streak = stats?.streak ?? 0;
  const best = stats?.bestStreak ?? 0;
  return (
    <motion.section
      {...enter}
      transition={{ ...gentle, delay: 0.14 }}
      className="glass"
      style={{
        marginTop: "var(--s5)", display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      }}
    >
      <Kpi label="Focused today" value={formatDuration(today.focusSeconds)} sub="active time at the keys" />
      <Kpi label="Breaks taken" value={String(today.taken)} sub="+10 glow each" />
      <Kpi label="Skipped" value={String(today.skipped)} sub="−12 glow each" />
      <Kpi
        label="Streak"
        value={streak > 0 ? `${streak} 🔥` : "0"}
        sub={best > 0 ? `best ${best} days` : "take a break to start one"}
      />
    </motion.section>
  );
}

/* ── Weekly chart: focused time per day, one series, today emphasized ── */

function niceMax(v: number): number {
  const steps = [60, 120, 180, 240, 300, 360, 480, 600, 720];
  for (const s of steps) {
    if (v <= s) return s;
  }
  return Math.ceil(v / 120) * 120;
}

function fmtTick(min: number): string {
  if (min === 0) return "0";
  if (min % 60 === 0) return `${min / 60}h`;
  if (min > 60) return `${(min / 60).toFixed(1)}h`;
  return `${min}m`;
}

function barPath(x: number, yTop: number, w: number, h: number): string {
  const r = Math.min(4, h);
  return [
    `M${x},${yTop + h}`,
    `v${-(h - r)}`,
    `q0,${-r} ${r},${-r}`,
    `h${w - 2 * r}`,
    `q${r},0 ${r},${r}`,
    `v${h - r}`,
    "z",
  ].join(" ");
}

const CHART = { w: 560, h: 190, padL: 40, padR: 10, padT: 22, padB: 26 };

function WeeklyChart({ stats }: Readonly<{ stats: Stats | null }>) {
  const [hover, setHover] = useState<number | null>(null);
  const keys = lastSevenDays();
  const data = keys.map((k) => ({ key: k, ...dayStats(stats, k) }));
  const top = niceMax(Math.max(...data.map((d) => d.focusSeconds / 60)));
  const empty = data.every((d) => d.focusSeconds === 0);

  const plotW = CHART.w - CHART.padL - CHART.padR;
  const plotH = CHART.h - CHART.padT - CHART.padB;
  const baseline = CHART.h - CHART.padB;
  const slot = plotW / 7;
  const barW = 22;

  const hovered = hover === null ? null : data[hover];

  return (
    <motion.section
      {...enter}
      transition={{ ...gentle, delay: 0.18 }}
      className="glass"
      style={{ marginTop: "var(--s5)", padding: "var(--s5) var(--s6)", display: "grid", gap: "var(--s3)" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--s4)" }}>
        <div>
          <h2 style={{ fontSize: "var(--text-md)" }}>Your week</h2>
          <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>Focused time per day</span>
        </div>
        {empty && (
          <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>
            Focus time shows up here as you work
          </span>
        )}
      </div>

      <div style={{ position: "relative" }}>
        {hovered && hover !== null && (
          <div
            className="glass"
            style={{
              position: "absolute", top: -6, zIndex: 5, pointerEvents: "none",
              left: `${((CHART.padL + slot * hover + slot / 2) / CHART.w) * 100}%`,
              transform: "translateX(-50%)",
              padding: "var(--s2) var(--s3)", borderRadius: "var(--radius-sm)",
              whiteSpace: "nowrap", fontSize: "var(--text-xs)",
            }}
          >
            <strong>
              {new Date(`${hovered.key}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}
            </strong>
            {" · "}{formatDuration(hovered.focusSeconds)} focused
            {" · "}{hovered.taken} {hovered.taken === 1 ? "break" : "breaks"}
            {hovered.skipped > 0 && ` · ${hovered.skipped} skipped`}
          </div>
        )}
        <svg viewBox={`0 0 ${CHART.w} ${CHART.h}`} style={{ width: "100%", display: "block" }}>
          {[0, top / 2, top].map((t) => {
            const y = baseline - (t / top) * plotH;
            return (
              <g key={t}>
                <line
                  x1={CHART.padL} x2={CHART.w - CHART.padR} y1={y} y2={y}
                  stroke="color-mix(in srgb, var(--text) 11%, transparent)" strokeWidth="1"
                />
                <text
                  x={CHART.padL - 8} y={y + 3} textAnchor="end"
                  style={{ font: "500 10px var(--font-data)", fill: "var(--text-soft)" }}
                >
                  {fmtTick(t)}
                </text>
              </g>
            );
          })}

          {data.map((d, i) => {
            const min = d.focusSeconds / 60;
            const h = Math.max((min / top) * plotH, min > 0 ? 3 : 0);
            const x = CHART.padL + slot * i + (slot - barW) / 2;
            const isToday = i === 6;
            const dayLabel = new Date(`${d.key}T12:00:00`)
              .toLocaleDateString(undefined, { weekday: "short" })
              .slice(0, 2);
            let opacity = 1;
            if (hover !== null && hover !== i) opacity = 0.5;
            return (
              <g key={d.key}>
                {h > 0 && (
                  <motion.path
                    d={barPath(x, baseline - h, barW, h)}
                    fill="var(--chart-ink)"
                    initial={{ opacity: 0 }}
                    animate={{ opacity }}
                    transition={{ ...gentle, delay: 0.2 + i * 0.04 }}
                  />
                )}
                {h === 0 && (
                  <rect
                    x={x} y={baseline - 2} width={barW} height={2} rx={1}
                    fill="var(--accent-soft)"
                  />
                )}
                {isToday && min > 0 && (
                  <text
                    x={x + barW / 2} y={baseline - h - 7} textAnchor="middle"
                    style={{ font: "600 10.5px var(--font-body)", fill: "var(--text)" }}
                  >
                    {formatDuration(d.focusSeconds)}
                  </text>
                )}
                <text
                  x={x + barW / 2} y={baseline + 17} textAnchor="middle"
                  style={{
                    font: `${isToday ? 600 : 400} 10.5px var(--font-body)`,
                    fill: isToday ? "var(--text)" : "var(--text-soft)",
                  }}
                >
                  {dayLabel}
                </text>
                <rect
                  x={CHART.padL + slot * i} y={CHART.padT - 10} width={slot} height={plotH + 10}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </motion.section>
  );
}

/* ── Today's breaks + badges ── */

function TodayBreaks({ stats }: Readonly<{ stats: Stats | null }>) {
  const todayPrefix = lastSevenDays()[6];
  const events = (stats?.recent ?? [])
    .filter((e) => e.at.startsWith(todayPrefix))
    .slice(-8)
    .reverse();

  return (
    <motion.section
      {...enter}
      transition={{ ...gentle, delay: 0.22 }}
      className="glass"
      style={{ padding: "var(--s5) var(--s6)", display: "grid", gap: "var(--s3)", alignContent: "start" }}
    >
      <h2 style={{ fontSize: "var(--text-md)" }}>Today's breaks</h2>
      {events.length === 0 && (
        <p className="t-soft" style={{ fontSize: "var(--text-sm)" }}>
          Nothing yet — your first break of the day lands here.
        </p>
      )}
      {events.map((e) => (
        <div key={e.at} style={{ display: "flex", alignItems: "center", gap: "var(--s3)" }}>
          <span
            aria-hidden
            style={{
              width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
              display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
              background: e.skipped ? "color-mix(in srgb, var(--text) 8%, transparent)" : "var(--accent-soft)",
              color: e.skipped ? "var(--text-soft)" : "var(--accent)",
            }}
          >
            {e.skipped ? "✕" : "✓"}
          </span>
          <span style={{ fontSize: "var(--text-sm)" }}>
            {e.skipped ? "Skipped" : "Break taken"}
          </span>
          <span className="t-data" style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--text-soft)" }}>
            {formatClockTime(e.at)}
          </span>
        </div>
      ))}
    </motion.section>
  );
}

function Badges({ stats }: Readonly<{ stats: Stats | null }>) {
  const unlocked = new Set((stats?.achievements ?? []).map((a) => a.slug));
  return (
    <motion.section
      {...enter}
      transition={{ ...gentle, delay: 0.26 }}
      className="glass"
      style={{ padding: "var(--s5) var(--s6)", display: "grid", gap: "var(--s4)", alignContent: "start" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: "var(--text-md)" }}>Badges</h2>
        <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>
          {unlocked.size} of {ACHIEVEMENTS.length}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s3) var(--s4)" }}>
        {ACHIEVEMENTS.map((a) => {
          const got = unlocked.has(a.slug);
          return (
            <div
              key={a.slug}
              title={a.desc}
              style={{
                display: "flex", gap: "var(--s3)", alignItems: "center", minWidth: 0,
                opacity: got ? 1 : 0.4, filter: got ? "none" : "grayscale(1)",
                transition: "opacity 0.3s ease, filter 0.3s ease",
              }}
            >
              <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden>{a.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{a.name}</div>
                <div className="t-soft" style={{
                  fontSize: "var(--text-xs)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {a.desc}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.section>
  );
}

function AchievementToast() {
  const slug = useNook((s) => s.achievement);
  const def = slug ? achievementDef(slug) : undefined;
  return (
    <AnimatePresence>
      {def && (
        <motion.div
          key={def.slug}
          className="glass"
          initial={{ opacity: 0, y: 24, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={gentle}
          style={{
            position: "fixed", right: 24, bottom: 24, zIndex: 50,
            display: "flex", gap: "var(--s3)", alignItems: "center",
            padding: "var(--s4) var(--s5)", maxWidth: 300,
          }}
        >
          <motion.span
            aria-hidden
            style={{ fontSize: 28 }}
            animate={{ rotate: [0, -12, 10, 0], scale: [1, 1.2, 1] }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            {def.emoji}
          </motion.span>
          <div>
            <div className="t-label">Badge unlocked</div>
            <div style={{ fontWeight: 600, marginTop: 2 }}>{def.name}</div>
            <div className="t-soft" style={{ fontSize: "var(--text-xs)" }}>{def.desc}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function Dashboard() {
  const { daySignal, focusSeconds, settings, stats } = useNook();
  const [rhythmOpen, setRhythmOpen] = useState(false);

  return (
    <div style={{ height: "100%", background: "var(--surface)", overflowY: "auto" }}>
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "var(--s6)" }}>
        <Scene daySignal={daySignal} settings={settings} onOpenRhythm={() => setRhythmOpen(true)} />

        <div style={{
          marginTop: "var(--s5)", display: "grid", gap: "var(--s5)",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        }}>
          <GlowCard stats={stats} />
          <FocusBlock focusSeconds={focusSeconds} settings={settings} />
        </div>

        <KpiRow stats={stats} />
        <WeeklyChart stats={stats} />

        <div style={{
          marginTop: "var(--s5)", display: "grid", gap: "var(--s5)",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          paddingBottom: "var(--s6)",
        }}>
          <TodayBreaks stats={stats} />
          <Badges stats={stats} />
        </div>
      </div>

      <AnimatePresence>
        {rhythmOpen && <RhythmSheet onClose={() => setRhythmOpen(false)} />}
      </AnimatePresence>
      <AchievementToast />
    </div>
  );
}
