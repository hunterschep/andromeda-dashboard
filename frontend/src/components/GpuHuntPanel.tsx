import { Crosshair } from "lucide-react";
import type { GpuPool, NodeResource } from "../types";
import { EmptyState, SectionTitle } from "./common";

const SHAPES = [1, 2, 4, 8];

type HuntRow = {
  type: string;
  usable: number;
  free: number;
  largest: number;
  fitCounts: number[];
  partitions: string[];
  nodes: { name: string; free: number; partitions: string[] }[];
};

export function GpuHuntPanel({ nodes, pools }: { nodes: NodeResource[]; pools: GpuPool[] }) {
  const rows = buildHunts(nodes, pools);
  if (!rows.length) return <EmptyState text="No GPU capacity is visible in the current node snapshot." />;
  return (
    <section className="gpu-hunt-panel" aria-label="GPU fit board">
      <div className="gpu-hunt-head">
        <SectionTitle icon={<Crosshair size={18} />} title="GPU Hunt Board" />
        <span>{rows.filter((row) => row.usable > 0).length} families huntable now</span>
      </div>
      <div className="gpu-hunt-grid">
        {rows.map((row) => (
          <article key={row.type} className={`gpu-hunt-row tone-${tone(row)}`}>
            <div className="gpu-hunt-title">
              <strong className="mono">{row.type}</strong>
              <span>{row.usable ? `${row.usable} usable` : "blocked"}</span>
            </div>
            <div className="gpu-shape-ladder">
              {SHAPES.map((shape, index) => (
                <div key={`${row.type}-${shape}`}>
                  <span>{shape}x</span>
                  <strong>{row.fitCounts[index]}</strong>
                </div>
              ))}
            </div>
            <dl>
              <div>
                <dt>free</dt>
                <dd>{row.free}</dd>
              </div>
              <div>
                <dt>largest node</dt>
                <dd>{row.largest}</dd>
              </div>
              <div>
                <dt>partitions</dt>
                <dd>{row.partitions.slice(0, 3).join(", ") || "n/a"}</dd>
              </div>
            </dl>
            <p>{huntMessage(row)}</p>
            <div className="gpu-hunt-nodes">
              {row.nodes.slice(0, 3).map((node) => (
                <span key={`${row.type}-${node.name}`}>{node.name}: {node.free}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function buildHunts(nodes: NodeResource[], pools: GpuPool[]): HuntRow[] {
  const types = Array.from(new Set([...pools.map((pool) => pool.type), ...nodes.flatMap((node) => node.gpu_types)])).sort();
  return types.map((type) => rowForType(type, nodes, pools.find((pool) => pool.type === type)));
}

function rowForType(type: string, nodes: NodeResource[], pool: GpuPool | undefined): HuntRow {
  const candidates = nodes
    .map((node) => ({ node, gpu: node.gres.find((item) => item.type === type) }))
    .filter((item): item is { node: NodeResource; gpu: NonNullable<typeof item.gpu> } => Boolean(item.gpu));
  const available = candidates.filter((item) => item.node.is_available && item.gpu.free > 0);
  const free = pool?.free ?? candidates.reduce((sum, item) => sum + item.gpu.free, 0);
  const usable = pool?.usable ?? available.reduce((sum, item) => sum + item.gpu.free, 0);
  return {
    type,
    usable,
    free,
    largest: Math.max(0, ...available.map((item) => item.gpu.free)),
    fitCounts: SHAPES.map((shape) => available.filter((item) => item.gpu.free >= shape).length),
    partitions: Array.from(new Set(available.flatMap((item) => item.node.partitions))).sort(),
    nodes: available
      .map((item) => ({ name: item.node.name, free: item.gpu.free, partitions: item.node.partitions }))
      .sort((left, right) => right.free - left.free || left.name.localeCompare(right.name))
  };
}

function tone(row: HuntRow): "calm" | "busy" | "hot" {
  if (row.largest >= 4) return "calm";
  if (row.usable > 0) return "busy";
  return "hot";
}

function huntMessage(row: HuntRow): string {
  if (row.largest >= 4) return `A ${row.largest} GPU contiguous slot is visible; this is the cleanest target for wide jobs.`;
  if (row.usable > 0) return `${row.free} free GPU(s), but the largest visible node fit is ${row.largest}; wide jobs may fragment.`;
  if (row.free <= 0) return `No free ${row.type} GPUs are visible right now; watch turnover before submitting wide work.`;
  return `${row.free} GPU(s) exist in the pool, but none are currently usable on available nodes.`;
}
