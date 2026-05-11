import type { TelemetrySample } from "../types";

export type ReplayDeltaMove = {
  label: string;
  value: string;
  detail: string;
  tone: "rise" | "relief" | "flat";
};

export type ReplayDelta = {
  label: string;
  headline: string;
  moves: ReplayDeltaMove[];
};

type Transition = {
  from: TelemetrySample;
  to: TelemetrySample;
  pressure: number;
  gpuFree: number;
  pending: number;
};

export function buildReplayDelta(samples: TelemetrySample[]): ReplayDelta {
  const ordered = samples.slice().sort((left, right) => left.captured_at - right.captured_at);
  const transitions = ordered.slice(1).map((sample, index) => transition(ordered[index], sample));
  if (!transitions.length) {
    return {
      label: "waiting",
      headline: "Collect at least two telemetry samples to replay cluster movement.",
      moves: []
    };
  }
  const climb = transitions.slice().sort((left, right) => right.pressure - left.pressure)[0];
  const relief = transitions.slice().sort((left, right) => left.pressure - right.pressure)[0];
  const gpuReturn = transitions.slice().sort((left, right) => right.gpuFree - left.gpuFree)[0];
  const latest = transitions[transitions.length - 1];
  return {
    label: `${transitions.length} transitions`,
    headline: headlineFor(latest, climb, relief),
    moves: [
      move("steepest climb", climb.pressure, climb, "rise"),
      move("strongest relief", relief.pressure, relief, "relief"),
      move("GPU return", gpuReturn.gpuFree, gpuReturn, gpuReturn.gpuFree > 0 ? "relief" : "flat")
    ]
  };
}

function transition(from: TelemetrySample, to: TelemetrySample): Transition {
  return {
    from,
    to,
    pressure: pressure(to) - pressure(from),
    gpuFree: to.gpu_free - from.gpu_free,
    pending: to.pending - from.pending
  };
}

function move(label: string, value: number, transition: Transition, tone: ReplayDeltaMove["tone"]): ReplayDeltaMove {
  const sign = value > 0 ? "+" : "";
  return {
    label,
    value: `${sign}${value}`,
    detail: `${timeText(transition.from)} to ${timeText(transition.to)}: pending ${signed(transition.pending)}, GPU free ${signed(transition.gpuFree)}.`,
    tone
  };
}

function headlineFor(latest: Transition, climb: Transition, relief: Transition): string {
  if (latest.pressure < 0) return `Latest sample recovered ${Math.abs(latest.pressure)} pressure points while GPU free moved ${signed(latest.gpuFree)}.`;
  if (latest.pressure > 0) return `Latest sample added ${latest.pressure} pressure points; watch queue depth and GPU release timing.`;
  if (climb.pressure > Math.abs(relief.pressure)) return `Recent replay is defined by a ${climb.pressure}-point pressure climb.`;
  return "Recent replay is stable; pressure moves are small across sampled transitions.";
}

function pressure(sample: TelemetrySample): number {
  const gpuPressure = sample.gpu_total ? 1 - sample.gpu_free / sample.gpu_total : 0;
  const cpuPressure = sample.cpus_total ? 1 - sample.cpus_idle / sample.cpus_total : 0;
  const queuePressure = sample.running + sample.pending ? sample.pending / (sample.running + sample.pending) : 0;
  return Math.round(Math.max(gpuPressure, cpuPressure, queuePressure) * 100);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function timeText(sample: TelemetrySample): string {
  return new Date(sample.captured_at * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
