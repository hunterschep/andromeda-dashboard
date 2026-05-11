import { Activity, Copy } from "lucide-react";
import { buildGpuFlow, type GpuFlowSegment } from "../lib/gpuFlow";
import type { GpuPool, NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuFlowPanel({
  nodes,
  pools,
  jobs,
  alias,
  onCopy
}: {
  nodes: NodeResource[];
  pools: GpuPool[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const rows = buildGpuFlow(nodes, pools, jobs);
  const constrained = rows.filter((row) => row.tone !== "calm").length;
  return (
    <section className="gpu-flow-panel" aria-label="GPU flow map">
      <div className="gpu-flow-head">
        <SectionTitle icon={<Activity size={18} />} title="GPU Flow Map" />
        <span>{constrained} constrained families</span>
      </div>
      {rows.length ? (
        <div className="gpu-flow-list">
          {rows.slice(0, 6).map((row) => (
            <article key={row.type} className={`gpu-flow-row tone-${row.tone}`}>
              <div className="gpu-flow-title">
                <div>
                  <strong className="mono">{row.type}</strong>
                  <span>{row.summary}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => onCopy(probe(alias, row.type), `${row.type} GPU flow`)}>
                  <Copy size={15} aria-hidden="true" />
                  Probe
                </button>
              </div>
              <div className="gpu-flow-lanes">
                <FlowLane label="fleet" segments={row.fleet} empty="no fleet inventory" />
                <FlowLane label="motion" segments={row.demand} empty="no visible GPU demand" />
              </div>
              <dl>
                <div>
                  <dt>largest fit</dt>
                  <dd>{row.largestFree}</dd>
                </div>
                <div>
                  <dt>return &lt;2h</dt>
                  <dd>{row.returningSoon}</dd>
                </div>
                <div>
                  <dt>gated</dt>
                  <dd>{row.pendingGated}</dd>
                </div>
                <div>
                  <dt>dark active</dt>
                  <dd>{row.undatedActive}</dd>
                </div>
              </dl>
              <p>{row.message}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No GPU fleet or GPU job motion is visible in this snapshot." />
      )}
    </section>
  );
}

function FlowLane({ label, segments, empty }: { label: string; segments: GpuFlowSegment[]; empty: string }) {
  return (
    <div className="gpu-flow-lane">
      <span>{label}</span>
      <div className="gpu-flow-track">
        {segments.length ? segments.map((segment) => <FlowSegment key={`${label}-${segment.key}`} segment={segment} />) : <em>{empty}</em>}
      </div>
    </div>
  );
}

function FlowSegment({ segment }: { segment: GpuFlowSegment }) {
  return (
    <div className={`gpu-flow-segment is-${segment.key}`} style={{ flexGrow: segment.count, flexBasis: 0 }}>
      <span>{segment.label}</span>
      <strong>{segment.count}</strong>
    </div>
  );
}

function probe(alias: string, type: string): string {
  const family = type.replace(/'/g, "'\\''");
  return `ssh ${alias} 'sinfo -Nel -o "%N|%t|%G|%P|%m|%C|%E" | grep -i -- "${family}"; squeue -t R,PD -O JobID:12,Name:24,UserName:16,Partition:12,State:12,Reason:28,TresPerNode:24,EndTime:22,NodeList:24'`;
}
