import { Copy, Unplug } from "lucide-react";
import { buildCapacityLossLedger } from "../lib/capacityLoss";
import type { NodeResource, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function CapacityLossLedger({
  nodes,
  jobs,
  alias,
  onCopy
}: {
  nodes: NodeResource[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const ledger = buildCapacityLossLedger(nodes, jobs, alias);
  return (
    <section className={`capacity-loss-panel tone-${ledger.tone}`} aria-label="Capacity loss ledger">
      <div className="capacity-loss-head">
        <SectionTitle icon={<Unplug size={18} />} title="Capacity Loss Ledger" />
        <div>
          <span>{ledger.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(ledger.command, "capacity loss")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{ledger.headline}</p>
      {ledger.rows.length ? (
        <div className="capacity-loss-list">
          {ledger.rows.map((row) => (
            <article className={`capacity-loss-row tone-${row.tone}`} key={row.key}>
              <div>
                <strong>{row.key}</strong>
                <span>{row.nodes}</span>
              </div>
              <em>{row.value}</em>
              <p>{row.detail}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No visible capacity loss in the current node snapshot." />
      )}
    </section>
  );
}
