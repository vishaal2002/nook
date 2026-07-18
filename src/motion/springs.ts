// One physics vocabulary for the whole app. Import these, never inline spring configs.
import type { Transition } from "motion/react";

export const gentle: Transition = { type: "spring", stiffness: 170, damping: 26 };
export const lively: Transition = { type: "spring", stiffness: 300, damping: 20 };
export const lazy: Transition = { type: "spring", stiffness: 80, damping: 20 };

export const enter = {
  initial: { opacity: 0, y: 12, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -8, filter: "blur(4px)" },
  transition: gentle,
};

export const staggerChildren = { animate: { transition: { staggerChildren: 0.04 } } };

/**
 * Shared interaction states. Transitions live inside each target so spreading
 * these never clobbers a component's own `transition` (e.g. staggered entrances).
 * Buttons use `lively` per the motion spec; cards drift on `gentle`.
 */
export const press = {
  whileHover: { scale: 1.03, transition: lively },
  whileTap: { scale: 0.96, transition: lively },
};

export const cardLift = {
  whileHover: { y: -2, transition: gentle },
};

/** Breathing loop for the break overlay: in / hold / out via keyframe times. */
export const breathe = {
  animate: { scale: [1, 1.35, 1.35, 1] },
  transition: { duration: 14, times: [0, 0.29, 0.43, 1], repeat: Infinity, ease: "easeInOut" as const },
};
