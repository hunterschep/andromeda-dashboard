import type { HistoryJob } from "../types";

export type EfficiencySeverity = "info" | "warning" | "critical";

export type EfficiencyFinding = {
  id: string;
  jobId: string;
  title: string;
  severity: EfficiencySeverity;
  detail: string;
  action: string;
};

export type EfficiencySummary = {
  score: number;
  gpuJobs: number;
  waitHeavy: number;
  shortGpu: number;
  lowGpu: number;
  wideCpu: number;
  memoryWaste: number;
  lowCpu: number;
  findings: EfficiencyFinding[];
};

const severityRank: Record<EfficiencySeverity, number> = { critical: 0, warning: 1, info: 2 };

export function buildEfficiencySummary(jobs: HistoryJob[]): EfficiencySummary {
  const findings = jobs.flatMap(jobFindings).sort(compareFindings).slice(0, 8);
  const gpuJobs = jobs.filter((job) => requestedGpu(job) > 0).length;
  return {
    score: Math.max(0, 100 - findings.length * 11),
    gpuJobs,
    waitHeavy: findings.filter((item) => item.id.startsWith("wait-heavy")).length,
    shortGpu: findings.filter((item) => item.id.startsWith("short-gpu")).length,
    lowGpu: findings.filter((item) => item.id.startsWith("low-gpu")).length,
    wideCpu: findings.filter((item) => item.id.startsWith("wide-cpu")).length,
    memoryWaste: findings.filter((item) => item.id.startsWith("memory-waste")).length,
    lowCpu: findings.filter((item) => item.id.startsWith("low-cpu")).length,
    findings
  };
}

function compareFindings(left: EfficiencyFinding, right: EfficiencyFinding): number {
  return severityRank[left.severity] - severityRank[right.severity] || left.jobId.localeCompare(right.jobId);
}

function jobFindings(job: HistoryJob): EfficiencyFinding[] {
  const findings: EfficiencyFinding[] = [];
  const wait = job.wait_seconds ?? 0;
  const runtime = job.runtime_seconds ?? 0;
  const gpu = requestedGpu(job);
  const cpu = requestedCpu(job);
  const memory = requestedMemoryMb(job);
  const cpuEfficiency = cpuEfficiencyPercent(job, cpu, runtime);
  const gpuUtil = gpuUtilPercent(job);
  if (cpuEfficiency !== null && cpuEfficiency < 25 && runtime > 300) {
    findings.push({
      id: `low-cpu-${job.job_id}`,
      jobId: job.job_id,
      title: "Low CPU efficiency evidence",
      severity: "warning",
      detail: `${cpuEfficiency}% CPU efficiency across ${cpu} allocated CPU(s).`,
      action: "Profile thread count, data loading, and CPU scaling before requesting the same width."
    });
  }
  if (memory && job.max_rss_mb && job.max_rss_mb > 0 && job.max_rss_mb / memory < 0.35) {
    findings.push({
      id: `memory-waste-${job.job_id}`,
      jobId: job.job_id,
      title: "Memory over-request evidence",
      severity: "info",
      detail: `${gb(memory)}GB requested; MaxRSS reached ${gb(job.max_rss_mb)}GB.`,
      action: "Lower memory request next run unless this job was unusually small."
    });
  }
  if (wait > 1800 && runtime > 0 && wait > runtime * 2) {
    findings.push({
      id: `wait-heavy-${job.job_id}`,
      jobId: job.job_id,
      title: "Wait dominated runtime",
      severity: "warning",
      detail: `${minutes(wait)}m wait for ${minutes(runtime)}m runtime on ${job.partition ?? "n/a"}.`,
      action: "Try a shorter walltime, smaller request, or a lower-friction partition."
    });
  }
  if (gpu > 0 && runtime > 0 && runtime < 15 * 60) {
    findings.push({
      id: `short-gpu-${job.job_id}`,
      jobId: job.job_id,
      title: "Short GPU allocation",
      severity: job.state === "COMPLETED" ? "info" : "warning",
      detail: `${gpu} GPU reserved for only ${minutes(runtime)}m of runtime.`,
      action: "Use interactive/debug GPU time for smoke tests before a batch allocation."
    });
  }
  if (gpu > 0 && runtime > 300 && gpuUtil !== null && gpuUtil < 20) {
    findings.push({
      id: `low-gpu-${job.job_id}`,
      jobId: job.job_id,
      title: "Low GPU utilization evidence",
      severity: "warning",
      detail: `${gpuUtil}% average GPU utilization reported by accounting.`,
      action: "Check dataloader throughput, batch size, GPU visibility, and CPU bottlenecks before resubmitting."
    });
  }
  if (cpu >= 32 && runtime > 0 && runtime < 30 * 60) {
    findings.push({
      id: `wide-cpu-${job.job_id}`,
      jobId: job.job_id,
      title: "Wide CPU request, short run",
      severity: "info",
      detail: `${cpu} CPUs requested for ${minutes(runtime)}m.`,
      action: "Benchmark scaling; fewer CPUs may start faster with similar throughput."
    });
  }
  if (gpu > 0 && job.state !== "COMPLETED") {
    findings.push({
      id: `failed-gpu-${job.job_id}`,
      jobId: job.job_id,
      title: "GPU allocation failed",
      severity: "critical",
      detail: `${gpu} GPU job ended as ${job.state} with exit ${job.exit_code ?? "n/a"}.`,
      action: "Check CUDA/modules and run a small validation before resubmitting."
    });
  }
  return findings;
}

function requestedCpu(job: HistoryJob): number {
  const requested = job.requested_tres ?? {};
  const allocated = job.allocated_tres ?? {};
  return Number(requested.cpu ?? allocated.cpu ?? 0) || 0;
}

function requestedGpu(job: HistoryJob): number {
  const requested = job.requested_tres ?? {};
  return Number(requested["gres/gpu"] ?? requested.gpu ?? 0) || 0;
}

function cpuEfficiencyPercent(job: HistoryJob, cpus: number, runtime: number): number | null {
  if (!job.total_cpu_seconds || !cpus || !runtime) return null;
  return Math.round((job.total_cpu_seconds / (cpus * runtime)) * 100);
}

function gpuUtilPercent(job: HistoryJob): number | null {
  const keys = ["gres/gpuutil", "gpuutil", "gres/gpu_util", "gpu_util"];
  for (const source of [job.tres_usage_in_ave ?? {}, job.tres_usage_in_max ?? {}]) {
    for (const key of keys) {
      const value = source[key];
      const match = value?.match(/\d+(?:\.\d+)?/);
      if (match) return Math.round(Number(match[0]));
    }
  }
  return null;
}

function requestedMemoryMb(job: HistoryJob): number | null {
  const requested = job.requested_tres ?? {};
  const allocated = job.allocated_tres ?? {};
  const text = requested.mem ?? allocated.mem;
  if (!text) return null;
  const match = /^(\d+(?:\.\d+)?)([KMGTP]?)$/i.exec(text);
  if (!match) return null;
  const factor: Record<string, number> = { "": 1, K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024, P: 1024 ** 3 };
  return Math.round(Number(match[1]) * factor[match[2].toUpperCase()]);
}

function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function gb(memoryMb: number): number {
  return Math.max(1, Math.round(memoryMb / 1024));
}
