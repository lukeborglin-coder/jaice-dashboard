export const createSerializedTableSelections = (selections: Record<string, Set<string>>): Record<string, string[]> => {
  const serialized: Record<string, string[]> = {};
  Object.entries(selections).forEach(([key, value]) => {
    serialized[key] = Array.from(value);
  });
  return serialized;
};

export const parseSerializedTableSelections = (data: Record<string, string[]> | null | undefined): Record<string, Set<string>> => {
  if (!data) return {};
  const parsed: Record<string, Set<string>> = {};
  Object.entries(data).forEach(([key, value]) => {
    parsed[key] = new Set(value);
  });
  return parsed;
};

