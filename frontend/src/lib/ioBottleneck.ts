import { formatMemory } from "../api";
import type { HistoryJob } from "../types";

export type IoTone = "heavy" | "watch" | "unknown";

export type IoFinding = {
  jobId: string;
  name: string;
  tone: IoTone;
  throughput: string;
  volume: string;
  runtime: string;
  signal: string;
  action: string;
};

export type IoBottleneckRadar = {
  label: string;
  headline: string;
  observed: number;
  heavy: number;
  missing: number;
  findings: IoFinding[];
};

const IO_KEYS = /fs|disk|lustre|gpfs|read|write|io/i;

export function buildIoBottleneckRadar(jobs: HistoryJob[]): IoBottleneckRadar {
  const finished = jobs.filter((job) => (job.runtime_seconds ?? 0) > 0);
  const findings = finished.map(findingFor).sort(compareFindings).slice(0, 6);
  const observed = findings.filter((item) => item.tone !== "unknown").length;
  const heavy = findings.filter((item) => item.tone === "heavy").length;
  const missing = findings.filter((item) => item.tone === "unknown").length;
  return {
    label: observed ? `${heavy} data-heavy run${heavy === 1 ? "" : "s"}` : "counters absent",
    headline: headlineFor(observed, heavy, missing),
    observed,
    heavy,
    missing,
    findings
  };
}

function findingFor(job: HistoryJob): IoFinding {
  const runtime = job.runtime_seconds ?? 0;
  const bytes = ioBytes(job);
  if (!bytes) return unknownFinding(job, runtime);
  const mb = bytes / 1024 / 1024;
  const mbPerSecond = mb / Math.max(runtime, 1);
  const tone = mbPerSecond >= 250 || mb >= 1024 * 1024 ? "heavy" : "watch";
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone,
    throughput: `${Math.round(mbPerSecond)} MB/s`,
    volume: formatMemory(mb),
    runtime: runtimeText(runtime),
    signal: `${job.name ?? job.job_id} moved ${formatMemory(mb)} through filesystem counters.`,
    action: tone === "heavy" ? "Stage hot data on scratch, reduce small-file churn, and checkpoint less frequently." : "Keep logs and checkpoints batched; I/O does not dominate this accounting record."
  };
}

function unknownFinding(job: HistoryJob, runtime: number): IoFinding {
  const lowCpu = cpuEfficiency(job) !== null && (cpuEfficiency(job) ?? 100) < 25;
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone: "unknown",
    throughput: "not reported",
    volume: "n/a",
    runtime: runtimeText(runtime),
    signal: lowCpu
      ? `${job.name ?? job.job_id} has low CPU efficiency, but Slurm did not expose filesystem counters.`
      : `${job.name ?? job.job_id} did not expose filesystem I/O counters in accounting.`,
    action: "Inspect stdout/stderr for dataloader stalls and use job-local timing before blaming storage."
  };
}

function ioBytes(job: HistoryJob): number | null {
  const pairs = Object.entries({ ...(job.tres_usage_in_ave ?? {}), ...(job.tres_usage_in_max ?? {}) });
  const values = pairs.filter(([key]) => IO_KEYS.test(key)).map(([, value]) => parseBytes(value)).filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

function parseBytes(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*([KMGTPE]?)(?:I?B)?/i.exec(value);
  if (!match) return null;
  const unit = match[2].toUpperCase();
  const factors: Record<string, number> = {
    "": 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
    E: 1024 ** 6
  };
  return Number(match[1]) * factors[unit];
}

function cpuEfficiency(job: HistoryJob): number | null {
  const cpus = Number(job.allocated_tres.cpu ?? job.requested_tres.cpu ?? 0);
  const runtime = job.runtime_seconds ?? 0;
  if (!cpus || !runtime || !job.total_cpu_seconds) return null;
  return Math.round((job.total_cpu_seconds / (cpus * runtime)) * 100);
}

function runtimeText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function headlineFor(observed: number, heavy: number, missing: number): string {
  if (heavy) return `${heavy} recent job${heavy === 1 ? " shows" : "s show"} heavy filesystem movement.`;
  if (observed) return "Filesystem counters are present without a severe I/O signal.";
  if (missing) return "Recent jobs lack filesystem counters; I/O needs log-level evidence.";
  return "No recent jobs are available for I/O analysis.";
}

function compareFindings(left: IoFinding, right: IoFinding): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: IoTone): number {
  return { unknown: 0, watch: 1, heavy: 2 }[tone];
}
