import type { HistoryResponse, PriorityJob, QueueJob, QueuePredictionResponse, SchedulerHealth } from "../types";

export type QueueConfidenceTone = "strong" | "usable" | "thin";

export type QueueConfidenceRow = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: QueueConfidenceTone;
};

export type QueueConfidence = {
  score: number;
  label: string;
  headline: string;
  rows: QueueConfidenceRow[];
  command: string;
};

export function buildQueueConfidence({
  jobs,
  priorityJobs,
  scheduler,
  history,
  prediction,
  alias
}: {
  jobs: QueueJob[];
  priorityJobs: PriorityJob[];
  scheduler: SchedulerHealth | null;
  history: HistoryResponse | null;
  prediction: QueuePredictionResponse | null;
  alias: string;
}): QueueConfidence {
  const pending = jobs.filter((job) => job.state === "PENDING");
  const dated = pending.filter((job) => Boolean(job.estimated_start_time)).length;
  const gated = pending.filter(isGated).length;
  const decoded = pending.filter((job) => priorityJobs.some((item) => item.job_id === job.job_id)).length;
  const blind = pending.length - dated - gated;
  const rows = [
    startRow(pending.length, dated, gated),
    priorityRow(pending.length, decoded),
    schedulerRow(scheduler),
    historyRow(history),
    gateRow(pending.length, gated),
    predictionRow(prediction)
  ];
  const score = Math.min(100, rows.reduce((sum, row) => sum + points(row), 0));
  return {
    score,
    label: `${score}% confidence / ${Math.max(0, blind)} blind wait${blind === 1 ? "" : "s"}`,
    headline: headlineFor(score, pending.length, dated, decoded, gated, blind),
    rows,
    command: `ssh ${alias} 'squeue -t PD --start; sprio -h -o "%.18i|%.12Y|%.12A|%.12F|%.12J|%.12P|%.12Q|%.12T"; sdiag 2>/dev/null | sed -n "1,80p"'`
  };
}

function startRow(pending: number, dated: number, gated: number): QueueConfidenceRow {
  if (!pending) return row("starts", "Public starts", "clear", "No pending jobs need start estimates.", "strong");
  const eligible = Math.max(0, pending - gated);
  if (dated >= eligible && eligible > 0) return row("starts", "Public starts", `${dated}/${pending}`, "All non-gated pending jobs expose dated starts.", "strong");
  if (dated > 0) return row("starts", "Public starts", `${dated}/${pending}`, "Some jobs expose start estimates; remaining waits need priority or fit evidence.", "usable");
  return row("starts", "Public starts", `0/${pending}`, "No pending job exposes a public start estimate.", "thin");
}

function priorityRow(pending: number, decoded: number): QueueConfidenceRow {
  if (!pending) return row("priority", "Priority rows", "clear", "No pending jobs need priority decoding.", "strong");
  if (decoded === pending) return row("priority", "Priority rows", `${decoded}/${pending}`, "Every visible pending job has decoded sprio factors.", "strong");
  if (decoded > 0) return row("priority", "Priority rows", `${decoded}/${pending}`, "Some pending jobs have priority rows; the rest need sprio inspection.", "usable");
  return row("priority", "Priority rows", `0/${pending}`, "sprio factors are missing for visible pending jobs.", "thin");
}

function schedulerRow(scheduler: SchedulerHealth | null): QueueConfidenceRow {
  if (!scheduler) return row("scheduler", "Scheduler telemetry", "missing", "sdiag data is not available for this snapshot.", "thin");
  const depth = scheduler.backfill_last_depth ?? "n/a";
  const cycle = scheduler.mean_cycle_seconds ?? scheduler.last_cycle_seconds;
  return row("scheduler", "Scheduler telemetry", `${depth} depth`, `Backfill and cycle data are visible${cycle === null ? "." : `; mean cycle ${cycle}s.`}`, "strong");
}

function historyRow(history: HistoryResponse | null): QueueConfidenceRow {
  if (!history?.jobs.length || history.median_wait_seconds === null) {
    return row("history", "History baseline", "missing", "Recent accounting does not expose a wait baseline.", "thin");
  }
  return row("history", "History baseline", `${Math.round(history.median_wait_seconds / 60)}m median`, `${history.jobs.length} recent job lifecycle(s) anchor wait comparisons.`, "strong");
}

function gateRow(pending: number, gated: number): QueueConfidenceRow {
  if (!pending) return row("gates", "Scheduler gates", "clear", "No pending gates are visible.", "strong");
  if (!gated) return row("gates", "Scheduler gates", "none", "No dependency, hold, or begin-time gates are visible.", "strong");
  return row("gates", "Scheduler gates", `${gated}/${pending}`, "Gated jobs are explainable, but capacity-based wait estimates should ignore them until the gate clears.", "usable");
}

function predictionRow(prediction: QueuePredictionResponse | null): QueueConfidenceRow {
  if (!prediction) return row("prediction", "Prediction model", "missing", "Queue prediction feed is unavailable.", "thin");
  const tone = prediction.confidence === "high" ? "strong" : prediction.confidence === "medium" ? "usable" : "thin";
  return row("prediction", "Prediction model", prediction.confidence, `${prediction.wait_band}; ${prediction.recommendation}`, tone);
}

function headlineFor(score: number, pending: number, dated: number, decoded: number, gated: number, blind: number): string {
  if (!pending) return "No pending queue waits need confidence scoring in this filter.";
  if (blind > 0) return `${blind} pending wait${blind === 1 ? "" : "s"} remain blind; probe start estimates, priority, and fit before changing submissions.`;
  if (score >= 75) return `Queue estimates are defensible: ${dated} dated start${dated === 1 ? "" : "s"}, ${decoded} priority row${decoded === 1 ? "" : "s"}, and ${gated} gated wait${gated === 1 ? "" : "s"} explain the visible queue.`;
  return `Queue confidence is partial: ${dated} dated start${dated === 1 ? "" : "s"} and ${decoded} priority row${decoded === 1 ? "" : "s"} explain some waits, but confidence remains limited.`;
}

function row(
  id: string,
  label: string,
  value: string,
  detail: string,
  tone: QueueConfidenceTone
): QueueConfidenceRow {
  return { id, label, value, detail, tone };
}

function points(rowItem: QueueConfidenceRow): number {
  if (rowItem.id === "prediction") return rowItem.tone === "strong" ? 10 : rowItem.tone === "usable" ? 6 : 3;
  return rowItem.tone === "strong" ? 18 : rowItem.tone === "usable" ? 10 : 0;
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""} ${job.dependency ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}
