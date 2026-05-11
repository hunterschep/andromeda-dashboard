import type { PriorityJob, QueueJob } from "../types";

export type PriorityFactorKey = "age" | "fairshare" | "job_size" | "partition" | "qos" | "tres";

export type PriorityOrderRow = {
  jobId: string;
  name: string;
  rank: number;
  score: number;
  partition: string;
  request: string;
  dominant: string;
  spread: number | null;
  separator: string;
  message: string;
  action: string;
};

export type PriorityOrderBook = {
  ranked: number;
  spread: number;
  label: string;
  headline: string;
  command: string;
  rows: PriorityOrderRow[];
};

const FACTORS: PriorityFactorKey[] = ["age", "fairshare", "job_size", "partition", "qos", "tres"];

export function buildPriorityOrderBook(
  jobs: QueueJob[],
  priorityJobs: PriorityJob[],
  alias: string
): PriorityOrderBook {
  const pending = new Map(jobs.filter((job) => job.state === "PENDING").map((job) => [job.job_id, job]));
  const ranked = priorityJobs
    .filter((item) => pending.has(item.job_id))
    .sort((left, right) => right.priority - left.priority || left.job_id.localeCompare(right.job_id));
  const rows = ranked.map((item, index) => rowFor(item, pending.get(item.job_id), ranked[index + 1], ranked[0], index + 1));
  const spread = ranked.length > 1 ? Math.max(0, ranked[0].priority - ranked[ranked.length - 1].priority) : 0;
  return {
    ranked: ranked.length,
    spread,
    label: ranked.length ? `${ranked.length} ranked / ${formatScore(spread)} spread` : "sprio unavailable",
    headline: headlineFor(rows, spread),
    command: `ssh ${alias} 'sprio -h -o "%.18i|%.12Y|%.12A|%.12F|%.12J|%.12P|%.12Q|%.12T"; squeue -t PD -o "%i|%j|%u|%P|%C|%b|%R"'`,
    rows
  };
}

function rowFor(
  item: PriorityJob,
  job: QueueJob | undefined,
  next: PriorityJob | undefined,
  leader: PriorityJob | undefined,
  rank: number
): PriorityOrderRow {
  const spread = next ? item.priority - next.priority : leader && leader.job_id !== item.job_id ? leader.priority - item.priority : null;
  const separator = next ? strongestSeparator(item, next) : leader && leader.job_id !== item.job_id ? strongestSeparator(leader, item) : item.dominant_factor ?? "score";
  return {
    jobId: item.job_id,
    name: job?.name ?? item.job_id,
    rank,
    score: item.priority,
    partition: job?.partition ?? "n/a",
    request: `${job?.cpus ?? 0} CPU / ${job?.gpu_count ?? 0} GPU`,
    dominant: item.dominant_factor ?? "score",
    spread,
    separator,
    message: messageFor(item, job, next, leader, separator, spread),
    action: actionFor(separator, rank)
  };
}

function strongestSeparator(left: PriorityJob, right: PriorityJob): string {
  return FACTORS.map((factor) => ({ factor, delta: Math.abs(left[factor] - right[factor]) }))
    .sort((a, b) => b.delta - a.delta || a.factor.localeCompare(b.factor))[0].factor;
}

function messageFor(
  item: PriorityJob,
  job: QueueJob | undefined,
  next: PriorityJob | undefined,
  leader: PriorityJob | undefined,
  separator: string,
  spread: number | null
): string {
  const name = job?.name ?? item.job_id;
  if (next && spread !== null) {
    return `${name} leads ${next.job_id} by ${formatScore(spread)} priority points; ${factorLabel(separator)} is the largest visible separator.`;
  }
  if (leader && leader.job_id !== item.job_id && spread !== null) {
    return `${name} trails ${leader.job_id} by ${formatScore(spread)} points; ${factorLabel(separator)} is the biggest visible gap.`;
  }
  return `${name} is the only pending job with visible sprio factors in this filter.`;
}

function actionFor(separator: string, rank: number): string {
  if (separator === "fairshare") return rank === 1 ? "This job has the strongest fairshare position; avoid cancelling unless the script is wrong." : "Fairshare is the hard part; a smaller TRES shape may help more than resubmitting.";
  if (separator === "tres") return "CPU/GPU/memory shape is materially affecting order; narrow probes may age and backfill better.";
  if (separator === "age") return "Queue age matters here; cancelling resets useful scheduler credit.";
  if (separator === "qos") return "QOS policy is separating jobs; changing resources alone will not close the gap.";
  if (separator === "partition") return "Partition weighting is visible; compare eligible partitions before editing walltime.";
  return "Job size is separating order; arrays or smaller validation jobs may move differently.";
}

function headlineFor(rows: PriorityOrderRow[], spread: number): string {
  if (!rows.length) return "Slurm priority rows are not visible for pending jobs in this filter.";
  if (rows.length === 1) return `${rows[0].name} is the only pending job with visible priority factors.`;
  const top = rows[0];
  return `${top.name} is first in the visible priority book with a ${formatScore(spread)} point spread across decoded pending jobs.`;
}

function factorLabel(value: string): string {
  if (value === "job_size") return "job size";
  return value;
}

export function formatScore(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 10) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
