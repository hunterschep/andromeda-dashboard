import { Copy, Gauge } from "lucide-react";
import { buildAcceleratorHourLedger } from "../lib/acceleratorHours";
import { hours } from "../lib/computeCommitment";
import type { GpuPool, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function AcceleratorHourLedger({
  pools,
  jobs,
  alias,
  onCopy
}: {
  pools: GpuPool[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const ledger = buildAcceleratorHourLedger(pools, jobs, alias);
  return (
    <section className="accelerator-hour-ledger" aria-label="Accelerator hour ledger">
      <div className="accelerator-hour-head">
        <SectionTitle icon={<Gauge size={18} />} title="Accelerator Hour Ledger" />
        <span>{ledger.label}</span>
      </div>
      <p>{ledger.headline}</p>
      {ledger.rows.length ? (
        <div className="accelerator-hour-grid">
          {ledger.rows.slice(0, 5).map((row) => (
            <article className={`accelerator-hour-row tone-${row.tone}`} key={row.type}>
              <div className="accelerator-hour-title">
                <div>
                  <strong className="mono">{row.type}</strong>
                  <span>{row.runningGpu} running / {row.queuedGpu} queued GPU</span>
                </div>
                <button type="button" className="copy-button" onClick={() => onCopy(row.command, `${row.type} GPU-hour ledger`)}>
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <dl>
                <div>
                  <dt>locked</dt>
                  <dd>{hours(row.runningHours)} GPU-h</dd>
                </div>
                <div>
                  <dt>queued</dt>
                  <dd>{hours(row.queuedHours)} GPU-h</dd>
                </div>
                <div>
                  <dt>gated</dt>
                  <dd>{hours(row.gatedHours)} GPU-h</dd>
                </div>
                <div>
                  <dt>undated</dt>
                  <dd>{row.undatedGpu} GPU</dd>
                </div>
              </dl>
              <p>{row.summary}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No accelerator-hour commitment is visible in this queue view." />
      )}
    </section>
  );
}
