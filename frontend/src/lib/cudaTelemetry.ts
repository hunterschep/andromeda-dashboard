import type { HistoryJob } from "../types";

export type CudaTone = "compute" | "memory" | "starved" | "unknown";

export type CudaTelemetryJob = {
  jobId: string;
  name: string;
  tone: CudaTone;
  gpuUtil: number | null;
  gpuMemoryMb: number | null;
  gpuCount: number;
  title: string;
  detail: string;
  action: string;
  command: string;
};

export type CudaTelemetry = {
  gpuJobs: number;
  medianUtil: number | null;
  maxMemoryMb: number | null;
  label: string;
  summary: string;
  jobs: CudaTelemetryJob[];
};

export function buildCudaTelemetry(jobs: HistoryJob[], alias: string): CudaTelemetry {
  const rows = jobs.filter((job) => requestedGpu(job) > 0).map((job) => row(job, alias)).sort(compareRows);
  const utils = rows.map((item) => item.gpuUtil).filter((value): value is number => value !== null);
  const memory = rows.map((item) => item.gpuMemoryMb).filter((value): value is number => value !== null);
  const medianUtil = median(utils);
  const maxMemoryMb = memory.length ? Math.max(...memory) : null;
  return {
    gpuJobs: rows.length,
    medianUtil,
    maxMemoryMb,
    label: labelFor(rows, medianUtil),
    summary: summaryFor(rows, medianUtil, maxMemoryMb),
    jobs: rows
  };
}

function row(job: HistoryJob, alias: string): CudaTelemetryJob {
  const gpuUtil = gpuUtilPercent(job);
  const gpuMemoryMb = gpuMemory(job);
  const tone = toneFor(gpuUtil, gpuMemoryMb, job.state);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    tone,
    gpuUtil,
    gpuMemoryMb,
    gpuCount: requestedGpu(job),
    title: titleFor(tone),
    detail: detailFor(tone, gpuUtil, gpuMemoryMb, job),
    action: actionFor(tone),
    command: `ssh ${alias} 'sacct -j ${job.job_id} --format=JobID,JobName,State,Elapsed,AllocTRES,TRESUsageInAve,TRESUsageInMax -P'`
  };
}

function toneFor(util: number | null, memoryMb: number | null, state: string): CudaTone {
  if (util === null && memoryMb === null) return "unknown";
  if (util !== null && util >= 70) return "compute";
  if (memoryMb !== null && memoryMb >= 20 * 1024 && (util ?? 0) >= 35) return "memory";
  if (util !== null && util < 25) return "starved";
  if (state !== "COMPLETED" && util !== null && util < 40) return "starved";
  return "unknown";
}

function titleFor(tone: CudaTone): string {
  if (tone === "compute") return "Compute-bound GPU run";
  if (tone === "memory") return "VRAM-pressure run";
  if (tone === "starved") return "GPU starvation pattern";
  return "Incomplete CUDA telemetry";
}

function detailFor(tone: CudaTone, util: number | null, memoryMb: number | null, job: HistoryJob): string {
  const utilText = util === null ? "n/a" : `${util}%`;
  const memoryText = memoryMb === null ? "n/a" : `${Math.round(memoryMb / 1024)}GB`;
  if (tone === "starved") return `${job.name ?? job.job_id} averaged ${utilText} GPU util with ${memoryText} GPU memory reported.`;
  if (tone === "compute") return `${job.name ?? job.job_id} kept the GPU busy at ${utilText} utilization.`;
  if (tone === "memory") return `${job.name ?? job.job_id} used ${memoryText} GPU memory with ${utilText} utilization.`;
  return `${job.name ?? job.job_id} lacks enough Slurm GPU utilization or memory counters for a confident read.`;
}

function actionFor(tone: CudaTone): string {
  if (tone === "starved") return "Check dataloader throughput, batch size, CPU workers, and CUDA visibility before requesting larger GPUs.";
  if (tone === "compute") return "This shape looks worth repeating; queue strategy matters more than utilization tuning.";
  if (tone === "memory") return "Keep VRAM headroom in mind before shrinking GPU type or increasing batch size.";
  return "Use the accounting probe and job logs before drawing conclusions from this run.";
}

function labelFor(rows: CudaTelemetryJob[], medianUtil: number | null): string {
  if (!rows.length) return "no GPU history";
  if (rows.some((row) => row.tone === "starved")) return "starvation visible";
  if (medianUtil !== null && medianUtil >= 70) return "GPU busy";
  return "telemetry partial";
}

function summaryFor(rows: CudaTelemetryJob[], medianUtil: number | null, maxMemoryMb: number | null): string {
  if (!rows.length) return "No recent GPU accounting rows are available for CUDA telemetry.";
  if (rows.some((row) => row.tone === "starved")) return "Recent GPU accounting suggests at least one run reserved accelerator time without keeping the device busy.";
  if (medianUtil !== null && medianUtil >= 70) return "Recent GPU jobs look compute-bound enough to focus on queue timing and checkpoint safety.";
  if (maxMemoryMb !== null) return `GPU memory peaked around ${Math.round(maxMemoryMb / 1024)}GB, but utilization evidence is incomplete.`;
  return "GPU accounting exists, but Slurm did not expose enough utilization or memory counters for a strong conclusion.";
}

function requestedGpu(job: HistoryJob): number {
  const source = job.allocated_tres["gres/gpu"] ? job.allocated_tres : job.requested_tres;
  return Number(source["gres/gpu"] ?? source.gpu ?? 0) || 0;
}

function gpuUtilPercent(job: HistoryJob): number | null {
  return readNumber(job.tres_usage_in_ave, ["gres/gpuutil", "gpuutil", "gres/gpu_util", "gpu_util"]);
}

function gpuMemory(job: HistoryJob): number | null {
  const raw = readRaw(job.tres_usage_in_max, ["gres/gpumem", "gpumem", "gres/gpu_mem", "gpu_mem"]) ?? readRaw(job.tres_usage_in_ave, ["gres/gpumem", "gpumem", "gres/gpu_mem", "gpu_mem"]);
  return raw ? memoryMb(raw) : null;
}

function readNumber(source: Record<string, string>, keys: string[]): number | null {
  const raw = readRaw(source, keys);
  const match = raw?.match(/\d+(?:\.\d+)?/);
  return match ? Math.round(Number(match[0])) : null;
}

function readRaw(source: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) if (source[key]) return source[key];
  return null;
}

function memoryMb(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*([KMGTP]?)/i);
  if (!match) return null;
  const unit = match[2].toUpperCase();
  const factor: Record<string, number> = { "": 1, K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024, P: 1024 ** 3 };
  return Number(match[1]) * factor[unit];
}

function median(values: number[]): number | null {
  const clean = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : Math.round((clean[middle - 1] + clean[middle]) / 2);
}

function compareRows(left: CudaTelemetryJob, right: CudaTelemetryJob): number {
  return toneRank(right.tone) - toneRank(left.tone) || (left.gpuUtil ?? 999) - (right.gpuUtil ?? 999) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: CudaTone): number {
  return { unknown: 0, compute: 1, memory: 2, starved: 3 }[tone];
}
