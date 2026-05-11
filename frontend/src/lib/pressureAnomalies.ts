import type { TelemetrySample } from "../types";

export type PressureAnomaly = {
  title: string;
  tone: "info" | "warning" | "critical";
  time: string;
  signal: string;
  message: string;
  action: string;
};

export type PressureAnomalySummary = {
  label: string;
  anomalies: PressureAnomaly[];
};

export function buildPressureAnomalies(samples: TelemetrySample[]): PressureAnomalySummary {
  if (!samples.length) return { label: "waiting", anomalies: [] };
  const anomalies = [gpuFamine(samples), pendingSurge(samples), recoveryWindow(samples), cpuSqueeze(samples)]
    .filter((item): item is PressureAnomaly => Boolean(item))
    .sort(compareAnomalies);
  return {
    label: anomalies.length ? `${anomalies.length} signal${anomalies.length === 1 ? "" : "s"}` : "stable",
    anomalies
  };
}

function gpuFamine(samples: TelemetrySample[]): PressureAnomaly | null {
  const rows = samples.filter((sample) => sample.gpu_total > 0);
  if (!rows.length) return null;
  const worst = rows.slice().sort((left, right) => left.gpu_free - right.gpu_free || right.pending - left.pending)[0];
  if (!worst || worst.gpu_free > 0) return null;
  return {
    title: "GPU famine",
    tone: "critical",
    time: timeText(worst),
    signal: `${worst.gpu_free}/${worst.gpu_total} GPU free`,
    message: `At ${timeText(worst)}, telemetry saw zero free GPUs with ${worst.pending} pending job${worst.pending === 1 ? "" : "s"}.`,
    action: "Use narrower GPU shapes, wait for release radar, or switch to CPU validation while supply is pinned."
  };
}

function pendingSurge(samples: TelemetrySample[]): PressureAnomaly | null {
  const peak = samples.slice().sort((left, right) => right.pending - left.pending)[0];
  const baseline = median(samples.map((sample) => sample.pending));
  if (!peak || peak.pending < Math.max(4, baseline * 2)) return null;
  return {
    title: "Pending surge",
    tone: peak.pending >= 8 ? "critical" : "warning",
    time: timeText(peak),
    signal: `${peak.pending} pending`,
    message: `Pending depth peaked at ${peak.pending}, compared with a median of ${baseline}.`,
    action: "Prefer shorter walltime and smaller requests until the queue drains back toward baseline."
  };
}

function recoveryWindow(samples: TelemetrySample[]): PressureAnomaly | null {
  const peak = samples.slice().sort((left, right) => right.pending - left.pending)[0];
  const latest = samples[samples.length - 1];
  if (!peak || !latest || latest === peak || latest.pending >= peak.pending || latest.gpu_free <= peak.gpu_free) return null;
  return {
    title: "Recovery window",
    tone: "info",
    time: timeText(latest),
    signal: `${latest.pending} pending`,
    message: `Latest sample improved from ${peak.pending} to ${latest.pending} pending while GPU free rose to ${latest.gpu_free}.`,
    action: "This is a better moment for small validation jobs than the recent pressure peak."
  };
}

function cpuSqueeze(samples: TelemetrySample[]): PressureAnomaly | null {
  const worst = samples.slice().sort((left, right) => cpuFreeRatio(left) - cpuFreeRatio(right))[0];
  if (!worst || cpuFreeRatio(worst) > 0.15) return null;
  return {
    title: "CPU squeeze",
    tone: "warning",
    time: timeText(worst),
    signal: `${worst.cpus_idle}/${worst.cpus_total} CPU idle`,
    message: `CPU headroom fell below 15%, which can block CPU-heavy preprocessing and wide GPU jobs.`,
    action: "Reduce CPU width or target a partition with more idle cores before assuming GPUs are the only bottleneck."
  };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function cpuFreeRatio(sample: TelemetrySample): number {
  return sample.cpus_total ? sample.cpus_idle / sample.cpus_total : 1;
}

function timeText(sample: TelemetrySample): string {
  return new Date(sample.captured_at * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function compareAnomalies(left: PressureAnomaly, right: PressureAnomaly): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.title.localeCompare(right.title);
}

function toneRank(tone: PressureAnomaly["tone"]): number {
  return { info: 0, warning: 1, critical: 2 }[tone];
}
