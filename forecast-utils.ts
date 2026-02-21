import type { RebalanceOptions } from "./types.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function rebalanceFieldTotal(entries: any[], field: string, options: RebalanceOptions): void {
  const { minTotal, maxTotal, targetTotal, minValue, maxValue } = options;
  if (!entries.length) return;

  const clampedTarget = clamp(targetTotal, minTotal, maxTotal);
  let total = entries.reduce((sum: number, entry: Record<string, number>) => sum + entry[field], 0) as number;

  if (total <= 0) {
    const evenValue = clamp(clampedTarget / entries.length, minValue, maxValue);
    entries.forEach((entry: Record<string, number>) => {
      entry[field] = evenValue;
    });
    total = entries.reduce((sum: number, entry: Record<string, number>) => sum + entry[field], 0) as number;
  }

  const scale = clampedTarget / total;
  entries.forEach((entry: Record<string, number>) => {
    entry[field] = clamp(entry[field] * scale, minValue, maxValue);
  });

  for (let i = 0; i < 2; i += 1) {
    const currentTotal = entries.reduce((sum: number, entry: Record<string, number>) => sum + entry[field], 0) as number;
    if (currentTotal >= minTotal && currentTotal <= maxTotal) return;

    const target = clamp(currentTotal < minTotal ? minTotal : maxTotal, minTotal, maxTotal);
    const delta = target - currentTotal;
    const adjustable = entries.filter((entry: Record<string, number>) =>
      delta > 0 ? entry[field] < maxValue - 0.001 : entry[field] > minValue + 0.001
    );
    if (!adjustable.length) return;

    const perEntry = delta / adjustable.length;
    adjustable.forEach((entry: Record<string, number>) => {
      entry[field] = clamp(entry[field] + perEntry, minValue, maxValue);
    });
  }
}
