import { Copy, HardDrive } from "lucide-react";
import { buildDataStagingPlan } from "../lib/dataStaging";
import type { HistoryResponse, QueueJob, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function DataStagingPlanner({
  storage,
  jobs,
  history,
  alias,
  onCopy
}: {
  storage: StorageResponse | null;
  jobs: QueueJob[];
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const plan = buildDataStagingPlan({ storage, jobs, history, alias });

  return (
    <div className={`data-staging data-staging-${plan.level}`}>
      <div className="data-staging-head">
        <SectionTitle icon={<HardDrive size={18} />} title="Data Staging Planner" />
        <div>
          <span>{plan.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(plan.command, "staging command")} title="Copy staging command">
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{plan.headline}</p>
      <div className="data-staging-grid">
        {plan.signals.map((signal) => (
          <article className={`data-staging-signal signal-${signal.severity}`} key={signal.id}>
            <div>
              <strong>{signal.label}</strong>
              <span>{signal.value}</span>
            </div>
            <p>{signal.detail}</p>
          </article>
        ))}
      </div>
      <button type="button" className="data-staging-copy" onClick={() => onCopy(plan.command, "staging command")}>
        <Copy size={14} aria-hidden="true" />
        <span>Stage with rsync</span>
      </button>
    </div>
  );
}
