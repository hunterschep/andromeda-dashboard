import { buildPressureCalendar, type PressureSlot } from "./pressureCalendar";
import type { GpuPool, HistoryResponse, QueueJob, TelemetryResponse } from "../types";

export type SubmitWindowTone = "launch" | "wait" | "split";

export type SubmitWindowRow = {
  label: string;
  value: string;
  detail: string;
  tone: SubmitWindowTone;
};

export type SubmitWindowAdvisor = {
  tone: SubmitWindowTone;
  label: string;
  headline: string;
  command: string;
  rows: SubmitWindowRow[];
};

export function buildSubmitWindowAdvisor({
  telemetry,
  jobs,
  history,
  gpuPools,
  alias
}: {
  telemetry: TelemetryResponse | null;
  jobs: QueueJob[];
  history: HistoryResponse | null;
  gpuPools: GpuPool[];
  alias: string;
}): SubmitWindowAdvisor {
  const calendar = buildPressureCalendar(telemetry?.samples ?? []);
  const pending = jobs.filter((job) => job.state === "PENDING");
  const pendingGpu = pending.reduce((total, job) => total + job.gpu_count, 0);
  const usableGpu = gpuPools.reduce((total, pool) => total + pool.usable, 0);
  const cleanRate = cleanRateFor(history);
  const latestPressure = telemetry?.summary.latest_pressure ?? null;
  const tone = toneFor({ pendingGpu, usableGpu, latestPressure, cleanRate });
  return {
    tone,
    label: labelFor(tone, calendar.quiet),
    headline: headlineFor({ tone, pendingGpu, usableGpu, quiet: calendar.quiet, latestPressure, cleanRate }),
    command: queueTimingCommand(alias),
    rows: rowsFor({ pending, pendingGpu, usableGpu, cleanRate, latestPressure, quiet: calendar.quiet, hot: calendar.hot })
  };
}

function toneFor({
  pendingGpu,
  usableGpu,
  latestPressure,
  cleanRate
}: {
  pendingGpu: number;
  usableGpu: number;
  latestPressure: number | null;
  cleanRate: number;
}): SubmitWindowTone {
  if (pendingGpu > usableGpu && pendingGpu > 0) return "split";
  if ((latestPressure ?? 0) >= 70) return "wait";
  if (cleanRate < 75) return "split";
  return "launch";
}

function labelFor(tone: SubmitWindowTone, quiet: PressureSlot | null): string {
  if (tone === "launch") return "launch window open";
  if (tone === "wait") return quiet ? `wait for ${quiet.label}` : "wait for lower pressure";
  return quiet ? `split or target ${quiet.label}` : "split wide work";
}

function headlineFor({
  tone,
  pendingGpu,
  usableGpu,
  quiet,
  latestPressure,
  cleanRate
}: {
  tone: SubmitWindowTone;
  pendingGpu: number;
  usableGpu: number;
  quiet: PressureSlot | null;
  latestPressure: number | null;
  cleanRate: number;
}): string {
  if (pendingGpu > usableGpu && pendingGpu > 0) {
    return `${pendingGpu} pending GPU demand is above ${usableGpu} usable now; split wide work or target ${quiet?.label ?? "a quieter window"}.`;
  }
  if (tone === "wait") return `Current pressure is ${latestPressure ?? "high"}%; target ${quiet?.label ?? "the quietest sampled window"} if the job is not urgent.`;
  if (cleanRate < 75) return `Recent clean rate is ${cleanRate}%; run a short validation before scaling into the queue.`;
  return `Current queue pressure and recent history support submitting now, while still checking fit and walltime.`;
}

function rowsFor({
  pending,
  pendingGpu,
  usableGpu,
  cleanRate,
  latestPressure,
  quiet,
  hot
}: {
  pending: QueueJob[];
  pendingGpu: number;
  usableGpu: number;
  cleanRate: number;
  latestPressure: number | null;
  quiet: PressureSlot | null;
  hot: PressureSlot | null;
}): SubmitWindowRow[] {
  return [
    {
      label: "right now",
      value: `${pending.length} pending / ${pendingGpu} GPU waiting`,
      detail: `${usableGpu} usable GPU visible; latest sampled pressure is ${latestPressure ?? "n/a"}%.`,
      tone: pendingGpu > usableGpu && pendingGpu > 0 ? "split" : "launch"
    },
    {
      label: "best sampled window",
      value: quiet?.label ?? "n/a",
      detail: quiet ? `${quiet.pressure}% pressure, ${quiet.pending} pending, ${quiet.gpuFree} GPU free.` : "Collect telemetry to find a quiet window.",
      tone: "launch"
    },
    {
      label: "avoid if flexible",
      value: hot?.label ?? "n/a",
      detail: hot ? `${hot.pressure}% pressure, ${hot.pending} pending, ${hot.gpuFree} GPU free.` : "No hot window is visible yet.",
      tone: "wait"
    },
    {
      label: "recent reliability",
      value: `${cleanRate}% clean`,
      detail: cleanRate < 75 ? "Smoke-test before scaling; recent failures can waste queue position." : "Recent runs are clean enough for normal launch planning.",
      tone: cleanRate < 75 ? "split" : "launch"
    }
  ];
}

function cleanRateFor(history: HistoryResponse | null): number {
  const jobs = history?.jobs ?? [];
  if (!jobs.length) return 100;
  const failed = jobs.filter((job) => !["COMPLETED", "RUNNING"].includes(job.state)).length;
  return Math.round(((jobs.length - failed) / jobs.length) * 100);
}

function queueTimingCommand(alias: string): string {
  return `ssh ${alias} 'squeue -u "$USER" -o "%i|%j|%P|%t|%M|%l|%D|%C|%m|%b|%R"; squeue -u "$USER" --start; sinfo -o "%P|%a|%l|%D|%C|%G"; acct-chk "$USER" 2>/dev/null || true'`;
}
