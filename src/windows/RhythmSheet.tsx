import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { gentle, press } from "../motion/springs";
import { useNook, type Settings } from "../state/store";
import { formatMinutesLabel } from "../lib/gamification";
import { greet, isMuted, primeAudio, setMuted } from "../lib/sound";

/**
 * Rhythm — the break schedule, redesigned to explain itself: named presets,
 * a live picture of one focus→break cycle, and three plainly-worded dials.
 */

interface Preset {
  name: string;
  hint: string;
  focusMinutes: number;
  breakSeconds: number;
}

const PRESETS: Preset[] = [
  { name: "Pomodoro", hint: "25 min · 5 min", focusMinutes: 25, breakSeconds: 300 },
  { name: "Flow", hint: "50 min · 2 min", focusMinutes: 50, breakSeconds: 120 },
  { name: "Marathon", hint: "90 min · 5 min", focusMinutes: 90, breakSeconds: 300 },
];

function CyclePreview({ draft }: Readonly<{ draft: Settings }>) {
  const focusSec = draft.focusMinutes * 60;
  // Keep the break sliver readable even when it's tiny next to the block.
  const breakShare = Math.max(draft.breakSeconds / (focusSec + draft.breakSeconds), 0.06);
  const perDay = Math.max(Math.round((8 * 60) / (draft.focusMinutes + draft.breakSeconds / 60)), 1);

  return (
    <div style={{ display: "grid", gap: "var(--s2)" }}>
      <div style={{ display: "flex", height: 44, gap: 3 }}>
        <motion.div
          layout
          transition={gentle}
          style={{
            flex: 1 - breakShare, borderRadius: "12px 4px 4px 12px",
            background: "var(--accent-soft)",
            border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 6, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
            {draft.focusMinutes} min
          </span>
          <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>focus</span>
        </motion.div>
        <motion.div
          layout
          transition={gentle}
          title={`${formatMinutesLabel(draft.breakSeconds)} break`}
          style={{
            flex: breakShare, borderRadius: "4px 12px 12px 4px",
            background: "var(--accent)", minWidth: 34,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--foam)" }}>
            {formatMinutesLabel(draft.breakSeconds)}
          </span>
        </motion.div>
      </div>
      <p className="t-soft" style={{ fontSize: "var(--text-xs)" }}>
        Nook walks over every {draft.focusMinutes} minutes for a{" "}
        {formatMinutesLabel(draft.breakSeconds)} breather — about {perDay} breaks across a
        typical workday. Repeat all day.
      </p>
    </div>
  );
}

function Dial({
  icon, label, hint, valueLabel, value, min, max, step, onChange,
}: Readonly<{
  icon: string; label: string; hint: string; valueLabel: string;
  value: number; min: number; max: number; step: number;
  onChange: (n: number) => void;
}>) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label style={{ display: "grid", gap: "var(--s2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
        <span aria-hidden style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{label}</span>
        <span
          className="t-data"
          style={{ marginLeft: "auto", color: "var(--accent)", fontSize: "var(--text-sm)" }}
        >
          {valueLabel}
        </span>
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

function SoundToggle() {
  const [on, setOn] = useState(!isMuted());
  const toggle = () => {
    const next = !on;
    setOn(next);
    setMuted(!next);
    if (next) {
      primeAudio();
      greet();
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      style={{
        display: "flex", alignItems: "center", gap: "var(--s3)", width: "100%",
        padding: "var(--s3) var(--s4)", borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)", color: "var(--text)",
        boxShadow: "none", textAlign: "left", fontWeight: 500,
      }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>{on ? "🔊" : "🔇"}</span>
      <span style={{ display: "grid", gap: 1, flex: 1 }}>
        <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>Sound effects</span>
        <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>
          Soft footsteps and chimes as Nook moves
        </span>
      </span>
      <span
        aria-hidden
        style={{
          width: 40, height: 24, borderRadius: 999, flexShrink: 0, position: "relative",
          background: on ? "var(--accent)" : "color-mix(in srgb, var(--text) 22%, transparent)",
          transition: "background 0.2s ease",
        }}
      >
        <span style={{
          position: "absolute", top: 3, left: on ? 19 : 3, width: 18, height: 18,
          borderRadius: "50%", background: "var(--foam)",
          boxShadow: "0 1px 3px rgba(15,30,40,0.3)", transition: "left 0.2s ease",
        }} />
      </span>
    </button>
  );
}

export default function RhythmSheet({ onClose }: Readonly<{ onClose: () => void }>) {
  const settings = useNook((s) => s.settings);
  const setSettings = useNook((s) => s.setSettings);
  const [draft, setDraft] = useState<Settings>(settings);
  const [phase, setPhase] = useState<"editing" | "saving" | "saved">("editing");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const activePreset = useMemo(
    () =>
      PRESETS.find(
        (p) => p.focusMinutes === draft.focusMinutes && p.breakSeconds === draft.breakSeconds
      )?.name,
    [draft.focusMinutes, draft.breakSeconds]
  );

  const save = async () => {
    setPhase("saving");
    try {
      const next = await invoke<Settings>("update_settings", { settings: draft });
      setSettings(next);
      setPhase("saved");
      setTimeout(onClose, 750);
    } catch {
      setPhase("editing");
    }
  };

  let saveLabel = "Save rhythm";
  if (phase === "saving") saveLabel = "Saving…";
  if (phase === "saved") saveLabel = "Saved ✓";

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "rgba(15, 30, 40, 0.35)",
          backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
        }}
      />
      <motion.aside
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480, transition: { duration: 0.22 } }}
        transition={gentle}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41,
          width: "min(430px, 94vw)",
          background: "var(--surface-raised)",
          boxShadow: "var(--shadow-float)",
          padding: "var(--s6)", overflowY: "auto",
          display: "grid", gap: "var(--s5)", alignContent: "start",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--s4)" }}>
          <div>
            <h2 style={{ fontSize: "var(--text-xl)" }}>Rhythm</h2>
            <p className="t-soft" style={{ marginTop: "var(--s1)" }}>
              Nook's schedule — how long you focus, and how long each breather lasts.
            </p>
          </div>
          <motion.button
            {...press}
            className="ghost"
            aria-label="Close"
            onClick={onClose}
            style={{ marginLeft: "auto", padding: "var(--s2) var(--s3)", lineHeight: 1 }}
          >
            ✕
          </motion.button>
        </div>

        <div style={{ display: "grid", gap: "var(--s2)" }}>
          <span className="t-label">Presets</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--s2)" }}>
            {PRESETS.map((p) => {
              const active = activePreset === p.name;
              return (
                <motion.button
                  key={p.name}
                  {...press}
                  onClick={() => setDraft({ ...draft, focusMinutes: p.focusMinutes, breakSeconds: p.breakSeconds })}
                  style={{
                    display: "grid", gap: 2, padding: "var(--s3)",
                    borderRadius: "var(--radius-md)",
                    background: active ? "var(--accent-soft)" : "transparent",
                    border: active
                      ? "1.5px solid var(--accent)"
                      : "1.5px solid color-mix(in srgb, var(--text) 14%, transparent)",
                    color: "var(--text)", boxShadow: "none",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{p.name}</span>
                  <span className="t-soft" style={{ fontSize: "var(--text-xs)" }}>{p.hint}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gap: "var(--s2)" }}>
          <span className="t-label">One cycle</span>
          <CyclePreview draft={draft} />
        </div>

        <div style={{ display: "grid", gap: "var(--s5)" }}>
          <Dial
            icon="🎯"
            label="Focus block"
            hint="How long you work before Nook walks over to check in"
            valueLabel={`${draft.focusMinutes} min`}
            value={draft.focusMinutes}
            min={1}
            max={120}
            step={1}
            onChange={(focusMinutes) => setDraft({ ...draft, focusMinutes })}
          />
          <Dial
            icon="🍃"
            label="Breather"
            hint="How long each break lasts once you take it"
            valueLabel={formatMinutesLabel(draft.breakSeconds)}
            value={draft.breakSeconds}
            min={30}
            max={900}
            step={30}
            onChange={(breakSeconds) => setDraft({ ...draft, breakSeconds })}
          />
          <Dial
            icon="💤"
            label="Away reset"
            hint="Step away from the keyboard this long and it counts as a break"
            valueLabel={formatMinutesLabel(draft.idleSeconds)}
            value={draft.idleSeconds}
            min={60}
            max={1800}
            step={60}
            onChange={(idleSeconds) => setDraft({ ...draft, idleSeconds })}
          />
        </div>

        <div style={{ display: "grid", gap: "var(--s2)" }}>
          <span className="t-label">Ambience</span>
          <SoundToggle />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s2)", marginTop: "var(--s2)" }}>
          <motion.button {...press} className="ghost" onClick={onClose}>
            Cancel
          </motion.button>
          <motion.button {...press} disabled={phase !== "editing"} onClick={save}>
            {saveLabel}
          </motion.button>
        </div>
      </motion.aside>
    </>
  );
}
