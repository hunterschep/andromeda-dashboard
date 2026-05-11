import type { CSSProperties } from "react";
import { Copy, Network } from "lucide-react";
import { buildAllocationConstellation } from "../lib/allocationConstellation";
import type { NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function AllocationConstellationPanel({
  nodes,
  jobs,
  alias,
  onCopy
}: {
  nodes: NodeResource[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const map = buildAllocationConstellation(nodes, jobs, alias);
  if (!nodes.length) return <EmptyState text="Allocation constellation needs visible node inventory." />;

  return (
    <section className="allocation-panel" aria-label="Allocation constellation">
      <div className="allocation-head">
        <SectionTitle icon={<Network size={18} />} title="Allocation Constellation" />
        <div>
          <span>{map.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(map.command, "allocation constellation")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{map.headline}</p>
      <dl className="allocation-summary">
        <div>
          <dt>visible jobs</dt>
          <dd>{map.visibleJobs}</dd>
        </div>
        <div>
          <dt>active nodes</dt>
          <dd>{map.activeNodes}</dd>
        </div>
        <div>
          <dt>open nodes</dt>
          <dd>{map.openNodes}</dd>
        </div>
        <div>
          <dt>unplaced</dt>
          <dd>{map.unplacedJobs}</dd>
        </div>
      </dl>
      <div className="allocation-field" aria-label="Node activity map">
        {map.nodes.map((node) => (
          <button
            type="button"
            key={node.name}
            className={`allocation-beacon tone-${node.tone}`}
            style={{ "--activity": `${Math.max(8, node.activity)}%` } as CSSProperties}
            title={`${node.name}: ${node.message}`}
            onClick={() => onCopy(node.command, `${node.name} allocation`)}
          >
            <span>{node.name}</span>
          </button>
        ))}
      </div>
      <div className="allocation-stories">
        {map.nodes.slice(0, 4).map((node) => (
          <article className={`allocation-story tone-${node.tone}`} key={`${node.name}-story`}>
            <div>
              <strong className="mono">{node.name}</strong>
              <span>{node.state}</span>
            </div>
            <p>{node.message}</p>
            <em>{node.jobText}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
