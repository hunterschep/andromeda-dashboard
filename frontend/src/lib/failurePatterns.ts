import type { HistoryJob } from "../types";

export type FailurePattern = {
  kind: string;
  title: string;
  tone: "info" | "warning" | "critical";
  jobs: number;
  gpuJobs: number;
  partitions: string[];
  examples: string[];
  message: string;
  action: string;
  command: string;
};

export type FailurePatternSummary = {
  totalFailed: number;
  label: string;
  patterns: FailurePattern[];
};

type PatternGroup = {
  kind: string;
  rows: HistoryJob[];
};

export function buildFailurePatterns(jobs: HistoryJob[], alias: string): FailurePatternSummary {
  const failed = jobs.filter(isFailure);
  const groups = groupByKind(failed);
  const patterns = Array.from(groups.entries())
    .map(([kind, rows]) => patternFor({ kind, rows }, alias))
    .sort(comparePatterns);
  return {
    totalFailed: failed.length,
    label: failed.length ? `${patterns.length} pattern${patterns.length === 1 ? "" : "s"}` : "clean",
    patterns
  };
}

function patternFor(group: PatternGroup, alias: string): FailurePattern {
  const gpuJobs = group.rows.filter((job) => requestedGpu(job) > 0).length;
  const partitions = Array.from(new Set(group.rows.map((job) => job.partition ?? "unknown"))).sort();
  const examples = group.rows.map((job) => job.job_id).slice(0, 5);
  const meta = metaFor(group.kind, group.rows.length, gpuJobs);
  return {
    kind: group.kind,
    title: meta.title,
    tone: meta.tone,
    jobs: group.rows.length,
    gpuJobs,
    partitions,
    examples,
    message: meta.message,
    action: meta.action,
    command: commandFor(alias, examples)
  };
}

function groupByKind(jobs: HistoryJob[]): Map<string, HistoryJob[]> {
  const groups = new Map<string, HistoryJob[]>();
  for (const job of jobs) {
    const kind = kindFor(job);
    groups.set(kind, [...(groups.get(kind) ?? []), job]);
  }
  return groups;
}

function kindFor(job: HistoryJob): string {
  const state = job.state.toUpperCase();
  if (state.includes("OUT_OF_MEMORY") || state.includes("OOM") || job.exit_code?.startsWith("0:9")) return "memory";
  if (state.includes("TIMEOUT")) return "timeout";
  if (state.includes("NODE_FAIL") || state.includes("BOOT_FAIL")) return "node";
  if (state.includes("CANCELLED")) return "cancelled";
  if (requestedGpu(job) > 0) return "gpu";
  return "application";
}

function metaFor(kind: string, jobs: number, gpuJobs: number) {
  if (kind === "memory") {
    return {
      title: "Memory pressure pattern",
      tone: "critical" as const,
      message: `${jobs} job${jobs === 1 ? "" : "s"} look like memory kills or kill-signal exits.`,
      action: "Compare MaxRSS to requested memory before scaling this workload again."
    };
  }
  if (kind === "timeout") {
    return {
      title: "Walltime exhaustion pattern",
      tone: "warning" as const,
      message: `${jobs} job${jobs === 1 ? "" : "s"} hit a time limit before completion.`,
      action: "Add checkpoints, shorten the experiment, or move only mature runs to longer partitions."
    };
  }
  if (kind === "gpu") {
    return {
      title: "GPU/application failure pattern",
      tone: "warning" as const,
      message: `${jobs} failed job${jobs === 1 ? "" : "s"} include ${gpuJobs} GPU allocation${gpuJobs === 1 ? "" : "s"}.`,
      action: "Run a small CUDA/module/data-path validation before resubmitting the full request."
    };
  }
  if (kind === "node") {
    return {
      title: "Node-side failure pattern",
      tone: "critical" as const,
      message: `${jobs} job${jobs === 1 ? "" : "s"} point to node or infrastructure failure.`,
      action: "Resubmit deterministic work and keep job IDs ready for a support request."
    };
  }
  if (kind === "cancelled") {
    return {
      title: "Cancellation pattern",
      tone: "info" as const,
      message: `${jobs} job${jobs === 1 ? "" : "s"} were cancelled before normal completion.`,
      action: "Check whether cancellation was user-driven, dependency-driven, or policy-driven."
    };
  }
  return {
    title: "Application exit pattern",
    tone: "warning" as const,
    message: `${jobs} job${jobs === 1 ? "" : "s"} exited unsuccessfully without a clearer scheduler class.`,
    action: "Inspect stderr/stdout, exit code, module stack, and input paths before resubmission."
  };
}

function commandFor(alias: string, examples: string[]): string {
  const ids = examples.join(",");
  return `ssh ${alias} 'sacct -j ${ids} --format=JobID,JobName,State,ExitCode,Elapsed,Partition,ReqTRES,AllocTRES,MaxRSS -P'`;
}

function isFailure(job: HistoryJob): boolean {
  const state = job.state.toUpperCase();
  return !["COMPLETED", "RUNNING"].some((healthy) => state.includes(healthy));
}

function requestedGpu(job: HistoryJob): number {
  const requested = job.requested_tres ?? {};
  return Number(requested["gres/gpu"] ?? requested.gpu ?? 0) || 0;
}

function comparePatterns(left: FailurePattern, right: FailurePattern): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.jobs - left.jobs || left.title.localeCompare(right.title);
}

function toneRank(tone: FailurePattern["tone"]): number {
  return { info: 0, warning: 1, critical: 2 }[tone];
}
