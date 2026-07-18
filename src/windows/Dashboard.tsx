import { useState } from "react";
import { motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { cardLift, enter, gentle, press } from "../motion/springs";
import { meshFor, useNook, type DaySignal, type Settings } from "../state/store";

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
  daySignal, settingsOpen, onToggleSettings,
}: Readonly<{
  daySignal: DaySignal;
  settingsOpen: boolean;
  onToggleSettings: () => void;
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
        <motion.button className="veil" {...press} onClick={onToggleSettings}>
          {settingsOpen ? "Close" : "Rhythm"}
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

function FocusBlock({ focusSeconds, settings }: Readonly<{ focusSeconds: number; settings: Settings }>) {
  const target = Math.max(settings.focusMinutes, 1) * 60;
  const value = Math.min(focusSeconds / target, 1);
  const nextInMin = Math.ceil(Math.max(target - focusSeconds, 0) / 60);
  return (
    <motion.section
      {...enter}
      transition={{ ...gentle, delay: 0.08 }}
      {...cardLift}
      className="glass"
      style={{ marginTop: "var(--s5)", padding: "var(--s6)", display: "grid", gap: "var(--s5)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--s4)" }}>
        <span className="t-label">This block</span>
        <span className="t-soft">
          {value < 1 ? `break in ${nextInMin} min` : "your companion is on the way"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s3)" }}>
        <span className="t-num">{formatElapsed(focusSeconds)}</span>
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

function Stat({ label, value, color, bar }: Readonly<{
  label: string; value: string; color?: string; bar?: number;
}>) {
  return (
    <div style={{ display: "grid", gap: "var(--s2)", justifyItems: "start" }}>
      <span className="t-data" style={color ? { color } : undefined}>{value}</span>
      {bar !== undefined && (
        <div style={{ width: 56, height: 3, borderRadius: "var(--radius-pill)", background: "var(--accent-soft)" }}>
          <div style={{ width: `${bar * 100}%`, height: "100%", borderRadius: "inherit", background: "var(--accent)" }} />
        </div>
      )}
      <span className="t-label">{label}</span>
    </div>
  );
}

function Field({
  label, hint, value, min, max, step = 1, onChange,
}: Readonly<{
  label: string; hint: string; value: number; min: number; max: number; step?: number;
  onChange: (n: number) => void;
}>) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label style={{ display: "grid", gap: "var(--s2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--s3)" }}>
        <span style={{ fontWeight: 500 }}>{label}</span>
        <span className="t-data" style={{ color: "var(--accent)" }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          background: `linear-gradient(90deg, var(--accent) ${pct}%, var(--accent-soft) ${pct}%)`,
        }}
      />
      <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>{hint}</span>
    </label>
  );
}

function SettingsPanel({
  draft, setDraft, onSave, saving,
}: Readonly<{
  draft: Settings;
  setDraft: (s: Settings) => void;
  onSave: () => void;
  saving: boolean;
}>) {
  return (
    <motion.section
      {...enter}
      {...cardLift}
      className="glass"
      style={{ marginTop: "var(--s5)", padding: "var(--s6)", display: "grid", gap: "var(--s5)" }}
    >
      <div>
        <h2 style={{ fontSize: "var(--text-lg)" }}>Rhythm</h2>
        <p className="t-soft" style={{ marginTop: "var(--s2)" }}>
          How long you focus, how long you break, and when stillness counts as rest.
        </p>
      </div>

      <Field
        label="Focus (minutes)"
        hint="Active time before the companion asks for a break"
        value={draft.focusMinutes}
        min={1}
        max={120}
        onChange={(focusMinutes) => setDraft({ ...draft, focusMinutes })}
      />
      <Field
        label="Break (seconds)"
        hint="Countdown length once you take the break"
        value={draft.breakSeconds}
        min={30}
        max={900}
        step={30}
        onChange={(breakSeconds) => setDraft({ ...draft, breakSeconds })}
      />
      <Field
        label="Idle rest (seconds)"
        hint="After this of no input, focus resets — idle counts as a rest"
        value={draft.idleSeconds}
        min={60}
        max={1800}
        step={30}
        onChange={(idleSeconds) => setDraft({ ...draft, idleSeconds })}
      />

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <motion.button {...press} disabled={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save rhythm"}
        </motion.button>
      </div>
    </motion.section>
  );
}

export default function Dashboard() {
  const { daySignal, focusSeconds, streak, settings, setSettings } = useNook();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);

  const toggleSettings = () => {
    if (!open) setDraft(settings);
    setOpen(!open);
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await invoke<Settings>("update_settings", { settings: draft });
      setSettings(next);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ height: "100%", background: "var(--surface)", padding: "var(--s6)", overflowY: "auto" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <Scene daySignal={daySignal} settingsOpen={open} onToggleSettings={toggleSettings} />
        <FocusBlock focusSeconds={focusSeconds} settings={settings} />

        <motion.section
          {...enter}
          transition={{ ...gentle, delay: 0.16 }}
          style={{ marginTop: "var(--s5)", display: "flex", gap: "var(--s8)", padding: "0 var(--s2)" }}
        >
          <Stat label="Day streak" value={String(streak)} color="var(--sage)" />
          {/* hydration & energy are hardwired until their tracking lands (roadmap #6) */}
          <Stat label="Hydration" value="40%" bar={0.4} />
          <Stat label="Energy" value="70%" bar={0.7} />
        </motion.section>

        {open && (
          <SettingsPanel draft={draft} setDraft={setDraft} onSave={save} saving={saving} />
        )}
      </div>
    </div>
  );
}
