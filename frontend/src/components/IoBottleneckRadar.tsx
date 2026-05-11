import { HardDrive } from "lucide-react";
import { buildIoBottleneckRadar } from "../lib/ioBottleneck";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function IoBottleneckRadar({ history }: { history: HistoryResponse | null }) {
  const radar = buildIoBottleneckRadar(history?.jobs ?? []);
  if (!history?.jobs.length) return <EmptyState text={radar.headline} />;
  return (
    <section className="io-radar" aria-label="I/O bottleneck radar">
      <div className="io-radar-head">
        <SectionTitle icon={<HardDrive size={18} />} title="I/O Bottleneck Radar" />
        <span>{radar.label}</span>
      </div>
      <p>{radar.headline}</p>
      <dl className="io-radar-summary">
        <div>
          <dt>observed</dt>
          <dd>{radar.observed}</dd>
        </div>
        <div>
          <dt>heavy</dt>
          <dd>{radar.heavy}</dd>
        </div>
        <div>
          <dt>missing</dt>
          <dd>{radar.missing}</dd>
        </div>
      </dl>
      <div className="io-radar-list">
        {radar.findings.map((finding) => (
          <article className={`io-radar-row tone-${finding.tone}`} key={finding.jobId}>
            <div className="io-radar-title">
              <div>
                <strong>{finding.name}</strong>
                <span className="mono">{finding.jobId}</span>
              </div>
              <em>{finding.throughput}</em>
            </div>
            <dl>
              <div>
                <dt>volume</dt>
                <dd>{finding.volume}</dd>
              </div>
              <div>
                <dt>runtime</dt>
                <dd>{finding.runtime}</dd>
              </div>
            </dl>
            <p>{finding.signal}</p>
            <span>{finding.action}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
