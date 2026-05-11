import type { NodeResource, QueueJob } from "../types";

export type GpuShapeTone = "fit" | "split" | "gated" | "blocked";

export type GpuShapeRow = {
  jobId: string;
  name: string;
  type: string;
  requested: number;
  partition: string;
  tone: GpuShapeTone;
  exactFitNodes: number;
  largestFit: number;
  usable: number;
  title: string;
  detail: string;
  action: string;
  patch: string;
};

export type GpuShapeSwitchboard = {
  label: string;
  headline: string;
  rows: GpuShapeRow[];
};

type NodeFit = {
  name: string;
  free: number;
};

export function buildGpuShapeSwitchboard(jobs: QueueJob[], nodes: NodeResource[]): GpuShapeSwitchboard {
  const rows = jobs.filter((job) => job.state === "PENDING" && job.gpu_count > 0).map((job) => rowFor(job, nodes)).sort(compareRows);
  const gated = rows.filter((row) => row.tone === "gated").length;
  const split = rows.filter((row) => row.tone === "split").length;
  return {
    label: `${rows.length} GPU ${rows.length === 1 ? "request" : "requests"} / ${gated} gated`,
    headline: headlineFor(rows.length, gated, split),
    rows
  };
}

function rowFor(job: QueueJob, nodes: NodeResource[]): GpuShapeRow {
  const request = primaryRequest(job);
  const fits = nodeFits(job.partition, request.type, nodes);
  const largestFit = Math.max(0, ...fits.map((fit) => fit.free));
  const exactFitNodes = fits.filter((fit) => fit.free >= request.count).length;
  const usable = fits.reduce((sum, fit) => sum + fit.free, 0);
  const gated = gateLabel(job);
  const tone = toneFor(Boolean(gated), request.count, largestFit, usable, exactFitNodes);
  return {
    jobId: job.job_id,
    name: job.name ?? job.job_id,
    type: request.type,
    requested: request.count,
    partition: job.partition ?? "any",
    tone,
    exactFitNodes,
    largestFit,
    usable,
    title: titleFor(tone, job, request.count, request.type, largestFit),
    detail: detailFor(tone, job, gated, request.count, request.type, largestFit, exactFitNodes, usable),
    action: actionFor(tone),
    patch: patchFor(tone, request.count, request.type, largestFit)
  };
}

function primaryRequest(job: QueueJob): { type: string; count: number } {
  const first = job.gpus[0];
  return { type: first?.type ?? "generic", count: Math.max(1, first?.count ?? job.gpu_count) };
}

function nodeFits(partition: string | null, type: string, nodes: NodeResource[]): NodeFit[] {
  return nodes
    .filter((node) => node.is_available && (!partition || node.partitions.includes(partition)))
    .map((node) => {
      const gpu = type === "generic" ? node.gres[0] : node.gres.find((item) => item.type === type);
      return gpu ? { name: node.name, free: gpu.free } : null;
    })
    .filter((fit): fit is NodeFit => fit !== null && fit.free > 0)
    .sort((left, right) => right.free - left.free || left.name.localeCompare(right.name));
}

function toneFor(gated: boolean, requested: number, largestFit: number, usable: number, exactFitNodes: number): GpuShapeTone {
  if (gated) return "gated";
  if (exactFitNodes > 0) return "fit";
  if (usable > 0 && requested > largestFit) return "split";
  return "blocked";
}

function titleFor(tone: GpuShapeTone, job: QueueJob, requested: number, type: string, largestFit: number): string {
  if (tone === "gated" && requested > largestFit) return "Gate first, then split width";
  if (tone === "gated") return "Gate before shape";
  if (tone === "split") return "Split wide GPU shape";
  if (tone === "fit") return "Current shape can place";
  return "Wait for accelerator turnover";
}

function detailFor(
  tone: GpuShapeTone,
  job: QueueJob,
  gated: string | null,
  requested: number,
  type: string,
  largestFit: number,
  exactFitNodes: number,
  usable: number
): string {
  const name = job.name ?? job.job_id;
  if (tone === "gated" && requested > largestFit) {
    return `${name} is gated by ${gated}, and the current ${requested}x ${type} shape exceeds the largest visible ${largestFit}x fit.`;
  }
  if (tone === "gated") return `${name} is gated by ${gated}; GPU fit cannot matter until that scheduler condition clears.`;
  if (tone === "split") return `${name} asks for ${requested}x ${type}, but the largest visible fit is ${largestFit}x across ${usable} usable GPU.`;
  if (tone === "fit") return `${name} can fit ${exactFitNodes} visible node(s) with the current ${requested}x ${type} shape.`;
  return `${name} has no visible ${type} fit in this partition right now.`;
}

function actionFor(tone: GpuShapeTone): string {
  if (tone === "gated") return "Clear dependency, hold, or begin-time first; keep the split patch ready if the job remains wide afterward.";
  if (tone === "split") return "Shard the experiment, submit a validation slice, or wait for a fuller node release.";
  if (tone === "fit") return "Avoid churn; priority, fairshare, or turnover is likelier than shape as the blocker.";
  return "Watch release radar or switch to a different partition or GPU family if the workload allows it.";
}

function patchFor(tone: GpuShapeTone, requested: number, type: string, largestFit: number): string {
  if (tone === "fit") return `#SBATCH --gres=gpu:${type}:${requested}`;
  const width = Math.max(1, Math.min(largestFit || 1, requested));
  const cap = Math.max(1, largestFit || 1);
  return `#SBATCH --gres=gpu:${type}:${width}\n#SBATCH --array=0-${requested - 1}%${cap}`;
}

function gateLabel(job: QueueJob): string | null {
  if (job.dependency) return job.dependency;
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  if (/depend|hold|begin/.test(reason)) return job.state_reason ?? job.reason_label ?? "scheduler gate";
  return null;
}

function headlineFor(total: number, gated: number, split: number): string {
  if (!total) return "No pending GPU jobs are visible for shape switching.";
  if (gated && split) return `${gated} GPU request is gated, but a split patch is already visible from topology.`;
  if (gated) return `${gated} GPU request${gated === 1 ? "" : "s"} must clear scheduler gates before shape changes matter.`;
  if (split) return `${split} GPU request${split === 1 ? "" : "s"} can be reshaped around current node-level fit.`;
  return "Visible pending GPU requests fit current node-level topology on paper.";
}

function compareRows(left: GpuShapeRow, right: GpuShapeRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || right.requested - left.requested || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: GpuShapeTone): number {
  return { fit: 0, blocked: 1, split: 2, gated: 3 }[tone];
}
