import type { HistoryJob } from "../types";

export type FairsharePartition = {
  partition: string;
  jobs: number;
  gpuHours: number;
  cpuHours: number;
  share: number;
};

export type FairshareBurn = {
  jobs: number;
  gpuJobs: number;
  gpuHours: number;
  cpuHours: number;
  dominantPartition: string;
  tier: "low" | "medium" | "high";
  confidence: "low" | "medium";
  message: string;
  partitions: FairsharePartition[];
};

export function buildFairshareBurn(jobs: HistoryJob[]): FairshareBurn {
  const rows = jobs.map(jobUsage).filter((row) => row.runtimeHours > 0);
  const gpuHours = sum(rows.map((row) => row.gpuHours));
  const cpuHours = sum(rows.map((row) => row.cpuHours));
  const gpuJobs = rows.filter((row) => row.gpuHours > 0).length;
  const partitions = partitionRows(rows, gpuHours + cpuHours);
  const tier = burnTier(gpuHours, cpuHours);
  return {
    jobs: rows.length,
    gpuJobs,
    gpuHours,
    cpuHours,
    dominantPartition: partitions[0]?.partition ?? "n/a",
    tier,
    confidence: rows.length >= 5 ? "medium" : "low",
    message: burnMessage(tier, gpuHours, cpuHours, partitions[0]?.partition ?? null),
    partitions
  };
}

function jobUsage(job: HistoryJob) {
  const runtimeHours = Math.max(0, (job.runtime_seconds ?? 0) / 3600);
  const cpu = countTres(job.allocated_tres, "cpu") || countTres(job.requested_tres, "cpu");
  const gpu = gpuCount(job.allocated_tres) || gpuCount(job.requested_tres);
  return {
    partition: job.partition ?? "unknown",
    runtimeHours,
    gpuHours: gpu * runtimeHours,
    cpuHours: cpu * runtimeHours
  };
}

function partitionRows(
  rows: ReturnType<typeof jobUsage>[],
  totalBurn: number
): FairsharePartition[] {
  const groups = new Map<string, ReturnType<typeof jobUsage>[]>();
  for (const row of rows) groups.set(row.partition, [...(groups.get(row.partition) ?? []), row]);
  return Array.from(groups.entries())
    .map(([partition, entries]) => {
      const gpuHours = sum(entries.map((entry) => entry.gpuHours));
      const cpuHours = sum(entries.map((entry) => entry.cpuHours));
      return {
        partition,
        jobs: entries.length,
        gpuHours,
        cpuHours,
        share: totalBurn > 0 ? Math.round(((gpuHours + cpuHours) / totalBurn) * 100) : 0
      };
    })
    .sort((left, right) => right.gpuHours - left.gpuHours || right.cpuHours - left.cpuHours || left.partition.localeCompare(right.partition));
}

function burnTier(gpuHours: number, cpuHours: number): FairshareBurn["tier"] {
  if (gpuHours >= 48 || cpuHours >= 1000) return "high";
  if (gpuHours >= 12 || cpuHours >= 250) return "medium";
  return "low";
}

function burnMessage(
  tier: FairshareBurn["tier"],
  gpuHours: number,
  cpuHours: number,
  partition: string | null
): string {
  if (tier === "high") {
    return `Recent usage is heavy: ${hours(gpuHours)} GPU-h and ${hours(cpuHours)} CPU-h. If jobs pend for Priority, fairshare is a plausible drag.`;
  }
  if (tier === "medium") {
    return `Recent usage is noticeable, especially on ${partition ?? "the busiest partition"}; smaller jobs may age into priority faster.`;
  }
  return "Recent usage is light; fairshare drag should be lower than resource fit, QOS, or fragmentation effects.";
}

function gpuCount(tres: Record<string, string>): number {
  return Object.entries(tres).reduce((total, [key, value]) => {
    if (!key.startsWith("gres/gpu") && key !== "gpu") return total;
    return total + parseNumber(value);
  }, 0);
}

function countTres(tres: Record<string, string>, key: string): number {
  return parseNumber(tres[key]);
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function hours(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString();
  return value.toFixed(value >= 10 ? 1 : 2);
}
