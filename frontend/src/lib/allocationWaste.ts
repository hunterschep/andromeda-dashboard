import type { HistoryJob } from "../types";

export type WasteKind = "memory" | "cpu" | "gpu";

export type AllocationWasteRow = {
  id: string;
  jobId: string;
  name: string;
  kind: WasteKind;
  severity: "info" | "warning" | "critical";
  value: string;
  detail: string;
  action: string;
};

export type AllocationWasteLedger = {
  label: string;
  headline: string;
  totals: {
    memoryOverPct: number | null;
    cpuWasteHours: number;
    gpuColdHours: number;
  };
  rows: AllocationWasteRow[];
  command: string;
};

type Sample = {
  job: HistoryJob;
  runtimeHours: number;
  cpuWasteHours: number;
  cpuWastePct: number | null;
  memoryWasteGbHours: number;
  memoryWastePct: number | null;
  gpuColdHours: number;
  gpuUtil: number | null;
};

export function buildAllocationWasteLedger(jobs: HistoryJob[], alias: string): AllocationWasteLedger {
  const samples = jobs.map(sampleJob).filter((sample): sample is Sample => Boolean(sample));
  const requestedMemoryGb = sum(samples.map((sample) => requestedMemoryMb(sample.job) ?? 0)) / 1024;
  const peakMemoryGb = sum(samples.map((sample) => sample.job.max_rss_mb ?? 0)) / 1024;
  const memoryOverPct = requestedMemoryGb > 0 && peakMemoryGb > 0 ? Math.round((1 - peakMemoryGb / requestedMemoryGb) * 100) : null;
  const cpuWasteHours = sum(samples.map((sample) => sample.cpuWasteHours));
  const gpuColdHours = sum(samples.map((sample) => sample.gpuColdHours));
  const rows = samples.flatMap(rowsForSample).sort(compareRows).slice(0, 6);

  return {
    label: labelFor(memoryOverPct, cpuWasteHours, gpuColdHours),
    headline: headlineFor(memoryOverPct, requestedMemoryGb, peakMemoryGb, cpuWasteHours, gpuColdHours),
    totals: { memoryOverPct, cpuWasteHours, gpuColdHours },
    rows,
    command: `ssh ${alias} 'sacct -u "$USER" --starttime=now-14days --format=JobID,JobName,State,Elapsed,ReqTRES,AllocTRES,MaxRSS,TotalCPU,TRESUsageInAve -P'`
  };
}

function sampleJob(job: HistoryJob): Sample | null {
  const runtime = job.runtime_seconds ?? 0;
  if (runtime <= 0) return null;
  const runtimeHours = runtime / 3600;
  const cpu = requestedCpu(job);
  const totalCpuHours = (job.total_cpu_seconds ?? 0) / 3600;
  const allocatedCpuHours = cpu * runtimeHours;
  const cpuWasteHours = Math.max(0, allocatedCpuHours - totalCpuHours);
  const memory = requestedMemoryMb(job);
  const maxRss = job.max_rss_mb ?? null;
  const memoryWasteGbHours = memory && maxRss ? Math.max(0, ((memory - maxRss) / 1024) * runtimeHours) : 0;
  const gpu = requestedGpu(job);
  const gpuUtil = gpuUtilPercent(job);
  const gpuColdHours = gpu && gpuUtil !== null ? gpu * runtimeHours * Math.max(0, 1 - gpuUtil / 100) : 0;
  return {
    job,
    runtimeHours,
    cpuWasteHours,
    cpuWastePct: allocatedCpuHours > 0 ? Math.round((cpuWasteHours / allocatedCpuHours) * 100) : null,
    memoryWasteGbHours,
    memoryWastePct: memory && maxRss ? Math.round((1 - maxRss / memory) * 100) : null,
    gpuColdHours,
    gpuUtil
  };
}

function rowsForSample(sample: Sample): AllocationWasteRow[] {
  const rows: AllocationWasteRow[] = [];
  const name = sample.job.name ?? sample.job.job_id;
  if (sample.memoryWastePct !== null && sample.memoryWastePct >= 50 && sample.memoryWasteGbHours >= 1) {
    rows.push({
      id: `${sample.job.job_id}-memory`,
      jobId: sample.job.job_id,
      name,
      kind: "memory",
      severity: sample.memoryWastePct >= 85 ? "warning" : "info",
      value: `${sample.memoryWastePct}% over`,
      detail: `${name} left ${hours(sample.memoryWasteGbHours)} GB-h of requested memory unused.`,
      action: "Lower --mem toward MaxRSS plus headroom before repeating this shape."
    });
  }
  if (sample.cpuWastePct !== null && sample.cpuWastePct >= 50 && sample.cpuWasteHours >= 0.25) {
    rows.push({
      id: `${sample.job.job_id}-cpu`,
      jobId: sample.job.job_id,
      name,
      kind: "cpu",
      severity: sample.cpuWastePct >= 85 ? "warning" : "info",
      value: `${hours(sample.cpuWasteHours)} CPU-h`,
      detail: `${name} left ${hours(sample.cpuWasteHours)} allocated CPU-h unused.`,
      action: "Reduce CPU width or profile thread scaling before the next submission."
    });
  }
  if (sample.gpuUtil !== null && sample.gpuUtil < 25 && sample.gpuColdHours >= 0.1) {
    rows.push({
      id: `${sample.job.job_id}-gpu`,
      jobId: sample.job.job_id,
      name,
      kind: "gpu",
      severity: sample.gpuUtil < 10 ? "critical" : "warning",
      value: `${hours(sample.gpuColdHours)} GPU-h`,
      detail: `${name} burned ${hours(sample.gpuColdHours)} GPU-h without useful GPU activity at ${sample.gpuUtil}% average utilization.`,
      action: "Fix dataloading, batch size, CUDA visibility, or CPU starvation before reserving another GPU."
    });
  }
  return rows;
}

function labelFor(memoryOverPct: number | null, cpuWasteHours: number, gpuColdHours: number): string {
  const memory = memoryOverPct === null ? "n/a" : `${memoryOverPct}% memory over`;
  return `${memory} / ${hours(cpuWasteHours)} CPU-h unused / ${hours(gpuColdHours)} GPU-h cold`;
}

function headlineFor(memoryOverPct: number | null, requestedMemoryGb: number, peakMemoryGb: number, cpuWasteHours: number, gpuColdHours: number): string {
  if (memoryOverPct !== null) {
    return `Recent jobs requested ${whole(requestedMemoryGb)} GB memory and peaked at ${whole(peakMemoryGb)} GB; ${memoryOverPct}% of requested memory sat cold.`;
  }
  if (gpuColdHours >= 0.1) return `${hours(gpuColdHours)} GPU-h looked cold in recent accounting; inspect utilization before scaling.`;
  if (cpuWasteHours >= 1) return `${hours(cpuWasteHours)} CPU-h were allocated without matching TotalCPU usage.`;
  return "Recent accounting does not expose enough waste evidence for a confident ledger.";
}

function requestedCpu(job: HistoryJob): number {
  return Number(job.requested_tres.cpu ?? job.allocated_tres.cpu ?? 0) || 0;
}

function requestedGpu(job: HistoryJob): number {
  const raw = job.requested_tres["gres/gpu"] ?? job.requested_tres.gpu ?? job.allocated_tres["gres/gpu"] ?? job.allocated_tres.gpu;
  return Number(raw ?? 0) || 0;
}

function requestedMemoryMb(job: HistoryJob): number | null {
  const raw = job.requested_tres.mem ?? job.allocated_tres.mem;
  if (!raw) return null;
  const match = /^(\d+(?:\.\d+)?)([KMGTP]?)$/i.exec(raw);
  if (!match) return null;
  const factor: Record<string, number> = { "": 1, K: 1 / 1024, M: 1, G: 1024, T: 1024 ** 2, P: 1024 ** 3 };
  return Number(match[1]) * factor[match[2].toUpperCase()];
}

function gpuUtilPercent(job: HistoryJob): number | null {
  for (const source of [job.tres_usage_in_ave, job.tres_usage_in_max]) {
    const raw = source["gres/gpuutil"] ?? source.gpuutil ?? source["gres/gpu_util"] ?? source.gpu_util;
    const match = raw?.match(/\d+(?:\.\d+)?/);
    if (match) return Math.round(Number(match[0]));
  }
  return null;
}

function compareRows(left: AllocationWasteRow, right: AllocationWasteRow): number {
  return severityRank(right.severity) - severityRank(left.severity) || kindRank(right.kind) - kindRank(left.kind) || left.jobId.localeCompare(right.jobId);
}

function severityRank(severity: AllocationWasteRow["severity"]): number {
  return { info: 0, warning: 1, critical: 2 }[severity];
}

function kindRank(kind: WasteKind): number {
  return { memory: 0, cpu: 1, gpu: 2 }[kind];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function hours(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function whole(value: number): string {
  return String(Math.round(value));
}
