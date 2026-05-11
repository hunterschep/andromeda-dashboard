import { formatDuration, shortTime } from "../api";
import type { HistoryJob, QueueJob } from "../types";

export type WaitBudgetTone = "normal" | "watch" | "overdue" | "gated" | "unknown";

export type WaitBudgetItem = {
  jobId: string;
  name: string;
  partition: string;
  tone: WaitBudgetTone;
  waited: string;
  baseline: string;
  estimate: string;
  ratio: number | null;
  message: string;
  action: string;
  command: string;
};

export type WaitBudget = {
  pending: number;
  overdue: number;
  watch: number;
  gated: number;
  unknown: number;
  label: string;
  headline: string;
  rows: WaitBudgetItem[];
};

type Baseline = {
  seconds: number | null;
  source: "partition" | "global" | "none";
};

export function buildWaitBudget(jobs: QueueJob[], history: HistoryJob[], alias: string, nowMs = Date.now()): WaitBudget {
  const pending = jobs.filter((job) => job.state === "PENDING");
  const baselines = partitionBaselines(history);
  const global = median(history.map((job) => job.wait_seconds));
  const rows = pending.map((job) => rowFor(job, baselines, global, alias, nowMs)).sort(compareRows);
  const overdue = rows.filter((row) => row.tone === "overdue").length;
  const watch = rows.filter((row) => row.tone === "watch").length;
  const gated = rows.filter((row) => row.tone === "gated").length;
  const unknown = rows.filter((row) => row.tone === "unknown").length;
  return {
    pending: pending.length,
    overdue,
    watch,
    gated,
    unknown,
    label: pending.length ? `${overdue} overdue / ${gated} gated` : "clear",
    headline: headlineFor(pending.length, overdue, watch, gated, unknown),
    rows
  };
}

function rowFor(
  job: QueueJob,
  baselines: Map<string, number>,
  global: number | null,
  alias: string,
  nowMs: number
): WaitBudgetItem {
  const waitedSeconds = secondsSince(job.submit_time, nowMs);
  const baseline = baselineFor(job.partition, baselines, global);
  const gated = isGated(job);
  const ratio = waitedSeconds !== null && baseline.seconds ? waitedSeconds / baseline.seconds : null;
  const tone = toneFor({ gated, waitedSeconds, baselineSeconds: baseline.seconds, ratio });
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    partition: job.partition ?? "n/a",
    tone,
    waited: waitedSeconds === null ? "unknown" : formatDuration(waitedSeconds),
    baseline: baseline.seconds === null ? "no baseline" : `${formatDuration(baseline.seconds)} ${baseline.source} baseline`,
    estimate: job.estimated_start_time ? shortTime(job.estimated_start_time) : "no estimate",
    ratio,
    message: messageFor(job, tone, baseline, ratio),
    action: actionFor(tone, Boolean(job.estimated_start_time)),
    command: `ssh ${alias} 'squeue -j ${job.job_id} --start; sprio -j ${job.job_id}; sacct -j ${job.job_id} --format=JobID,State,Submit,Start,Elapsed,ReqTRES -P'`
  };
}

function partitionBaselines(history: HistoryJob[]): Map<string, number> {
  const groups = new Map<string, Array<number | null>>();
  for (const job of history) {
    if (!job.partition) continue;
    groups.set(job.partition, [...(groups.get(job.partition) ?? []), job.wait_seconds]);
  }
  return new Map(Array.from(groups.entries()).map(([partition, waits]) => [partition, median(waits)]).filter((row): row is [string, number] => row[1] !== null));
}

function baselineFor(partition: string | null, baselines: Map<string, number>, global: number | null): Baseline {
  if (partition && baselines.has(partition)) return { seconds: baselines.get(partition) ?? null, source: "partition" };
  if (global !== null) return { seconds: global, source: "global" };
  return { seconds: null, source: "none" };
}

function toneFor({
  gated,
  waitedSeconds,
  baselineSeconds,
  ratio
}: {
  gated: boolean;
  waitedSeconds: number | null;
  baselineSeconds: number | null;
  ratio: number | null;
}): WaitBudgetTone {
  if (gated) return "gated";
  if (waitedSeconds === null || baselineSeconds === null || ratio === null) return "unknown";
  if (waitedSeconds >= 3600 && ratio >= 4) return "overdue";
  if (ratio >= 1.5) return "watch";
  return "normal";
}

function messageFor(job: QueueJob, tone: WaitBudgetTone, baseline: Baseline, ratio: number | null): string {
  const name = job.name ?? job.job_id;
  if (tone === "gated") return `${name} is gated before wait budget matters; dependency, hold, or begin-time evidence comes first.`;
  if (tone === "unknown") return `${name} lacks enough submit-time or accounting history to score its wait budget.`;
  const multiple = ratio === null ? "" : `${ratio.toFixed(ratio >= 10 ? 0 : 1)}x `;
  const source = baseline.source === "partition" ? `${job.partition ?? "this partition"} partition` : "global";
  if (tone === "overdue") return `${name} has waited ${multiple}beyond the recent ${formatDuration(baseline.seconds)} ${source} baseline.`;
  if (tone === "watch") return `${name} is now past the recent ${formatDuration(baseline.seconds)} ${source} baseline.`;
  return `${name} is still inside the recent ${formatDuration(baseline.seconds)} ${source} wait budget.`;
}

function actionFor(tone: WaitBudgetTone, hasEstimate: boolean): string {
  if (tone === "gated") return "Resolve the gate before changing resources.";
  if (tone === "overdue" && hasEstimate) return "Track whether the start estimate slips; if it does, inspect priority and walltime.";
  if (tone === "overdue") return "Probe sprio and scontrol before waiting blindly.";
  if (tone === "watch") return "Refresh start estimates and compare against priority order before resubmitting.";
  if (tone === "unknown") return "Use sacct and squeue details to build a baseline.";
  return "Avoid churn while the wait remains within recent history.";
}

function headlineFor(pending: number, overdue: number, watch: number, gated: number, unknown: number): string {
  if (!pending) return "No pending jobs need historical wait budgeting in this filter.";
  if (overdue) return `${overdue} pending job${overdue === 1 ? " has" : "s have"} outwaited recent accounting baselines.`;
  if (watch) return `${watch} pending job${watch === 1 ? " is" : "s are"} past recent baseline but not yet extreme.`;
  if (gated) return `${gated} pending job${gated === 1 ? " is" : "s are"} gated before historical wait budgets apply.`;
  if (unknown) return `${unknown} pending job${unknown === 1 ? " needs" : "s need"} more history or submit-time evidence.`;
  return "Visible pending jobs are still inside recent accounting wait budgets.";
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function secondsSince(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.round((nowMs - time) / 1000)) : null;
}

function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value !== null && value !== undefined && value >= 0).sort((left, right) => left - right);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : Math.round((clean[middle - 1] + clean[middle]) / 2);
}

function compareRows(left: WaitBudgetItem, right: WaitBudgetItem): number {
  return toneRank(right.tone) - toneRank(left.tone) || (right.ratio ?? 0) - (left.ratio ?? 0) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: WaitBudgetTone): number {
  return { normal: 0, unknown: 1, gated: 2, watch: 3, overdue: 4 }[tone];
}
