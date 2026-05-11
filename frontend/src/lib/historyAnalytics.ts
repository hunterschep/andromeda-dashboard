import type { HistoryJob } from "../types";

export type HistoryBand = {
  label: string;
  count: number;
};

export type PartitionHistory = {
  partition: string;
  jobs: number;
  failures: number;
  gpuJobs: number;
  medianWait: number | null;
  medianRuntime: number | null;
  friction: number;
};

export type SubmitWindow = {
  label: string;
  jobs: number;
  gpuJobs: number;
  cleanRate: number;
  medianWait: number | null;
  score: number;
  advice: string;
};

export type HistoryAnalytics = {
  total: number;
  completed: number;
  failed: number;
  gpuJobs: number;
  cleanRate: number;
  bestPartition: string;
  quietWindow: string;
  waitBands: HistoryBand[];
  partitions: PartitionHistory[];
  submitWindows: SubmitWindow[];
};

export function buildHistoryAnalytics(jobs: HistoryJob[]): HistoryAnalytics {
  const failed = jobs.filter(isFailed).length;
  const completed = jobs.filter((job) => job.state === "COMPLETED").length;
  const gpuJobs = jobs.filter((job) => requestedGpu(job) > 0).length;
  const partitions = partitionHistory(jobs);
  return {
    total: jobs.length,
    completed,
    failed,
    gpuJobs,
    cleanRate: jobs.length ? Math.round(((jobs.length - failed) / jobs.length) * 100) : 100,
    bestPartition: partitions[0]?.partition ?? "n/a",
    quietWindow: quietWindow(jobs),
    waitBands: waitBands(jobs),
    partitions,
    submitWindows: submitWindows(jobs)
  };
}

function submitWindows(jobs: HistoryJob[]): SubmitWindow[] {
  const groups = new Map<string, HistoryJob[]>();
  for (const job of jobs) {
    if (!job.submit_time) continue;
    const label = daypart(new Date(job.submit_time).getHours());
    groups.set(label, [...(groups.get(label) ?? []), job]);
  }
  return Array.from(groups.entries())
    .map(([label, rows]) => {
      const failures = rows.filter(isFailed).length;
      const medianWait = median(rows.map((job) => job.wait_seconds));
      const cleanRate = rows.length ? Math.round(((rows.length - failures) / rows.length) * 100) : 100;
      const gpuJobs = rows.filter((job) => requestedGpu(job) > 0).length;
      const score = Math.round((medianWait ?? 86400) / 60 + failures * 20 - rows.length * 3);
      return { label, jobs: rows.length, gpuJobs, cleanRate, medianWait, score, advice: windowAdvice(label, medianWait, cleanRate, gpuJobs) };
    })
    .sort((left, right) => left.score - right.score || right.jobs - left.jobs || left.label.localeCompare(right.label));
}

function partitionHistory(jobs: HistoryJob[]): PartitionHistory[] {
  const groups = new Map<string, HistoryJob[]>();
  for (const job of jobs) {
    const key = job.partition ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return Array.from(groups.entries())
    .map(([partition, rows]) => {
      const failures = rows.filter(isFailed).length;
      const medianWait = median(rows.map((job) => job.wait_seconds));
      const medianRuntime = median(rows.map((job) => job.runtime_seconds));
      const gpuJobs = rows.filter((job) => requestedGpu(job) > 0).length;
      const waitPenalty = medianWait ? Math.min(60, medianWait / 60 / 3) : 0;
      const failurePenalty = rows.length ? (failures / rows.length) * 40 : 0;
      return {
        partition,
        jobs: rows.length,
        failures,
        gpuJobs,
        medianWait,
        medianRuntime,
        friction: Math.round(waitPenalty + failurePenalty)
      };
    })
    .sort((left, right) => left.friction - right.friction || right.jobs - left.jobs || left.partition.localeCompare(right.partition));
}

function waitBands(jobs: HistoryJob[]): HistoryBand[] {
  const bands = [
    { label: "<10m", count: 0 },
    { label: "10-60m", count: 0 },
    { label: "1-4h", count: 0 },
    { label: "4h+", count: 0 }
  ];
  for (const job of jobs) {
    const wait = job.wait_seconds;
    if (wait === null || wait === undefined) continue;
    if (wait < 10 * 60) bands[0].count += 1;
    else if (wait < 3600) bands[1].count += 1;
    else if (wait < 4 * 3600) bands[2].count += 1;
    else bands[3].count += 1;
  }
  return bands;
}

function quietWindow(jobs: HistoryJob[]): string {
  const groups = new Map<string, number[]>();
  for (const job of jobs) {
    if (!job.submit_time || job.wait_seconds === null || job.wait_seconds === undefined) continue;
    const label = daypart(new Date(job.submit_time).getHours());
    groups.set(label, [...(groups.get(label) ?? []), job.wait_seconds]);
  }
  const ranked = Array.from(groups.entries())
    .map(([label, waits]) => ({ label, wait: median(waits) ?? Number.POSITIVE_INFINITY }))
    .sort((left, right) => left.wait - right.wait);
  return ranked[0]?.label ?? "n/a";
}

function daypart(hour: number): string {
  if (hour < 6) return "overnight";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function windowAdvice(label: string, wait: number | null, cleanRate: number, gpuJobs: number): string {
  if (wait !== null && wait < 15 * 60 && cleanRate >= 80) return `${label} has been the lowest-friction recent submission window.`;
  if (gpuJobs > 0 && wait !== null && wait < 3600) return `${label} has recent GPU starts without long waits.`;
  if (cleanRate < 75) return `${label} has more failed or cancelled runs; inspect scripts before scaling.`;
  return `${label} has enough history to compare against current queue pressure.`;
}

function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value !== null && value !== undefined && value >= 0).sort((left, right) => left - right);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : Math.round((clean[middle - 1] + clean[middle]) / 2);
}

function isFailed(job: HistoryJob): boolean {
  return !["COMPLETED", "RUNNING"].includes(job.state);
}

function requestedGpu(job: HistoryJob): number {
  const requested = job.requested_tres ?? {};
  return Number(requested["gres/gpu"] ?? requested.gpu ?? 0) || 0;
}
