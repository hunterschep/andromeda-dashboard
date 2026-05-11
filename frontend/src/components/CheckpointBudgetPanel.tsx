import { Copy, HardDriveDownload } from "lucide-react";
import { buildCheckpointBudget } from "../lib/checkpointBudget";
import type { QueueJob, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function CheckpointBudgetPanel({
  storage,
  jobs,
  alias,
  onCopy
}: {
  storage: StorageResponse | null;
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const budget = buildCheckpointBudget(storage, jobs, alias);

  return (
    <div className={`checkpoint-budget checkpoint-${budget.level}`}>
      <div className="checkpoint-budget-head">
        <SectionTitle icon={<HardDriveDownload size={18} />} title="Checkpoint Budget" />
        <div>
          <span>{budget.label}</span>
          <button
            type="button"
            className="copy-button"
            onClick={() => onCopy(budget.command, "checkpoint probe")}
            title="Copy checkpoint storage probe"
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{budget.headline}</p>
      <div className="checkpoint-budget-grid">
        {budget.signals.map((signal) => (
          <article className={`checkpoint-budget-signal signal-${signal.severity}`} key={signal.id}>
            <div>
              <strong>{signal.label}</strong>
              <span>{signal.value}</span>
            </div>
            <p>{signal.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
