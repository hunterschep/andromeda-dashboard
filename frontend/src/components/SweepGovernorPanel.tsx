import { Copy, FlaskConical } from "lucide-react";
import { buildSweepGovernor } from "../lib/sweepGovernor";
import type { AccountLimits, HistoryResponse, QueueJob } from "../types";
import { SectionTitle } from "./common";

export function SweepGovernorPanel({
  jobs,
  history,
  accountLimits,
  onCopy
}: {
  jobs: QueueJob[];
  history: HistoryResponse | null;
  accountLimits: AccountLimits | null;
  onCopy: (text: string, label: string) => void;
}) {
  const governor = buildSweepGovernor(jobs, history, accountLimits);
  return (
    <section className="sweep-governor" aria-label="Sweep governor">
      <div className="sweep-governor-head">
        <SectionTitle icon={<FlaskConical size={18} />} title="Sweep Governor" />
        <div>
          <span>{governor.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(governor.script, "governed sweep")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{governor.headline}</p>
      <div className="sweep-governor-grid">
        {governor.rows.map((row) => (
          <article className={`sweep-governor-row tone-${row.tone}`} key={row.label}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.value}</span>
            </div>
            <p>{row.detail}</p>
          </article>
        ))}
      </div>
      <code>{`#SBATCH --array=0-${governor.tasks - 1}%${governor.cap}`}</code>
    </section>
  );
}
