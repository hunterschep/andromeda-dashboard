import { Copy, Scale } from "lucide-react";
import { buildFairshareImpact, hours } from "../lib/fairshareImpact";
import type { HistoryResponse, QueueResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function FairshareImpactPanel({
  history,
  myJobs,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  myJobs: QueueResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const impact = buildFairshareImpact(history?.jobs ?? [], myJobs?.jobs ?? []);
  if (!impact.rows.length) return <EmptyState text="No recent or active compute usage is visible for fairshare impact." />;
  return (
    <div className={`fairshare-impact-panel tier-${impact.tier}`}>
      <div className="fairshare-impact-head">
        <SectionTitle icon={<Scale size={18} />} title="Fairshare Impact Forecast" />
        <span>{impact.label}</span>
      </div>
      <dl className="fairshare-impact-summary">
        <div>
          <dt>recent GPU-h</dt>
          <dd>{hours(impact.recentGpuHours)}</dd>
        </div>
        <div>
          <dt>active GPU-h</dt>
          <dd>{hours(impact.activeGpuHours)}</dd>
        </div>
        <div>
          <dt>remaining</dt>
          <dd>{hours(impact.remainingGpuHours)}</dd>
        </div>
        <div>
          <dt>projected</dt>
          <dd>{hours(impact.projectedGpuHours)}</dd>
        </div>
      </dl>
      <p>{impact.message}</p>
      <div className="fairshare-impact-rows">
        {impact.rows.map((row) => (
          <article key={row.label} className={`tone-${row.tone}`}>
            <div>
              <strong>{row.label}</strong>
              <span>{hours(row.gpuHours)} GPU-h</span>
            </div>
            <em>{hours(row.cpuHours)} CPU-h</em>
          </article>
        ))}
      </div>
      <div className="fairshare-impact-actions">
        <span>{impact.action}</span>
        <button type="button" className="copy-button" onClick={() => onCopy(command(alias), "fairshare impact")}>
          <Copy size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function command(alias: string): string {
  return `ssh ${alias} 'sacct -u "$USER" --starttime=now-14days --format=JobID,JobName,State,Elapsed,ReqTRES,AllocTRES,TRESUsageInAve -P; squeue -u "$USER" -o "%i|%j|%T|%P|%M|%l|%b|%R"'`;
}
