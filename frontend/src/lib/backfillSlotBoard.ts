import { formatMemory } from "../api";
import type { NodeResource, PartitionSummary, SchedulerHealth } from "../types";

type SlotShape = {
  id: string;
  label: string;
  cpus: number;
  memoryMb: number;
  gpus: number;
  seconds: number;
};

export type BackfillSlot = {
  id: string;
  label: string;
  partition: string;
  request: string;
  window: string;
  fitNodes: number;
  bestNode: string;
  tone: "open" | "tight" | "blocked";
  detail: string;
  command: string;
};

export type BackfillSlotBoard = {
  label: string;
  headline: string;
  schedulerLine: string;
  slots: BackfillSlot[];
};

const SHAPES: SlotShape[] = [
  { id: "cpu-flash", label: "CPU flash", cpus: 4, memoryMb: 16 * 1024, gpus: 0, seconds: 30 * 60 },
  { id: "gpu-smoke", label: "GPU smoke", cpus: 4, memoryMb: 32 * 1024, gpus: 1, seconds: 2 * 3600 },
  { id: "single-gpu", label: "Single GPU train", cpus: 8, memoryMb: 64 * 1024, gpus: 1, seconds: 4 * 3600 },
  { id: "two-gpu", label: "Two GPU train", cpus: 16, memoryMb: 128 * 1024, gpus: 2, seconds: 6 * 3600 },
  { id: "cpu-wide", label: "CPU sweep shard", cpus: 32, memoryMb: 96 * 1024, gpus: 0, seconds: 2 * 3600 }
];

export function buildBackfillSlotBoard({
  nodes,
  partitions,
  scheduler,
  alias
}: {
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  scheduler: SchedulerHealth | null;
  alias: string;
}): BackfillSlotBoard {
  const slots = SHAPES.map((shape) => bestSlot(shape, nodes, partitions, alias))
    .filter((slot): slot is BackfillSlot => Boolean(slot))
    .sort(compareSlots);
  const open = slots.filter((slot) => slot.fitNodes > 0).length;
  return {
    label: `${open} live slots / depth ${scheduler?.backfill_last_depth ?? "n/a"}`,
    headline: headline(slots),
    schedulerLine: schedulerLine(scheduler),
    slots
  };
}

function bestSlot(shape: SlotShape, nodes: NodeResource[], partitions: PartitionSummary[], alias: string): BackfillSlot | null {
  const candidates = partitions.map((partition) => slotFor(shape, partition, nodes, alias));
  return candidates.sort(compareCandidate)[0] ?? null;
}

function slotFor(shape: SlotShape, partition: PartitionSummary, nodes: NodeResource[], alias: string): BackfillSlot {
  const maxSeconds = parseWalltime(partition.max_time);
  const eligible = maxSeconds === null || shape.seconds <= maxSeconds;
  const candidates = nodes.filter((node) => node.is_available && node.partitions.includes(partition.name));
  const fits = eligible ? candidates.filter((node) => fitsShape(node, shape)) : [];
  const ranked = fits.slice().sort((left, right) => right.gpu_free - left.gpu_free || right.cpus_idle - left.cpus_idle);
  const tone = fits.length > 1 ? "open" : fits.length === 1 ? "tight" : "blocked";
  return {
    id: `${shape.id}-${partition.name}`,
    label: shape.label,
    partition: partition.name,
    request: `${shape.cpus} CPU / ${formatMemory(shape.memoryMb)} / ${shape.gpus} GPU`,
    window: `≤${windowText(shape.seconds)}`,
    fitNodes: fits.length,
    bestNode: ranked[0]?.name ?? "none",
    tone,
    detail: detail(shape, fits.length, partition, eligible),
    command: `ssh ${alias} 'sinfo -p ${partition.name} -o "%P|%a|%l|%D|%C|%G"; squeue -p ${partition.name} --start | sed -n "1,40p"'`
  };
}

function fitsShape(node: NodeResource, shape: SlotShape): boolean {
  const freeMem = node.memory_free_mb ?? node.memory_total_mb;
  return node.cpus_idle >= shape.cpus && freeMem >= shape.memoryMb && node.gpu_free >= shape.gpus;
}

function detail(shape: SlotShape, fitNodes: number, partition: PartitionSummary, eligible: boolean): string {
  if (!eligible) return `${shape.label} exceeds ${partition.name} walltime policy, so this is not a backfill lane.`;
  if (fitNodes > 1) return `${shape.label} has ${fitNodes} live backfill slot(s); short, narrow work should start fastest.`;
  if (fitNodes === 1) return `${shape.label} has one live ${partition.name} slot; keep walltime at ${windowText(shape.seconds)} or less.`;
  if (shape.gpus > 0) return `${shape.label} needs ${shape.gpus} GPU and no eligible node has that idle shape right now.`;
  return `${shape.label} is blocked by CPU or memory shape despite not needing GPUs.`;
}

function headline(slots: BackfillSlot[]): string {
  const open = slots.find((slot) => slot.fitNodes > 0);
  if (open) return `${open.label} on ${open.partition} is the cleanest visible backfill move.`;
  return "No standard short shape has a visible backfill slot in the current queue view.";
}

function schedulerLine(scheduler: SchedulerHealth | null): string {
  if (!scheduler) return "Scheduler backfill depth is unavailable; slot confidence comes only from resource fit.";
  const depth = scheduler.backfill_last_depth ?? "n/a";
  const cycle = scheduler.backfill_last_cycle_seconds === null ? "n/a" : `${scheduler.backfill_last_cycle_seconds}s`;
  return `Scheduler is checking ${depth} jobs per backfill cycle; last backfill cycle ${cycle}.`;
}

function compareCandidate(left: BackfillSlot, right: BackfillSlot): number {
  return right.fitNodes - left.fitNodes || left.window.localeCompare(right.window) || right.request.localeCompare(left.request);
}

function compareSlots(left: BackfillSlot, right: BackfillSlot): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.fitNodes - left.fitNodes || left.label.localeCompare(right.label);
}

function toneRank(toneValue: BackfillSlot["tone"]): number {
  return { blocked: 0, tight: 1, open: 2 }[toneValue];
}

function parseWalltime(value: string | null): number | null {
  if (!value) return null;
  const match = /^(?:(\d+)-)?(\d+):(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function windowText(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}
