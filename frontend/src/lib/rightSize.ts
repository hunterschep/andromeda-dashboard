import type { HistoryJob } from "../types";

export type RightSizeSignal = {
  label: string;
  value: string;
  severity: "info" | "warning" | "critical";
  detail: string;
};

export type RightSizeAdvice = {
  confidence: "low" | "medium" | "high";
  headline: string;
  sbatch: string;
  signals: RightSizeSignal[];
};

type UsageSample = {
  cpu: number;
  memoryMb: number | null;
  maxRssMb: number | null;
  cpuEfficiency: number | null;
  gpuUtil: number | null;
};

export function buildRightSizeAdvice(jobs: HistoryJob[]): RightSizeAdvice {
  const samples = jobs.map(sampleJob).filter((sample) => sample.cpu > 0 || sample.memoryMb || sample.gpuUtil !== null);
  const memorySamples = samples.filter((sample) => sample.memoryMb && sample.maxRssMb) as Array<UsageSample & { memoryMb: number; maxRssMb: number }>;
  const cpuEfficiencies = samples.map((sample) => sample.cpuEfficiency).filter((value): value is number => value !== null);
  const gpuUtils = samples.map((sample) => sample.gpuUtil).filter((value): value is number => value !== null);
  const recommendedMemoryGb = memoryRecommendation(memorySamples);
  const recommendedCpu = cpuRecommendation(samples, median(cpuEfficiencies));
  const gpuAdvice = median(gpuUtils);
  const signals = [
    memorySignal(memorySamples, recommendedMemoryGb),
    cpuSignal(cpuEfficiencies, recommendedCpu),
    gpuSignal(gpuUtils, gpuAdvice)
  ];
  return {
    confidence: confidence(samples.length),
    headline: headline(signals),
    sbatch: sbatch(recommendedCpu, recommendedMemoryGb),
    signals
  };
}

function sampleJob(job: HistoryJob): UsageSample {
  const cpu = numberTres(job.allocated_tres, "cpu") || numberTres(job.requested_tres, "cpu");
  const runtime = job.runtime_seconds ?? 0;
  return {
    cpu,
    memoryMb: memoryMb(job.requested_tres.mem ?? job.allocated_tres.mem),
    maxRssMb: job.max_rss_mb,
    cpuEfficiency: job.total_cpu_seconds && cpu && runtime ? Math.round((job.total_cpu_seconds / (cpu * runtime)) * 100) : null,
    gpuUtil: gpuUtil(job)
  };
}

function memorySignal(samples: Array<UsageSample & { memoryMb: number; maxRssMb: number }>, recommendationGb: number): RightSizeSignal {
  if (!samples.length) return { label: "memory", value: "n/a", severity: "info", detail: "MaxRSS is not available for recent jobs." };
  const waste = Math.round(median(samples.map((sample) => Math.max(0, 1 - sample.maxRssMb / sample.memoryMb))) * 100);
  return {
    label: "memory",
    value: `${waste}% over`,
    severity: waste >= 70 ? "warning" : "info",
    detail: `Recent MaxRSS suggests trying about ${recommendationGb}GB before requesting large memory.`
  };
}

function cpuSignal(efficiencies: number[], recommendation: number): RightSizeSignal {
  if (!efficiencies.length) return { label: "CPU", value: "n/a", severity: "info", detail: "CPU accounting was not available for recent jobs." };
  const value = Math.round(median(efficiencies));
  return {
    label: "CPU",
    value: `${value}% eff`,
    severity: value < 25 ? "warning" : "info",
    detail: value < 50 ? `Try ${recommendation} CPU(s) for the next similar run, then scale up only if throughput improves.` : "CPU efficiency looks usable for recent completed jobs."
  };
}

function gpuSignal(utils: number[], medianUtil: number): RightSizeSignal {
  if (!utils.length) return { label: "GPU", value: "n/a", severity: "info", detail: "GPU utilization accounting was not available for recent jobs." };
  return {
    label: "GPU",
    value: `${Math.round(medianUtil)}% util`,
    severity: medianUtil < 25 ? "warning" : "info",
    detail: medianUtil < 25 ? "Recent GPU utilization is low; check dataloading, batch size, and CUDA visibility before chasing larger GPUs." : "GPU utilization looks healthy enough to keep similar GPU shape."
  };
}

function headline(signals: RightSizeSignal[]): string {
  const warnings = signals.filter((signal) => signal.severity === "warning");
  if (warnings.some((signal) => signal.label === "memory")) return "Memory is the clearest right-size opportunity.";
  if (warnings.some((signal) => signal.label === "GPU")) return "GPU utilization is the clearest right-size opportunity.";
  if (warnings.some((signal) => signal.label === "CPU")) return "CPU width is the clearest right-size opportunity.";
  return "Recent jobs do not show a strong right-size correction.";
}

function sbatch(cpu: number, memoryGb: number): string {
  return [`#SBATCH --cpus-per-task=${cpu}`, `#SBATCH --mem=${memoryGb}G`, "#SBATCH --time=04:00:00"].join("\n");
}

function memoryRecommendation(samples: Array<UsageSample & { memoryMb: number; maxRssMb: number }>): number {
  if (!samples.length) return 16;
  const recommendedMb = median(samples.map((sample) => Math.max(1024, sample.maxRssMb * 1.35)));
  return Math.max(1, Math.ceil(recommendedMb / 1024));
}

function cpuRecommendation(samples: UsageSample[], efficiency: number): number {
  const cpus = samples.map((sample) => sample.cpu).filter((cpu) => cpu > 0);
  if (!cpus.length) return 4;
  const current = median(cpus);
  if (efficiency < 25) return Math.max(1, Math.ceil(current / 2));
  if (efficiency < 50) return Math.max(1, Math.ceil(current * 0.75));
  return Math.max(1, Math.round(current));
}

function confidence(samples: number): RightSizeAdvice["confidence"] {
  if (samples >= 8) return "high";
  if (samples >= 3) return "medium";
  return "low";
}

function numberTres(tres: Record<string, string>, key: string): number {
  return Number(tres[key] ?? 0) || 0;
}

function memoryMb(value: string | undefined): number | null {
  const match = value?.match(/^(\d+(?:\.\d+)?)([KMGTP]?)$/i);
  if (!match) return null;
  const factors: Record<string, number> = { "": 1, K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024, P: 1024 ** 3 };
  return Number(match[1]) * factors[match[2].toUpperCase()];
}

function gpuUtil(job: HistoryJob): number | null {
  for (const source of [job.tres_usage_in_ave, job.tres_usage_in_max]) {
    const value = source["gres/gpuutil"] ?? source.gpuutil;
    const match = value?.match(/\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function median(values: number[]): number {
  const clean = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}
