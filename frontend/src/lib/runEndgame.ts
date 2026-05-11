import { formatDuration } from "../api";
import type { HistoryResponse, QueueJob, StorageResponse, StorageVolume } from "../types";

export type RunEndgameTone = "steady" | "watch" | "urgent" | "unknown";

export type RunEndgameRow = {
  jobId: string;
  name: string;
  tone: RunEndgameTone;
  node: string;
  remaining: string;
  progress: number | null;
  storage: string;
  risk: string;
  headline: string;
  action: string;
  command: string;
};

export type RunEndgame = {
  label: string;
  headline: string;
  rows: RunEndgameRow[];
};

export function buildRunEndgame({
  jobs,
  history,
  storage,
  alias
}: {
  jobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  alias: string;
}): RunEndgame {
  const active = jobs.filter((job) => job.state === "RUNNING");
  const pressure = worstVolume(storage);
  const gpuFailures = recentGpuFailures(history);
  const rows = active.map((job) => rowFor(job, pressure, gpuFailures, alias)).sort(compareRows);
  const urgent = rows.filter((row) => row.tone === "urgent").length;
  const watch = rows.filter((row) => row.tone === "watch").length;
  return {
    label: labelFor(urgent, watch, rows.filter((row) => row.tone === "unknown").length),
    headline: headlineFor(rows.length, urgent, watch, pressure),
    rows
  };
}

function rowFor(job: QueueJob, pressure: StorageVolume | null, gpuFailures: number, alias: string): RunEndgameRow {
  const remainingSeconds = remaining(job);
  const progress = progressPercent(job);
  const tone = toneFor(job, remainingSeconds, progress, pressure);
  const storage = storageText(pressure);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone,
    node: job.nodes.join(", ") || "node not exposed",
    remaining: remainingSeconds === null ? "unknown" : formatDuration(remainingSeconds),
    progress,
    storage,
    risk: riskFor(tone, pressure, gpuFailures, job),
    headline: rowHeadline(job, tone, remainingSeconds, pressure, gpuFailures),
    action: actionFor(tone, pressure, job),
    command: probe(alias, job.job_id)
  };
}

function headlineFor(total: number, urgent: number, watch: number, pressure: StorageVolume | null): string {
  if (!total) return "No running allocations need endgame planning right now.";
  if (urgent) return `${urgent} allocation${urgent === 1 ? " needs" : "s need"} final checkpoint/log capture before walltime closes.`;
  if (pressure?.severity === "critical") return "Storage pressure can turn clean exits into missing artifacts.";
  if (watch) return `${watch} running allocation${watch === 1 ? "" : "s"} should keep checkpoint and log capture visible.`;
  return "Running allocations have enough visible runway for normal monitoring.";
}

function rowHeadline(
  job: QueueJob,
  tone: RunEndgameTone,
  remainingSeconds: number | null,
  pressure: StorageVolume | null,
  gpuFailures: number
): string {
  const name = job.name ?? job.job_id;
  const storage = pressure?.severity === "critical" && pressure.percent_used !== null ? `${pressure.name} at ${pressure.percent_used}%` : null;
  const failure = gpuFailures && job.gpu_count ? `${gpuFailures} recent GPU failure signal${gpuFailures === 1 ? "" : "s"}` : null;
  const details = [storage, failure].filter(Boolean).join(" and ");
  if (tone === "urgent") {
    return `${name} is inside final ${formatDuration(remainingSeconds)}${details ? ` with ${details}` : ""}.`;
  }
  if (tone === "watch") {
    const left = remainingSeconds === null ? "unknown runway" : `${formatDuration(remainingSeconds)} left`;
    return `${name} has ${left}; storage pressure can still break notebooks, logs, or environment writes.`;
  }
  if (tone === "unknown") return `${name} is running without enough walltime evidence for a reliable endgame plan.`;
  return `${name} has ${formatDuration(remainingSeconds)} left with no urgent artifact risk visible.`;
}

function actionFor(tone: RunEndgameTone, pressure: StorageVolume | null, job: QueueJob): string {
  if (tone === "urgent" && job.gpu_count) return "Capture checkpoint, logs, accounting, and GPU telemetry before the allocation expires.";
  if (tone === "urgent") return "Capture checkpoint, stdout, stderr, and accounting before the allocation expires.";
  if (pressure?.severity === "critical") return "Confirm output paths are writable before assuming the run can finish cleanly.";
  if (tone === "unknown") return "Recover timelimit and output paths from scontrol before trusting the remaining runway.";
  return "Keep normal monitoring active and verify artifacts before starting another dependent run.";
}

function riskFor(tone: RunEndgameTone, pressure: StorageVolume | null, gpuFailures: number, job: QueueJob): string {
  if (tone === "urgent") return "final walltime";
  if (pressure?.severity === "critical") return "artifact loss";
  if (gpuFailures && job.gpu_count) return "GPU repeat risk";
  if (tone === "unknown") return "unknown deadline";
  return "normal";
}

function toneFor(
  job: QueueJob,
  remainingSeconds: number | null,
  progress: number | null,
  pressure: StorageVolume | null
): RunEndgameTone {
  if (remainingSeconds === null || progress === null) return "unknown";
  if (remainingSeconds <= 3600 || progress >= 90) return "urgent";
  if (pressure?.severity === "critical" || job.gpu_count > 0 || remainingSeconds <= 4 * 3600) return "watch";
  return "steady";
}

function worstVolume(storage: StorageResponse | null): StorageVolume | null {
  if (!storage?.volumes.length) return null;
  return [...storage.volumes].sort((left, right) => severityRank(right) - severityRank(left) || (right.percent_used ?? 0) - (left.percent_used ?? 0))[0];
}

function recentGpuFailures(history: HistoryResponse | null): number {
  return (history?.jobs ?? []).filter((job) => {
    const requestedGpu = Object.entries({ ...job.requested_tres, ...job.allocated_tres }).some(([key, value]) => key.toLowerCase().includes("gpu") && value !== "0");
    return job.state !== "COMPLETED" && requestedGpu;
  }).length;
}

function progressPercent(job: QueueJob): number | null {
  if (job.elapsed_seconds === null || job.elapsed_seconds === undefined || !job.time_limit_seconds) return null;
  return Math.min(100, Math.round((job.elapsed_seconds / job.time_limit_seconds) * 100));
}

function remaining(job: QueueJob): number | null {
  if (job.elapsed_seconds === null || job.elapsed_seconds === undefined || !job.time_limit_seconds) return null;
  return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
}

function storageText(volume: StorageVolume | null): string {
  if (!volume) return "not loaded";
  return volume.percent_used === null ? volume.name : `${volume.name} ${volume.percent_used}%`;
}

function labelFor(urgent: number, watch: number, unknown: number): string {
  if (urgent || watch) return `${urgent} urgent / ${watch} watch`;
  if (unknown) return `${unknown} unknown deadline${unknown === 1 ? "" : "s"}`;
  return "endgames clear";
}

function compareRows(left: RunEndgameRow, right: RunEndgameRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || (right.progress ?? -1) - (left.progress ?? -1) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: RunEndgameTone): number {
  return { steady: 0, unknown: 1, watch: 2, urgent: 3 }[tone];
}

function severityRank(volume: StorageVolume): number {
  return volume.severity === "critical" ? 2 : volume.severity === "warning" ? 1 : 0;
}

function probe(alias: string, jobId: string): string {
  return `ssh ${alias} 'scontrol show job -dd ${jobId} | sed -n "1,140p"; sacct -j ${jobId} --format=JobID,JobName,State,Elapsed,Timelimit,End,AllocTRES,TRESUsageInAve,TRESUsageInMax -P; acct-chk "$USER" 2>/dev/null || true'`;
}
