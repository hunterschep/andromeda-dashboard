import { Scale } from "lucide-react";
import { buildFairshareBurn, hours } from "../lib/fairshareBurn";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function FairshareBurnPanel({ history }: { history: HistoryResponse | null }) {
  const burn = buildFairshareBurn(history?.jobs ?? []);
  if (!burn.jobs) return <EmptyState text="No completed runtime rows available for fairshare inference." />;
  return (
    <div className={`fairshare-panel tier-${burn.tier}`}>
      <div className="fairshare-head">
        <SectionTitle icon={<Scale size={18} />} title="Fairshare Burn" />
        <span>{burn.confidence} confidence</span>
      </div>
      <dl className="fairshare-summary">
        <div>
          <dt>GPU-h</dt>
          <dd>{hours(burn.gpuHours)}</dd>
        </div>
        <div>
          <dt>CPU-h</dt>
          <dd>{hours(burn.cpuHours)}</dd>
        </div>
        <div>
          <dt>tier</dt>
          <dd>{burn.tier}</dd>
        </div>
        <div>
          <dt>hot partition</dt>
          <dd>{burn.dominantPartition}</dd>
        </div>
      </dl>
      <p>{burn.message}</p>
      <div className="fairshare-partitions">
        {burn.partitions.slice(0, 4).map((partition) => (
          <article key={partition.partition}>
            <div>
              <strong className="mono">{partition.partition}</strong>
              <span>{partition.jobs} jobs</span>
            </div>
            <div className="fairshare-track" aria-label={`${partition.partition} burn share ${partition.share}`}>
              <span style={{ width: `${partition.share}%` }} />
            </div>
            <em>{hours(partition.gpuHours)} GPU-h / {hours(partition.cpuHours)} CPU-h</em>
          </article>
        ))}
      </div>
    </div>
  );
}
