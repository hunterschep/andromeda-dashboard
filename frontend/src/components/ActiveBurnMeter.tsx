import { Copy, Flame } from "lucide-react";
import { buildActiveBurn, hours } from "../lib/activeBurn";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function ActiveBurnMeter({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const burn = buildActiveBurn(jobs, alias);
  return (
    <div className="active-burn-panel">
      <div className="active-burn-head">
        <SectionTitle icon={<Flame size={18} />} title="Compute Burn Meter" />
        <span>{burn.label}</span>
      </div>
      <p>{burn.headline}</p>
      {burn.rows.length ? (
        <>
          <dl className="active-burn-summary">
            <div>
              <dt>active</dt>
              <dd>{burn.activeJobs}</dd>
            </div>
            <div>
              <dt>GPU jobs</dt>
              <dd>{burn.gpuJobs}</dd>
            </div>
            <div>
              <dt>left GPU-h</dt>
              <dd>{hours(burn.remainingGpuHours)}</dd>
            </div>
            <div>
              <dt>CPU-h</dt>
              <dd>{hours(burn.elapsedCpuHours)}</dd>
            </div>
          </dl>
          <div className="active-burn-list">
            {burn.rows.slice(0, 5).map((row) => (
              <article className={`active-burn-row tone-${row.tone}`} key={row.jobId}>
                <div className="active-burn-title">
                  <div>
                    <strong>{row.title}</strong>
                    <span className="mono">{row.jobId} / {row.name}</span>
                  </div>
                  <button type="button" className="copy-button" onClick={() => onCopy(row.command, `${row.jobId} burn meter`)}>
                    <Copy size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className="active-burn-track" aria-label={`${row.jobId} walltime progress`}>
                  <span style={{ width: `${row.progress ?? 0}%` }} />
                </div>
                <p>{row.detail}</p>
                <em>{row.action}</em>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text="No running jobs are visible for compute burn tracking." />
      )}
    </div>
  );
}
