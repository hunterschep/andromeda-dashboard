import { Compass, Copy } from "lucide-react";
import { buildSchedulerWeightCompass } from "../lib/schedulerWeightCompass";
import type { PriorityJob, QueueJob, SchedulerHealth } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function SchedulerWeightCompass({
  scheduler,
  jobs,
  priorityJobs,
  alias,
  onCopy
}: {
  scheduler: SchedulerHealth | null;
  jobs: QueueJob[];
  priorityJobs: PriorityJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const compass = buildSchedulerWeightCompass(scheduler, jobs, priorityJobs, alias);
  return (
    <section className="scheduler-weight-compass" aria-label="Scheduler weight compass">
      <div className="scheduler-weight-head">
        <SectionTitle icon={<Compass size={18} />} title="Scheduler Weight Compass" />
        <div>
          <span>{compass.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(compass.command, "scheduler weights")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {compass.rows.length ? (
        <>
          <p>{compass.headline}</p>
          <div className="scheduler-weight-grid">
            {compass.rows.slice(0, 6).map((row) => (
              <article className={`scheduler-weight-row tone-${row.tone}`} key={row.factor}>
                <div className="scheduler-weight-title">
                  <strong>{row.factor.replace("_", " ")}</strong>
                  <span>{row.jobs} visible / {row.dominantJobs} dominant</span>
                </div>
                <dl>
                  <div>
                    <dt>weight</dt>
                    <dd>{row.weight.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>points</dt>
                    <dd>{row.visibleScore.toLocaleString()}</dd>
                  </div>
                </dl>
                <p>{row.message}</p>
                <em>{row.action}</em>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text={compass.headline} />
      )}
    </section>
  );
}
