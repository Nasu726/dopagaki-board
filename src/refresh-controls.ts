export const REFRESH_SLIDER_MAX = 100;
export const MIN_AUTO_REFRESH_SECONDS = 300;
export const MAX_AUTO_REFRESH_SECONDS = 86400;
export const DEFAULT_AUTO_REFRESH_SECONDS = 3600;

export type RefreshMode = "inherit" | "off" | "interval";

export type WidgetRefreshConfig = {
  mode: RefreshMode;
  autoIntervalSeconds: number | null;
};

// Presentation mirror of the Rust refresh policy. A Rust regression test reads
// these explicit values so changing one side without the other fails CI.
const SOURCE_AUTO_REFRESH_FLOOR_SECONDS: Record<string, number> = {
  arxiv: 86400,
  wikipedia: 21600,
  qiita: 3600,
  zenn: 3600,
  youtube: 3600,
};

export function sourceAutoRefreshFloorSeconds(sourceKind: string): number {
  return SOURCE_AUTO_REFRESH_FLOOR_SECONDS[sourceKind] ?? MIN_AUTO_REFRESH_SECONDS;
}

export function readWidgetRefreshConfig(refreshConfigJson: string): WidgetRefreshConfig {
  try {
    const parsed = JSON.parse(refreshConfigJson) as {
      mode?: unknown;
      autoIntervalSeconds?: unknown;
    };
    if (parsed.mode === "off") {
      return { mode: "off", autoIntervalSeconds: null };
    }
    if (
      parsed.mode === "interval" &&
      typeof parsed.autoIntervalSeconds === "number" &&
      Number.isFinite(parsed.autoIntervalSeconds)
    ) {
      return { mode: "interval", autoIntervalSeconds: parsed.autoIntervalSeconds };
    }
  } catch {
    // Presentation fallback only. Rust remains authoritative when saving.
  }
  return { mode: "inherit", autoIntervalSeconds: null };
}

export function widgetRefreshConfigJson(
  mode: RefreshMode,
  autoIntervalSeconds: number | null,
): string {
  if (mode === "inherit") {
    return "{}";
  }
  if (mode === "off") {
    return JSON.stringify({ mode: "off" });
  }
  return JSON.stringify({ mode: "interval", autoIntervalSeconds });
}

export function sliderPositionToSeconds(position: number): number | null {
  const normalizedPosition = clamp(Math.round(position), 0, REFRESH_SLIDER_MAX);
  if (normalizedPosition === 0) {
    return null;
  }

  const fraction = (normalizedPosition - 1) / (REFRESH_SLIDER_MAX - 1);
  const rawSeconds =
    MIN_AUTO_REFRESH_SECONDS *
    Math.pow(MAX_AUTO_REFRESH_SECONDS / MIN_AUTO_REFRESH_SECONDS, fraction);
  const roundedToMinute = Math.round(rawSeconds / 60) * 60;
  return clamp(roundedToMinute, MIN_AUTO_REFRESH_SECONDS, MAX_AUTO_REFRESH_SECONDS);
}

export function secondsToSliderPosition(seconds: number | null): number {
  if (seconds === null) {
    return 0;
  }

  const bounded = clamp(seconds, MIN_AUTO_REFRESH_SECONDS, MAX_AUTO_REFRESH_SECONDS);
  const fraction =
    Math.log(bounded / MIN_AUTO_REFRESH_SECONDS) /
    Math.log(MAX_AUTO_REFRESH_SECONDS / MIN_AUTO_REFRESH_SECONDS);
  return clamp(Math.round(1 + fraction * (REFRESH_SLIDER_MAX - 1)), 1, REFRESH_SLIDER_MAX);
}

export function normalizeRefreshSeconds(seconds: number, minimumSeconds: number): number {
  const minimum = clamp(
    Math.round(minimumSeconds / 60) * 60,
    MIN_AUTO_REFRESH_SECONDS,
    MAX_AUTO_REFRESH_SECONDS,
  );
  const rounded = Math.round(seconds / 60) * 60;
  return clamp(rounded, minimum, MAX_AUTO_REFRESH_SECONDS);
}

export function refreshMinutesToSeconds(minutes: number, minimumSeconds: number): number {
  return normalizeRefreshSeconds(minutes * 60, minimumSeconds);
}

export function formatRefreshInterval(seconds: number | null): string {
  if (seconds === null) {
    return "OFF";
  }
  if (seconds < 60 * 60) {
    return `${Math.round(seconds / 60)} min`;
  }

  const hours = seconds / (60 * 60);
  if (hours < 10 && Math.abs(hours - Math.round(hours)) > 0.05) {
    return `${hours.toFixed(1)} h`;
  }
  return `${Math.round(hours)} h`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
