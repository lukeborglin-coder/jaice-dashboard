export const normalizeCodeForComparison = (value?: string | number): string => {
  if (value === null || value === undefined) return '';
  const str = String(value).trim().toLowerCase();
  if (!str) return '';
  return str.replace(/^[rc]/, '');
};

export const getNumericCodeValueForMean = (code: string, fallback?: string): number | null => {
  const candidates = [code, fallback].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    const stripped = candidate.replace(/^[rc]/i, '').trim();
    if (!stripped) continue;

    const numericMatch = stripped.match(/-?\d+(\.\d+)?/);
    if (!numericMatch) continue;

    const value = Number(numericMatch[0]);
    if (!Number.isFinite(value)) continue;

    if (value >= 90 && value <= 99) {
      continue;
    }

    return value;
  }

  return null;
};

