import { BatteryCharging } from "lucide-react";
import { buildComputeCommitment, hours } from "../lib/computeCommitment";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function ComputeCommitmentPanel({ jobs }: { jobs: QueueJob[] }) {
  const commitment = buildComputeCommitment(jobs);
  if (!commitment.lanes.length) return <EmptyState text="No running or pending jobs are visible for commitment accounting." />;
  return (
    <article className="commitment-panel">
      <div className="commitment-head">
        <SectionTitle icon={<BatteryCharging size={18} />} title="Compute Commitment" />
        <span>{commitment.undatedJobs} undated</span>
      </div>
      <p>{commitment.headline}</p>
      <dl className="commitment-summary">
        <div>
          <dt>locked GPU-h</dt>
          <dd>{hours(commitment.runningGpuHours)}</dd>
        </div>
        <div>
          <dt>queued GPU-h</dt>
          <dd>{hours(commitment.pendingGpuHours)}</dd>
        </div>
        <div>
          <dt>locked CPU-h</dt>
          <dd>{hours(commitment.runningCpuHours)}</dd>
        </div>
        <div>
          <dt>queued CPU-h</dt>
          <dd>{hours(commitment.pendingCpuHours)}</dd>
        </div>
      </dl>
      <div className="commitment-lanes">
        {commitment.lanes.slice(0, 5).map((lane) => (
          <div key={lane.partition} className={`commitment-lane tone-${lane.tone}`}>
            <div>
              <strong className="mono">{lane.partition}</strong>
              <span>{lane.running} run / {lane.pending} pend</span>
            </div>
            <div className="commitment-track" aria-label={`${lane.partition} commitment`}>
              <span style={{ width: `${Math.min(100, lane.gpuHours * 8 + lane.cpuHours / 64)}%` }} />
            </div>
            <em>{hours(lane.gpuHours)} GPU-h / {hours(lane.cpuHours)} CPU-h</em>
          </div>
        ))}
      </div>
    </article>
  );
}
