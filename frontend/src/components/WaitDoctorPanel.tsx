import { Copy, ScanSearch } from "lucide-react";
import { buildWaitDoctor } from "../lib/waitDoctor";
import type { NodeResource, PartitionSummary, PriorityJob, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function WaitDoctorPanel({
  jobs,
  nodes,
  partitions,
  priorityJobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  priorityJobs: PriorityJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const doctor = buildWaitDoctor(jobs, nodes, partitions, priorityJobs, alias);
  return (
    <section className="wait-doctor-panel" aria-label="Slurm wait doctor">
      <div className="wait-doctor-head">
        <SectionTitle icon={<ScanSearch size={18} />} title="Slurm Wait Doctor" />
        <span>{doctor.label}</span>
      </div>
      {doctor.items.length ? (
        <div className="wait-doctor-list">
          {doctor.items.map((item) => (
            <article key={item.jobId} className={`wait-doctor-row tone-${item.tone}`}>
              <div className="wait-doctor-title">
                <div>
                  <strong className="mono">{item.jobId}</strong>
                  <span>{item.jobName} / {item.partition}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => onCopy(item.command, `${item.jobId} wait doctor`)}>
                  <Copy size={15} aria-hidden="true" />
                  Probe
                </button>
              </div>
              <strong>{item.headline}</strong>
              <dl>
                <div>
                  <dt>request</dt>
                  <dd>{item.request}</dd>
                </div>
                {item.factors.slice(0, 5).map((factor) => (
                  <div key={`${item.jobId}-${factor.label}`} className={`severity-${factor.severity}`}>
                    <dt>{factor.label}</dt>
                    <dd>{factor.value}</dd>
                  </div>
                ))}
              </dl>
              <p>{item.advice}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No pending jobs need wait diagnosis in the current filters." />
      )}
    </section>
  );
}
