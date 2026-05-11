import type { PartitionSummary, QueueJob } from "../types";

export type PartitionFitTone = "open" | "watch" | "tight";

export type PartitionFitRow = {
  name: string;
  role: string;
  tone: PartitionFitTone;
  pressure: number;
  pending: number;
  running: number;
  idleCpu: number;
  freeGpu: number;
  maxTime: string;
  signal: string;
  action: string;
};

export type PartitionFitRadar = {
  label: string;
  headline: string;
  rows: PartitionFitRow[];
};

type PartitionDemand = {
  pending: QueueJob[];
  running: QueueJob[];
  pendingCpu: number;
  pendingGpu: number;
  gatedGpu: number;
};

export function buildPartitionFitRadar(partitions: PartitionSummary[], jobs: QueueJob[]): PartitionFitRadar {
  const demand = demandByPartition(jobs);
  const rows = partitions.map((partition) => rowFor(partition, demand.get(partition.name))).sort(compareRows);
  return {
    label: labelFor(rows),
    headline: headlineFor(rows),
    rows
  };
}

function rowFor(partition: PartitionSummary, demand: PartitionDemand | undefined): PartitionFitRow {
  const visible = demand ?? { pending: [], running: [], pendingCpu: 0, pendingGpu: 0, gatedGpu: 0 };
  const role = roleFor(partition);
  const pressure = pressureFor(partition, visible);
  return {
    name: partition.name,
    role,
    tone: toneFor(pressure),
    pressure,
    pending: visible.pending.length,
    running: visible.running.length,
    idleCpu: partition.cpus_idle,
    freeGpu: partition.gpu_free,
    maxTime: partition.max_time ?? "n/a",
    signal: signalFor(partition, visible, role),
    action: actionFor(partition, visible, role)
  };
}

function demandByPartition(jobs: QueueJob[]): Map<string, PartitionDemand> {
  const groups = new Map<string, PartitionDemand>();
  for (const job of jobs) {
    if (!job.partition) continue;
    const current = groups.get(job.partition) ?? { pending: [], running: [], pendingCpu: 0, pendingGpu: 0, gatedGpu: 0 };
    if (job.state === "PENDING") {
      current.pending.push(job);
      current.pendingCpu += job.cpus;
      current.pendingGpu += job.gpu_count;
      if (isGated(job)) current.gatedGpu += job.gpu_count;
    }
    if (job.state === "RUNNING") current.running.push(job);
    groups.set(job.partition, current);
  }
  return groups;
}

function roleFor(partition: PartitionSummary): string {
  if (partition.gpu_total > 0) return "GPU lane";
  const maxSeconds = parseSlurmTime(partition.max_time);
  if (maxSeconds !== null && maxSeconds >= 24 * 3600) return "Long CPU lane";
  return "CPU lane";
}

function pressureFor(partition: PartitionSummary, demand: PartitionDemand): number {
  const cpuLoad = partition.cpus_total ? 1 - partition.cpus_idle / partition.cpus_total : 0;
  const gpuLoad = partition.gpu_total ? 1 - partition.gpu_free / partition.gpu_total : 0;
  const queueLoad = Math.min(1, demand.pending.length / 5);
  const fitStress = Math.max(
    demand.pendingCpu / Math.max(partition.cpus_idle, 1),
    demand.pendingGpu / Math.max(partition.gpu_free, 1)
  );
  const health = partition.down_nodes / Math.max(partition.total_nodes, 1);
  return clamp(Math.round(cpuLoad * 25 + gpuLoad * 25 + queueLoad * 20 + Math.min(1, fitStress) * 20 + health * 10));
}

function signalFor(partition: PartitionSummary, demand: PartitionDemand, role: string): string {
  if (role === "GPU lane" && demand.gatedGpu > 0) {
    return `${partition.name} keeps ${partition.gpu_free} GPU free, but ${demand.gatedGpu} GPU demand is gated before capacity matters.`;
  }
  if (role === "GPU lane") {
    return `${partition.name} has ${partition.gpu_free}/${partition.gpu_total} GPU free with ${demand.pendingGpu} pending GPU request(s).`;
  }
  if (role === "Long CPU lane" && demand.pendingCpu >= partition.cpus_idle && demand.pendingCpu > 0) {
    return `${partition.name} is sized for long CPU work; current pending CPU can consume the visible idle cores.`;
  }
  if (role === "Long CPU lane") return `${partition.name} offers longer walltime without GPU placement pressure.`;
  return `${partition.name} is best for short CPU work and quick backfill probes.`;
}

function actionFor(partition: PartitionSummary, demand: PartitionDemand, role: string): string {
  if (demand.gatedGpu > 0) return "Clear dependencies before treating this as a capacity shortage.";
  if (role === "GPU lane" && demand.pendingGpu > partition.gpu_free) return "Reduce GPU width or wait for accelerator turnover.";
  if (role === "Long CPU lane" && demand.pendingCpu >= partition.cpus_idle && demand.pendingCpu > 0) {
    return "Use fewer CPUs or shorter walltime if the run does not need the whole lane.";
  }
  if (partition.down_nodes > 0) return "Check node health before using this as a launch target.";
  return "Use this lane when the request matches its walltime and resource shape.";
}

function headlineFor(rows: PartitionFitRow[]): string {
  if (!rows.length) return "No partition fit data is available.";
  if (rows.some((row) => row.signal.includes("gated before capacity"))) {
    return "GPU capacity is visible, but scheduler gates still shape access.";
  }
  if (rows.some((row) => row.role === "Long CPU lane" && row.signal.includes("consume the visible idle cores"))) {
    return "Long CPU lanes are full-node sensitive right now.";
  }
  const open = rows.filter((row) => row.tone === "open").length;
  return `${open}/${rows.length} partitions look launchable for matching request shapes.`;
}

function labelFor(rows: PartitionFitRow[]): string {
  const tight = rows.filter((row) => row.tone === "tight").length;
  const open = rows.filter((row) => row.tone === "open").length;
  return rows.length ? `${open} open / ${tight} tight` : "no lanes";
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function toneFor(pressure: number): PartitionFitTone {
  if (pressure >= 70) return "tight";
  if (pressure >= 45) return "watch";
  return "open";
}

function compareRows(left: PartitionFitRow, right: PartitionFitRow): number {
  return right.pressure - left.pressure || right.pending - left.pending || left.name.localeCompare(right.name);
}

function parseSlurmTime(value: string | null): number | null {
  if (!value || value === "UNLIMITED" || value === "Partition_Limit") return null;
  const [dayPart, clock] = value.includes("-") ? value.split("-", 2) : ["0", value];
  const pieces = clock.split(":").map(Number);
  if (pieces.some(Number.isNaN)) return null;
  const [hours = 0, minutes = 0, seconds = 0] = pieces.length === 3 ? pieces : [0, pieces[0] ?? 0, pieces[1] ?? 0];
  return Number(dayPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}
