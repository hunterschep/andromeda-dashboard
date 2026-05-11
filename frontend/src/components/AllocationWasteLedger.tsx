import { Copy, Gauge } from "lucide-react";
import { buildAllocationWasteLedger } from "../lib/allocationWaste";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function AllocationWasteLedger({
  history,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const ledger = buildAllocationWasteLedger(history?.jobs ?? [], alias);
  if (!history?.jobs.length) return <EmptyState text="No recent accounting data available for allocation waste." />;
  return (
    <section className="allocation-waste-ledger" aria-label="Allocation waste ledger">
      <div className="allocation-waste-head">
        <SectionTitle icon={<Gauge size={18} />} title="Allocation Waste Ledger" />
        <div>
          <span>{ledger.label}</span>
          <button
            type="button"
            className="copy-button"
            title="Copy waste accounting probe"
            aria-label="Copy waste accounting probe"
            onClick={() => onCopy(ledger.command, "waste ledger")}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{ledger.headline}</p>
      {ledger.rows.length ? (
        <div className="allocation-waste-list">
          {ledger.rows.map((row) => (
            <article className={`allocation-waste-row severity-${row.severity} kind-${row.kind}`} key={row.id}>
              <div>
                <strong>{row.value}</strong>
                <span className="mono">{row.jobId} / {row.kind}</span>
              </div>
              <p>{row.detail}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No high-confidence CPU, memory, or GPU waste rows are visible." />
      )}
    </section>
  );
}
