export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function rebalanceFieldTotal(entries, field, options) {
  const { minTotal, maxTotal, targetTotal, minValue, maxValue } = options;
  if (!entries.length) return;

  const clampedTarget = clamp(targetTotal, minTotal, maxTotal);
  let total = entries.reduce((sum, entry) => sum + entry[field], 0);

  if (total <= 0) {
    const evenValue = clamp(clampedTarget / entries.length, minValue, maxValue);
    entries.forEach((entry) => {
      entry[field] = evenValue;
    });
    total = entries.reduce((sum, entry) => sum + entry[field], 0);
  }

  const scale = clampedTarget / total;
  entries.forEach((entry) => {
    entry[field] = clamp(entry[field] * scale, minValue, maxValue);
  });

  for (let i = 0; i < 2; i += 1) {
    const currentTotal = entries.reduce((sum, entry) => sum + entry[field], 0);
    if (currentTotal >= minTotal && currentTotal <= maxTotal) return;

    const target = clamp(currentTotal < minTotal ? minTotal : maxTotal, minTotal, maxTotal);
    const delta = target - currentTotal;
    const adjustable = entries.filter((entry) =>
      delta > 0 ? entry[field] < maxValue - 0.001 : entry[field] > minValue + 0.001
    );
    if (!adjustable.length) return;

    const perEntry = delta / adjustable.length;
    adjustable.forEach((entry) => {
      entry[field] = clamp(entry[field] + perEntry, minValue, maxValue);
    });
  }
}
