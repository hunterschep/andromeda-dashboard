import type { HistoryResponse, QueueJob } from "../types";
import type { PressureTone } from "./intelligenceTypes";

export function toneForScore(value: number): PressureTone {
  if (value >= 84) return "critical";
  if (value >= 62) return "hot";
  if (value >= 34) return "busy";
  return "calm";
}

export function maxTone(left: PressureTone, right: PressureTone): PressureTone {
  const rank: Record<PressureTone, number> = { calm: 0, busy: 1, hot: 2, critical: 3 };
  return rank[left] >= rank[right] ? left : right;
}

export function score(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function waitBandForPressure(
  scoreValue: number,
  medianWaitSeconds: number | null,
  pending: number
): string {
  if (!pending) return "clear";
  if (scoreValue >= 82) return "multi-hour";
  if (scoreValue >= 66) return "1-3h";
  if (scoreValue >= 42) return medianWaitSeconds && medianWaitSeconds > 3600 ? "1h+" : "30-90m";
  return medianWaitSeconds && medianWaitSeconds > 1800 ? "under 1h" : "under 30m";
}

export function forecastJobWait(
  job: QueueJob,
  pressureWaitBand: string | undefined,
  history: HistoryResponse | null
): string {
  if (job.estimated_start_time) {
    const estimate = new Date(job.estimated_start_time);
    if (!Number.isNaN(estimate.getTime())) {
      const seconds = Math.max(0, Math.round((estimate.getTime() - Date.now()) / 1000));
      if (seconds === 0) return "due now";
      if (seconds < 30 * 60) return "< 30m";
      if (seconds < 2 * 3600) return "30m-2h";
      if (seconds < 6 * 3600) return "2h-6h";
      return "6h+";
    }
  }
  if (pressureWaitBand) return pressureWaitBand;
  if (history?.median_wait_seconds) return history.median_wait_seconds > 3600 ? "1h+" : "historical median";
  return "unknown";
}

export function jobDisplayName(job: QueueJob): string {
  return job.name ?? (job.anonymized ? "anonymized" : "unnamed");
}
