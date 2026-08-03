const sourceLabelMemoryKey = "menie.sourceLabelMemory.v1";
const defaultSourceLabels = ["Me", "Remote participant"] as const;

type SourceLabelMemory = Partial<
  Record<(typeof defaultSourceLabels)[number], string>
>;

function loadMemory(): SourceLabelMemory {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(sourceLabelMemoryKey) || "{}",
    ) as SourceLabelMemory;
    return Object.fromEntries(
      defaultSourceLabels
        .map((source) => [
          source,
          typeof parsed[source] === "string"
            ? parsed[source]!.trim().slice(0, 80)
            : "",
        ])
        .filter(([, label]) => Boolean(label)),
    ) as SourceLabelMemory;
  } catch {
    return {};
  }
}

/** Save an explicitly user-approved local label for one deterministic track. */
export function rememberSourceLabel(source: string, label: string): void {
  if (
    typeof window === "undefined" ||
    !defaultSourceLabels.includes(
      source as (typeof defaultSourceLabels)[number],
    )
  )
    return;
  const normalized = label.trim().slice(0, 80);
  if (!normalized) return;
  const next = { ...loadMemory(), [source]: normalized };
  window.localStorage.setItem(sourceLabelMemoryKey, JSON.stringify(next));
}

export function clearRememberedSourceLabel(source: string): void {
  if (typeof window === "undefined") return;
  const next = loadMemory();
  delete next[source as keyof SourceLabelMemory];
  window.localStorage.setItem(sourceLabelMemoryKey, JSON.stringify(next));
}

/** Apply only labels previously saved by the user; no diarization is performed. */
export function applyRememberedSourceLabel(
  source: string | null | undefined,
): string | null | undefined {
  if (!source) return source;
  return loadMemory()[source as keyof SourceLabelMemory] || source;
}

export function applyRememberedSourceLabels<
  T extends { source?: string | null },
>(segments: T[]): T[] {
  return segments.map((segment) => ({
    ...segment,
    source: applyRememberedSourceLabel(segment.source),
  }));
}
