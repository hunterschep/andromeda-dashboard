import { Copy, Hourglass } from "lucide-react";
import { buildWaitBudget } from "../lib/waitBudget";
import type { HistoryResponse, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function WaitBudgetPanel({
  jobs,
  history,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const budget = buildWaitBudget(jobs, history?.jobs ?? [], alias);
  return (
    <section className="wait-budget-panel" aria-label="Historical wait budget">
      <div className="wait-budget-head">
        <SectionTitle icon={<Hourglass size={18} />} title="Historical Wait Budget" />
        <span>{budget.label}</span>
      </div>
      {budget.rows.length ? (
        <>
          <p>{budget.headline}</p>
          <div className="wait-budget-list">
            {budget.rows.slice(0, 5).map((item) => (
              <article className={`wait-budget-row tone-${item.tone}`} key={item.jobId}>
                <div className="wait-budget-title">
                  <div>
                    <strong>{item.name}</strong>
                    <span className="mono">{item.jobId} / {item.partition}</span>
                  </div>
                  <button type="button" className="copy-button" onClick={() => onCopy(item.command, `${item.jobId} wait budget`)}>
                    <Copy size={15} aria-hidden="true" />
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>waited</dt>
                    <dd>{item.waited}</dd>
                  </div>
                  <div>
                    <dt>baseline</dt>
                    <dd>{item.baseline}</dd>
                  </div>
                  <div>
                    <dt>estimate</dt>
                    <dd>{item.estimate}</dd>
                  </div>
                </dl>
                <p>{item.message}</p>
                <span>{item.action}</span>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text={budget.headline} />
      )}
    </section>
  );
}
