import { formatDuration } from "../api";
import type { HistoryJob } from "../types";

export type SupportPacketTone = "info" | "warning" | "critical";

export type SupportPacket = {
  jobId: string;
  title: string;
  tone: SupportPacketTone;
  detail: string;
  facts: { label: string; value: string }[];
  command: string;
};

export type SupportPacketSummary = {
  failed: number;
  label: string;
  message: string;
  packets: SupportPacket[];
};

export function buildSupportPackets(jobs: HistoryJob[], alias: string): SupportPacketSummary {
  const failedJobs = jobs.filter(isFailed).slice(0, 5);
  const packets = failedJobs.map((job) => packetFor(job, alias));
  return {
    failed: failedJobs.length,
    label: labelFor(packets.length),
    message: messageFor(packets.length),
    packets,
  };
}

function packetFor(job: HistoryJob, alias: string): SupportPacket {
  const gpu = requestedGpu(job);
  const title = titleFor(job, gpu);
  return {
    jobId: job.job_id,
    title,
    tone: toneFor(job, gpu),
    detail: detailFor(job, gpu),
    facts: [
      { label: "state", value: job.state },
      { label: "exit", value: job.exit_code ?? "n/a" },
      { label: "runtime", value: formatDuration(job.runtime_seconds) },
      { label: "request", value: tresText(job.requested_tres) },
    ],
    command: supportCommand(alias, job, gpu > 0),
  };
}

function titleFor(job: HistoryJob, gpu: number): string {
  const state = job.state.toUpperCase();
  if (state.includes("TIMEOUT")) return "Timeout support packet";
  if (state.includes("OOM") || job.exit_code?.startsWith("0:9")) return "Memory kill support packet";
  if (gpu > 0) return "GPU failure support packet";
  return "Application exit support packet";
}

function detailFor(job: HistoryJob, gpu: number): string {
  const base = "Collects Slurm accounting, job detail, resolved logs, quota, and environment context.";
  if (gpu > 0) return `${base} Adds module + CUDA context from the login environment.`;
  if (job.state.toUpperCase().includes("TIMEOUT")) return `${base} Emphasizes timeline and walltime evidence.`;
  return `${base} Ready to paste into a help request or personal debug note.`;
}

function toneFor(job: HistoryJob, gpu: number): SupportPacketTone {
  const state = job.state.toUpperCase();
  if (state.includes("NODE_FAIL") || state.includes("BOOT_FAIL") || state.includes("OOM")) return "critical";
  if (gpu > 0 || state.includes("TIMEOUT") || state.includes("FAILED")) return "warning";
  return "info";
}

function supportCommand(alias: string, job: HistoryJob, includeCuda: boolean): string {
  const lines = [
    "set -euo pipefail",
    `job=${shellQuote(job.job_id)}`,
    "echo \"== Andromeda support packet: $job ==\"",
    "date; hostname; whoami",
    "echo \"== accounting ==\"",
    "sacct -j \"$job\" --format=JobID,JobName,User,Account,Partition,State,ExitCode,Elapsed,Timelimit,Submit,Start,End,ReqTRES,AllocTRES,MaxRSS,TRESUsageInAve,TRESUsageInMax -P",
    "echo \"== job detail ==\"",
    "detail=$(scontrol show job -dd \"$job\" 2>/dev/null || true)",
    "printf \"%s\\n\" \"$detail\" | sed -n \"1,160p\"",
    "echo \"== resolved logs ==\"",
    "for field in StdOut StdErr; do path=$(printf \"%s\\n\" \"$detail\" | sed -n \"s/.*$field=\\([^ ]*\\).*/\\1/p\"); if [[ -n \"$path\" && \"$path\" != \"(null)\" ]]; then echo \"== $field $path ==\"; tail -n 160 \"$path\" 2>/dev/null || true; fi; done",
    "echo \"== storage quota ==\"",
    "acct-chk \"$USER\" 2>/dev/null || true",
    "echo \"== loaded modules ==\"",
    "module list 2>&1 || true",
  ];
  if (includeCuda) lines.push("echo \"== CUDA modules visible ==\"", "module avail cuda 2>&1 | tail -n 80 || true");
  return `ssh ${alias} ${shellQuote(lines.join("; "))}`;
}

function labelFor(count: number): string {
  return count ? `${count} packet${count === 1 ? "" : "s"} ready` : "no packets";
}

function messageFor(count: number): string {
  if (count) return "Copy a complete debug packet before asking for help or rerunning a failed experiment.";
  return "No failed jobs in this history window need a support packet.";
}

function isFailed(job: HistoryJob): boolean {
  const state = job.state.toUpperCase();
  return !state.includes("COMPLETED") && !state.includes("RUNNING");
}

function requestedGpu(job: HistoryJob): number {
  return Number(job.allocated_tres?.["gres/gpu"] ?? job.requested_tres?.["gres/gpu"] ?? job.requested_tres?.gpu ?? 0) || 0;
}

function tresText(values: Record<string, string>): string {
  const entries = Object.entries(values ?? {});
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "n/a";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
