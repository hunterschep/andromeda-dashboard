import type { CacheMeta, GpuPool, HistoryResponse, NodeResource, QueueJob } from "../types";

export type OpsBriefTone = "clear" | "watch" | "critical";

export type OpsBriefLine = {
  label: string;
  value: string;
  detail: string;
};

export type OpsBrief = {
  tone: OpsBriefTone;
  label: string;
  headline: string;
  copy: string;
  lines: OpsBriefLine[];
};

export function buildOpsBrief({
  jobs,
  gpuPools,
  nodes,
  history,
  cache
}: {
  jobs: QueueJob[];
  gpuPools: GpuPool[];
  nodes: NodeResource[];
  history: HistoryResponse | null;
  cache: CacheMeta[];
}): OpsBrief {
  const running = jobs.filter((job) => job.state === "RUNNING").length;
  const pending = jobs.filter((job) => job.state === "PENDING");
  const pendingGpu = pending.reduce((sum, job) => sum + job.gpu_count, 0);
  const usableGpu = gpuPools.reduce((sum, pool) => sum + pool.usable, 0);
  const poolGpu = gpuPools.reduce((sum, pool) => sum + pool.total, 0);
  const offlineGpu = nodes.filter((node) => !node.is_available || node.reason).reduce((sum, node) => sum + node.gpu_total, 0);
  const cleanRate = cleanRateFor(history);
  const stale = cache.filter((meta) => meta.is_stale).map((meta) => meta.key);
  const tone = pendingGpu > usableGpu && pendingGpu > 0 ? "critical" : offlineGpu || stale.length || cleanRate < 75 ? "watch" : "clear";
  const headline = headlineFor({ pendingGpu, usableGpu, offlineGpu, stale, cleanRate });
  const lines = [
    { label: "queue", value: `${running} running / ${pending.length} pending`, detail: `${pendingGpu} GPU requested by pending jobs.` },
    { label: "gpu", value: `${usableGpu}/${poolGpu} usable`, detail: `${offlineGpu} GPU offline by node state or reason.` },
    { label: "history", value: `${cleanRate}% clean history`, detail: cleanRate < 75 ? "Recent failures should shape launch decisions." : "Recent runs are mostly clean." },
    { label: "freshness", value: stale.length ? `${stale.length} stale source${stale.length === 1 ? "" : "s"}` : "sources fresh", detail: stale.length ? stale.join(", ") : "Visible cache sources are inside TTL." }
  ];
  return {
    tone,
    label: labelFor(tone, pendingGpu, usableGpu),
    headline,
    lines,
    copy: copyFor(headline, lines)
  };
}

function headlineFor({
  pendingGpu,
  usableGpu,
  offlineGpu,
  stale,
  cleanRate
}: {
  pendingGpu: number;
  usableGpu: number;
  offlineGpu: number;
  stale: string[];
  cleanRate: number;
}): string {
  if (pendingGpu > usableGpu && pendingGpu > 0) {
    return `Andromeda is GPU-constrained: ${pendingGpu} pending GPU requests are competing for ${usableGpu} usable GPUs while ${offlineGpu} GPU are offline.`;
  }
  if (offlineGpu) return `${offlineGpu} GPU are offline, but visible pending GPU demand still fits usable supply.`;
  if (stale.length) return `Dashboard state is partially cached; stale sources: ${stale.join(", ")}.`;
  if (cleanRate < 75) return `Cluster capacity is readable, but recent jobs are only ${cleanRate}% clean.`;
  return "Andromeda has readable capacity and no major visible launch blocker.";
}

function labelFor(tone: OpsBriefTone, pendingGpu: number, usableGpu: number): string {
  if (tone === "critical") return `${pendingGpu}/${usableGpu} GPU pressure`;
  if (tone === "watch") return "watch conditions";
  return "clear brief";
}

function cleanRateFor(history: HistoryResponse | null): number {
  const jobs = history?.jobs ?? [];
  if (!jobs.length) return 100;
  const failed = jobs.filter((job) => !["COMPLETED", "RUNNING"].includes(job.state)).length;
  return Math.round(((jobs.length - failed) / jobs.length) * 100);
}

function copyFor(headline: string, lines: OpsBriefLine[]): string {
  return [headline, ...lines.map((line) => `${line.label}: ${line.value} - ${line.detail}`)].join("\n");
}
