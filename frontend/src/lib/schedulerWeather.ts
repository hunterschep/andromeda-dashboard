import type { SchedulerHealth } from "../types";

export type SchedulerWeatherTone = "calm" | "busy" | "hot";

export type SchedulerWeatherSignal = {
  label: string;
  value: string;
  detail: string;
};

export type SchedulerWeather = {
  tone: SchedulerWeatherTone;
  label: string;
  summary: string;
  action: string;
  signals: SchedulerWeatherSignal[];
  command: string;
};

export function buildSchedulerWeather(
  scheduler: SchedulerHealth | null,
  pendingJobs: number,
  alias: string
): SchedulerWeather {
  if (!scheduler) {
    return {
      tone: "busy",
      label: "scheduler opaque",
      summary: "Scheduler diagnostics are not available in this snapshot.",
      action: "Use queue start estimates and scontrol job details until sdiag data returns.",
      signals: [],
      command: `ssh ${alias} 'sdiag 2>/dev/null || true; squeue -t PD -o "%i|%P|%j|%u|%R" | head -40'`
    };
  }
  const cycle = scheduler.mean_cycle_seconds ?? scheduler.last_cycle_seconds ?? null;
  const backfillCycle = scheduler.backfill_last_cycle_seconds;
  const backfillDepth = scheduler.backfill_last_depth;
  const queueDepth = scheduler.queue_depth ?? pendingJobs;
  const tone = toneFor(cycle, backfillCycle, backfillDepth, queueDepth);
  return {
    tone,
    label: labelFor(tone),
    summary: summaryFor(tone, cycle, backfillCycle, backfillDepth, queueDepth),
    action: actionFor(tone, backfillDepth, queueDepth),
    signals: [
      { label: "cycle", value: seconds(cycle), detail: "mean scheduler loop" },
      { label: "backfill", value: backfillDepth === null ? "n/a" : String(backfillDepth), detail: `cycle ${seconds(backfillCycle)}` },
      { label: "queue", value: queueDepth === null ? "n/a" : String(queueDepth), detail: "visible scheduler depth" },
      { label: "weights", value: dominantWeights(scheduler.priority_weights), detail: "largest priority inputs" }
    ],
    command: `ssh ${alias} 'sdiag 2>/dev/null || true; sprio -w 2>/dev/null || true; squeue -t PD -o "%i|%P|%j|%u|%R" | head -40'`
  };
}

function toneFor(
  cycle: number | null,
  backfillCycle: number | null,
  backfillDepth: number | null,
  queueDepth: number | null
): SchedulerWeatherTone {
  if ((cycle ?? 0) >= 8 || (backfillCycle ?? 0) >= 30) return "hot";
  if ((queueDepth ?? 0) >= 100 || (cycle ?? 0) >= 4 || (backfillDepth !== null && backfillDepth < 25)) return "busy";
  return "calm";
}

function labelFor(tone: SchedulerWeatherTone): string {
  if (tone === "hot") return "scheduler strained";
  if (tone === "busy") return "scheduler loaded";
  return "scheduler responsive";
}

function summaryFor(
  tone: SchedulerWeatherTone,
  cycle: number | null,
  backfillCycle: number | null,
  backfillDepth: number | null,
  queueDepth: number | null
): string {
  if (tone === "hot") return `Scheduling loops are slow (${seconds(cycle)} mean, ${seconds(backfillCycle)} backfill); queue feedback may lag.`;
  if (tone === "busy") return `Scheduler is active against ${queueDepth ?? "unknown"} queued jobs with backfill depth ${backfillDepth ?? "n/a"}.`;
  return `Scheduler cycles are quick (${seconds(cycle)}) and backfill is inspecting ${backfillDepth ?? "n/a"} jobs.`;
}

function actionFor(tone: SchedulerWeatherTone, backfillDepth: number | null, queueDepth: number | null): string {
  if (tone === "hot") return "Avoid repeatedly changing submissions; rely on dated start estimates and wait for cycle pressure to cool.";
  if ((backfillDepth ?? 0) > 0 && (queueDepth ?? 0) > 0) return "Short, narrow jobs have the best chance to exploit backfill movement.";
  if (tone === "busy") return "Reduce walltime or resource width before assuming priority is the only blocker.";
  return "This is a good moment for small validation or notebook work if resources are available.";
}

function dominantWeights(weights: Record<string, number>): string {
  const entries = Object.entries(weights).sort((left, right) => right[1] - left[1]);
  if (!entries.length) return "n/a";
  return entries.slice(0, 2).map(([key]) => key).join(" + ");
}

function seconds(value: number | null): string {
  if (value === null) return "n/a";
  if (value < 1) return `${Math.round(value * 1000)}ms`;
  return `${value.toFixed(value >= 10 ? 0 : 1)}s`;
}
