export type FitInput = {
  contentW: number;
  contentH: number;
  viewW: number;
  viewH: number;
  padding?: number;
  maxScale?: number;
};

export type FitResult = { scale: number; panX: number; panY: number };

export function fit_to_viewport(i: FitInput): FitResult {
  const pad = i.padding ?? 0;
  const sx = (i.viewW - pad) / Math.max(1, i.contentW);
  const sy = (i.viewH - pad) / Math.max(1, i.contentH);
  const scale = Math.min(sx, sy, i.maxScale ?? 1);
  return {
    scale,
    panX: (i.viewW - i.contentW * scale) / 2,
    panY: (i.viewH - i.contentH * scale) / 2,
  };
}
