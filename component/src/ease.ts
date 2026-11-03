// Easing functions used by the player to shape per-phase keyframe tweens.
// Each takes a progress value in [0, 1] and returns an eased value in [0, 1].

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
