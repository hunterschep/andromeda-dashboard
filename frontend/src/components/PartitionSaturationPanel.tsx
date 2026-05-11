import { Copy, Gauge } from "lucide-react";
import { buildPartitionSaturation } from "../lib/partitionSaturation";
import type { PartitionSummary, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PartitionSaturationPanel({
  partitions,
  jobs,
  alias,
  onCopy
}: {
  partitions: PartitionSummary[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const saturation = buildPartitionSaturation(partitions, jobs, alias);
  if (!saturation.rows.length) return <EmptyState text="No partition saturation data is available." />;
  return (
    <section className="partition-saturation-panel" aria-label="Partition saturation map">
      <div className="partition-saturation-head">
        <SectionTitle icon={<Gauge size={18} />} title="Partition Saturation Map" />
        <span>{saturation.label}</span>
      </div>
      <p>{saturation.headline}</p>
      <div className="partition-saturation-list">
        {saturation.rows.slice(0, 6).map((row) => (
          <article className={`partition-saturation-row tone-${row.tone}`} key={row.name}>
            <div className="partition-saturation-title">
              <div>
                <strong className="mono">{row.name}</strong>
                <span>{row.queue}</span>
              </div>
              <button type="button" className="icon-button" onClick={() => onCopy(row.command, `${row.name} saturation`)}>
                <Copy size={15} aria-hidden="true" />
                Probe
              </button>
            </div>
            <p>{row.headline}</p>
            <div className="partition-saturation-bars">
              <Meter label="CPU busy" value={row.cpuBusy} />
              <Meter label="GPU busy" value={row.gpuBusy} />
            </div>
            <dl>
              <div>
                <dt>pending CPU</dt>
                <dd>{row.pendingCpu}</dd>
              </div>
              <div>
                <dt>pending GPU</dt>
                <dd>{row.pendingGpu}</dd>
              </div>
              <div>
                <dt>gated GPU</dt>
                <dd>{row.gatedGpu}</dd>
              </div>
              <div>
                <dt>free memory</dt>
                <dd>{row.memory}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="partition-meter">
      <span>{label}</span>
      <div>
        <i style={{ width: `${value}%` }} />
      </div>
      <strong>{value}%</strong>
    </div>
  );
}
