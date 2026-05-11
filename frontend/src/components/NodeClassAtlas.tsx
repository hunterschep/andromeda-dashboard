import { Boxes } from "lucide-react";
import { formatMemory, formatNumber } from "../api";
import { buildNodeClassAtlas } from "../lib/nodeClassAtlas";
import type { NodeResource } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function NodeClassAtlas({ nodes }: { nodes: NodeResource[] }) {
  const profiles = buildNodeClassAtlas(nodes);
  if (!profiles.length) return <EmptyState text="No node classes are visible in the current filters." />;

  return (
    <div className="node-atlas-panel">
      <div className="node-atlas-head">
        <SectionTitle icon={<Boxes size={18} />} title="Node Class Atlas" />
        <span>{profiles.length} hardware class{profiles.length === 1 ? "" : "es"}</span>
      </div>
      <div className="node-atlas-grid">
        {profiles.slice(0, 6).map((profile) => (
          <article className={`node-class-row tone-${profile.tone}`} key={profile.id}>
            <div className="node-class-title">
              <div>
                <strong>{profile.label}</strong>
                <span>{profile.bestFor}</span>
              </div>
              <em>{profile.available}/{profile.nodes}</em>
            </div>
            <dl>
              <div>
                <dt>GPU</dt>
                <dd>{profile.freeGpu}/{profile.totalGpu}</dd>
              </div>
              <div>
                <dt>max fit</dt>
                <dd>{profile.maxFreeGpu}</dd>
              </div>
              <div>
                <dt>CPU</dt>
                <dd>{formatNumber(profile.idleCpu)}</dd>
              </div>
              <div>
                <dt>memory</dt>
                <dd>{formatMemory(profile.freeMemoryMb)}</dd>
              </div>
            </dl>
            <div className="node-class-partitions">
              {profile.partitions.slice(0, 4).map((partition) => (
                <span key={`${profile.id}-${partition}`}>{partition}</span>
              ))}
            </div>
            <p>{profile.message}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
