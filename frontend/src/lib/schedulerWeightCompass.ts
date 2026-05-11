import type { PriorityJob, QueueJob, SchedulerHealth } from "../types";
import { formatScore, type PriorityFactorKey } from "./priorityOrderBook";

export type SchedulerWeightTone = "quiet" | "visible" | "dominant";

export type SchedulerWeightRow = {
  factor: PriorityFactorKey;
  weight: number;
  visibleScore: number;
  jobs: number;
  dominantJobs: number;
  tone: SchedulerWeightTone;
  message: string;
  action: string;
};

export type SchedulerWeightCompass = {
  label: string;
  headline: string;
  rows: SchedulerWeightRow[];
  command: string;
};

const FACTORS: PriorityFactorKey[] = ["fairshare", "age", "tres", "qos", "partition", "job_size"];

export function buildSchedulerWeightCompass(
  scheduler: SchedulerHealth | null,
  jobs: QueueJob[],
  priorityJobs: PriorityJob[],
  alias: string
): SchedulerWeightCompass {
  const pending = new Set(jobs.filter((job) => job.state === "PENDING").map((job) => job.job_id));
  const decoded = priorityJobs.filter((job) => pending.has(job.job_id));
  const weights = normalizeWeights(scheduler?.priority_weights ?? {});
  const rows = FACTORS.map((factor) => rowFor(factor, weights[factor] ?? 0, decoded)).sort(compareRows);
  const top = rows.filter((row) => row.weight > 0 && row.weight === rows[0]?.weight).map((row) => row.factor);
  return {
    label: top.length ? `${top.join(" + ")} top weight` : "weights unavailable",
    headline: headlineFor(rows, decoded.length),
    rows,
    command: `ssh ${alias} 'scontrol show config | grep -i "^PriorityWeight"; sprio -h -o "%.18i|%.12Y|%.12A|%.12F|%.12J|%.12P|%.12Q|%.12T"'`
  };
}

function rowFor(factor: PriorityFactorKey, weight: number, jobs: PriorityJob[]): SchedulerWeightRow {
  const visibleScore = jobs.reduce((sum, job) => sum + job[factor], 0);
  const active = jobs.filter((job) => job[factor] > 0);
  const dominantJobs = jobs.filter((job) => job.dominant_factor === factor).length;
  const tone = toneFor(weight, visibleScore, dominantJobs);
  return {
    factor,
    weight,
    visibleScore,
    jobs: active.length,
    dominantJobs,
    tone,
    message: messageFor(factor, weight, visibleScore, dominantJobs),
    action: actionFor(factor, tone)
  };
}

function normalizeWeights(raw: Record<string, number>): Partial<Record<PriorityFactorKey, number>> {
  const entries = Object.entries(raw).map(([key, value]) => [key.toLowerCase().replace(/priorityweight|_/g, ""), value] as const);
  return Object.fromEntries(
    FACTORS.map((factor) => {
      const aliases = factor === "job_size" ? ["jobsize", "size"] : [factor];
      return [factor, entries.find(([key]) => aliases.includes(key))?.[1] ?? 0];
    })
  );
}

function toneFor(weight: number, visibleScore: number, dominantJobs: number): SchedulerWeightTone {
  if (dominantJobs > 0 || (weight > 0 && visibleScore >= 200)) return "dominant";
  if (weight > 0 || visibleScore > 0) return "visible";
  return "quiet";
}

function messageFor(factor: PriorityFactorKey, weight: number, visibleScore: number, dominantJobs: number): string {
  const label = factorLabel(factor);
  if (!weight && !visibleScore) return `${label} is not visible in the scheduler weights or decoded pending jobs.`;
  if (dominantJobs) return `${label} dominates ${dominantJobs} decoded pending job${dominantJobs === 1 ? "" : "s"} with ${formatScore(visibleScore)} visible points.`;
  if (weight) return `${label} has configured weight ${formatScore(weight)}, but it is not the largest visible job-level factor yet.`;
  return `${label} appears in decoded priority rows even though no configured weight was parsed.`;
}

function actionFor(factor: PriorityFactorKey, tone: SchedulerWeightTone): string {
  if (factor === "fairshare" && tone === "dominant") return "Avoid churn; smaller validation jobs help more than cancelling and resubmitting large work.";
  if (factor === "age" && tone !== "quiet") return "Preserve queue age unless the script is wrong.";
  if (factor === "tres" && tone !== "quiet") return "CPU, GPU, and memory shape materially affect order; try narrower probes or arrays.";
  if (factor === "qos" && tone !== "quiet") return "Changing resources alone may not beat policy weighting; verify QOS path first.";
  if (factor === "partition" && tone !== "quiet") return "Compare eligible partitions before changing walltime or GPU width.";
  if (factor === "job_size" && tone !== "quiet") return "Wide jobs may rank differently from many small validation runs.";
  return "No action needed from this factor in the visible queue.";
}

function headlineFor(rows: SchedulerWeightRow[], decoded: number): string {
  if (!rows.some((row) => row.weight > 0)) return "Scheduler priority weights were not parsed; use sprio and scontrol before blaming fairshare.";
  const dominant = rows.find((row) => row.tone === "dominant");
  if (dominant) return `${factorLabel(dominant.factor)} is the most visible priority force across ${decoded} decoded pending job${decoded === 1 ? "" : "s"}.`;
  const top = rows[0];
  return `${factorLabel(top.factor)} carries the largest configured weight, but decoded jobs do not expose a dominant factor yet.`;
}

function compareRows(left: SchedulerWeightRow, right: SchedulerWeightRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.weight - left.weight || right.visibleScore - left.visibleScore || left.factor.localeCompare(right.factor);
}

function toneRank(tone: SchedulerWeightTone): number {
  return { quiet: 0, visible: 1, dominant: 2 }[tone];
}

function factorLabel(factor: PriorityFactorKey): string {
  if (factor === "job_size") return "job size";
  return factor;
}
