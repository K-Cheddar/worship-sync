export type FontSizePresetTier = {
  from: number;
  to: number;
  step: number;
};

/** Builds ascending preset values with finer steps at low sizes and coarser steps at high sizes. */
export function buildTieredFontSizePresets(
  tiers: readonly FontSizePresetTier[],
  absoluteMax?: number,
): readonly number[] {
  const presets: number[] = [];

  for (const { from, to, step } of tiers) {
    const ceiling = absoluteMax !== undefined ? Math.min(to, absoluteMax) : to;
    const last = presets[presets.length - 1];
    let v = last !== undefined && last >= from ? last + step : from;

    while (v <= ceiling) {
      presets.push(v);
      v += step;
    }
  }

  return presets;
}

export function nearestFontSizePreset(
  value: number,
  presets: readonly number[],
): number {
  if (presets.length === 0) return value;

  let best = presets[0]!;
  let bestDist = Infinity;

  for (const preset of presets) {
    const dist = Math.abs(preset - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = preset;
    }
  }

  return best;
}
