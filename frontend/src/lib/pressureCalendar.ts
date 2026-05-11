import type { TelemetrySample } from "../types";

export type PressureSlot = {
  key: string;
  label: string;
  day: string;
  window: string;
  samples: number;
  pending: number;
  gpuFree: number;
  pressure: number;
  tone: "calm" | "busy" | "hot";
};

export type PressureDay = {
  day: string;
  slots: PressureSlot[];
};

export type PressureCalendar = {
  totalSamples: number;
  summary: string;
  quiet: PressureSlot | null;
  hot: PressureSlot | null;
  days: PressureDay[];
};

const WINDOWS = [
  { label: "00-04", start: 0, end: 4 },
  { label: "04-08", start: 4, end: 8 },
  { label: "08-12", start: 8, end: 12 },
  { label: "12-16", start: 12, end: 16 },
  { label: "16-20", start: 16, end: 20 },
  { label: "20-24", start: 20, end: 24 }
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function buildPressureCalendar(samples: TelemetrySample[]): PressureCalendar {
  const groups = new Map<string, TelemetrySample[]>();
  for (const sample of samples) {
    const date = new Date(sample.captured_at * 1000);
    const day = DAYS[date.getDay()];
    const window = WINDOWS.find((item) => date.getHours() >= item.start && date.getHours() < item.end) ?? WINDOWS[0];
    const key = `${day}-${window.label}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  const slots = Array.from(groups.entries()).map(([key, rows]) => slotFromRows(key, rows));
  const ranked = [...slots].sort((left, right) => left.pressure - right.pressure || right.samples - left.samples || left.key.localeCompare(right.key));
  const quiet = ranked[0] ?? null;
  const hot = ranked[ranked.length - 1] ?? null;
  return {
    totalSamples: samples.length,
    summary: summary(samples.length, quiet, hot),
    quiet,
    hot,
    days: DAYS.map((day) => ({ day, slots: WINDOWS.map((window) => slots.find((slot) => slot.key === `${day}-${window.label}`) ?? emptySlot(day, window.label)) }))
  };
}

function slotFromRows(key: string, rows: TelemetrySample[]): PressureSlot {
  const separator = key.indexOf("-");
  const day = key.slice(0, separator);
  const window = key.slice(separator + 1);
  const pressure = Math.round(rows.reduce((total, row) => total + samplePressure(row), 0) / Math.max(rows.length, 1));
  return {
    key,
    label: `${day} ${window}`,
    day,
    window,
    samples: rows.length,
    pending: Math.round(rows.reduce((total, row) => total + row.pending, 0) / Math.max(rows.length, 1)),
    gpuFree: Math.min(...rows.map((row) => row.gpu_free)),
    pressure,
    tone: tone(pressure)
  };
}

function emptySlot(day: string, window: string): PressureSlot {
  return { key: `${day}-${window}`, label: `${day} ${window}`, day, window, samples: 0, pending: 0, gpuFree: 0, pressure: 0, tone: "calm" };
}

function samplePressure(sample: TelemetrySample): number {
  const gpuPressure = sample.gpu_total ? 1 - sample.gpu_free / sample.gpu_total : 0;
  const cpuPressure = sample.cpus_total ? 1 - sample.cpus_idle / sample.cpus_total : 0;
  const queuePressure = sample.running + sample.pending ? sample.pending / (sample.running + sample.pending) : 0;
  return Math.max(gpuPressure, cpuPressure, queuePressure) * 100;
}

function tone(pressure: number): PressureSlot["tone"] {
  if (pressure >= 75) return "hot";
  if (pressure >= 45) return "busy";
  return "calm";
}

function summary(total: number, quiet: PressureSlot | null, hot: PressureSlot | null): string {
  if (!total) return "Collect more telemetry to reveal recurring queue pressure.";
  if (!quiet || !hot) return "Telemetry is present, but no daypart pattern is ready yet.";
  if (total < 6) return `${quiet.label} is currently the lightest sampled window; keep collecting telemetry for stronger confidence.`;
  return `${quiet.label} has been lightest recently; ${hot.label} carried the most visible pressure.`;
}
