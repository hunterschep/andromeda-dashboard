import { formatDuration } from "../api";
import type { HistoryJob } from "../types";

export type RunShapeRecommendation = {
  key: string;
  title: string;
  tone: "ready" | "watch" | "blocked";
  partition: string;
  request: string;
  jobs: number;
  cleanRate: number;
  medianWait: number | null;
  message: string;
  action: string;
  sbatch: string;
};

export type RunShapeSummary = {
  label: string;
  recommendations: RunShapeRecommendation[];
};

type ShapeGroup = {
  key: string;
  partition: string;
  cpus: number;
  memGb: number;
  gpus: number;
  rows: HistoryJob[];
};

export function buildRunShapeRecommendations(jobs: HistoryJob[]): RunShapeSummary {
  const groups = groupShapes(jobs);
  const recommendations = groups.map(recommendationFor).sort(compareRecommendations).slice(0, 5);
  const ready = recommendations.filter((item) => item.tone === "ready").length;
  return {
    label: recommendations.length ? `${ready} reusable shape${ready === 1 ? "" : "s"}` : "no history",
    recommendations
  };
}

function groupShapes(jobs: HistoryJob[]): ShapeGroup[] {
  const groups = new Map<string, ShapeGroup>();
  for (const job of jobs) {
    const cpus = requestedCpu(job);
    const memGb = requestedMemoryGb(job);
    const gpus = requestedGpu(job);
    const partition = job.partition ?? "short";
    const key = `${partition}-${cpus}-${memGb}-${gpus}`;
    const existing = groups.get(key) ?? { key, partition, cpus, memGb, gpus, rows: [] };
    existing.rows.push(job);
    groups.set(key, existing);
  }
  return Array.from(groups.values());
}

function recommendationFor(group: ShapeGroup): RunShapeRecommendation {
  const failures = group.rows.filter((job) => job.state !== "COMPLETED").length;
  const cleanRate = Math.round(((group.rows.length - failures) / Math.max(group.rows.length, 1)) * 100);
  const medianWait = median(group.rows.map((job) => job.wait_seconds));
  const gpuFailed = group.gpus > 0 && failures > 0;
  const tone = cleanRate >= 80 ? "ready" : gpuFailed ? "blocked" : "watch";
  const title = titleFor(group, cleanRate, gpuFailed);
  return {
    key: group.key,
    title,
    tone,
    partition: group.partition,
    request: `${group.cpus} CPU / ${group.memGb}GB / ${group.gpus} GPU`,
    jobs: group.rows.length,
    cleanRate,
    medianWait,
    message: messageFor(group, cleanRate, medianWait, gpuFailed),
    action: actionFor(group, cleanRate, gpuFailed),
    sbatch: sbatchFor(group)
  };
}

function titleFor(group: ShapeGroup, cleanRate: number, gpuFailed: boolean): string {
  if (gpuFailed) return "GPU validation first";
  if (cleanRate >= 80 && group.gpus === 0) return "CPU repeat shape";
  if (cleanRate >= 80) return "Reusable GPU shape";
  return "Shape needs proof";
}

function messageFor(group: ShapeGroup, cleanRate: number, medianWait: number | null, gpuFailed: boolean): string {
  const wait = medianWait === null ? "unknown wait" : `${formatDuration(medianWait)} median wait`;
  if (gpuFailed) return `${group.gpus} GPU shape has failed recently; validate modules, data paths, and CUDA before scaling.`;
  if (cleanRate >= 80) return `${group.partition} ${group.cpus} CPU / ${group.gpus} GPU shape is ${cleanRate}% clean with ${wait}.`;
  return `${group.partition} shape is only ${cleanRate}% clean; use it as a debugging baseline, not a production template.`;
}

function actionFor(group: ShapeGroup, cleanRate: number, gpuFailed: boolean): string {
  if (gpuFailed) return "Submit a short smoke test with the same GPU class before the full run.";
  if (cleanRate >= 80 && group.gpus === 0) return "Reuse this for preprocessing, probes, and CPU-only sweeps.";
  if (cleanRate >= 80) return "Reuse this shape for the next comparable training run before widening.";
  return "Inspect logs and right-size requests before copying this shape.";
}

function sbatchFor(group: ShapeGroup): string {
  const gpu = group.gpus > 0 ? `#SBATCH --gres=gpu:${group.gpus}\n` : "";
  return [
    "#!/bin/bash",
    "#SBATCH --job-name=andromeda-shape",
    `#SBATCH --partition=${group.partition}`,
    "#SBATCH --nodes=1",
    "#SBATCH --ntasks=1",
    `#SBATCH --cpus-per-task=${group.cpus}`,
    `#SBATCH --mem=${group.memGb}G`,
    "#SBATCH --time=04:00:00",
    `${gpu}#SBATCH --output=logs/%x-%j.out`,
    "#SBATCH --error=logs/%x-%j.err",
    "",
    "set -euo pipefail",
    "cd \"$SLURM_SUBMIT_DIR\"",
    group.gpus > 0 ? "nvidia-smi" : "# CPU-only workload",
    "python train.py"
  ].join("\n");
}

function compareRecommendations(left: RunShapeRecommendation, right: RunShapeRecommendation): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.cleanRate - left.cleanRate || (left.medianWait ?? Infinity) - (right.medianWait ?? Infinity);
}

function toneRank(tone: RunShapeRecommendation["tone"]): number {
  return { blocked: 0, watch: 1, ready: 2 }[tone];
}

function requestedCpu(job: HistoryJob): number {
  return Number(job.requested_tres?.cpu ?? job.allocated_tres?.cpu ?? 1) || 1;
}

function requestedGpu(job: HistoryJob): number {
  return Number(job.requested_tres?.["gres/gpu"] ?? job.requested_tres?.gpu ?? 0) || 0;
}

function requestedMemoryGb(job: HistoryJob): number {
  const text = job.requested_tres?.mem ?? job.allocated_tres?.mem ?? "16G";
  const match = /^(\d+(?:\.\d+)?)([KMGTP]?)$/i.exec(text);
  if (!match) return 16;
  const factor: Record<string, number> = { "": 1 / 1024, K: 1 / 1024 / 1024, M: 1 / 1024, G: 1, T: 1024, P: 1024 * 1024 };
  return Math.max(1, Math.round(Number(match[1]) * factor[match[2].toUpperCase()]));
}

function median(values: Array<number | null | undefined>): number | null {
  const clean = values.filter((value): value is number => value !== null && value !== undefined && value >= 0).sort((left, right) => left - right);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : Math.round((clean[middle - 1] + clean[middle]) / 2);
}
