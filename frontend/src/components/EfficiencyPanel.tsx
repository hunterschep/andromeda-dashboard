import { Gauge } from "lucide-react";
import { buildEfficiencySummary } from "../lib/efficiencyAnalytics";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function EfficiencyPanel({ history }: { history: HistoryResponse | null }) {
  const summary = buildEfficiencySummary(history?.jobs ?? []);
  if (!history?.jobs.length) return <EmptyState text="No completed jobs available for allocation analysis." />;
  return (
    <div className="efficiency-panel">
      <div className="efficiency-head">
        <SectionTitle icon={<Gauge size={18} />} title="Allocation Efficiency" />
        <span>{summary.score}/100</span>
      </div>
      <dl className="efficiency-summary">
        <div>
          <dt>GPU jobs</dt>
          <dd>{summary.gpuJobs}</dd>
        </div>
        <div>
          <dt>low CPU</dt>
          <dd>{summary.lowCpu}</dd>
        </div>
        <div>
          <dt>low GPU</dt>
          <dd>{summary.lowGpu}</dd>
        </div>
        <div>
          <dt>memory</dt>
          <dd>{summary.memoryWaste}</dd>
        </div>
      </dl>
      {summary.findings.length ? (
        <div className="efficiency-list">
          {summary.findings.slice(0, 6).map((finding) => (
            <article key={finding.id} className={`efficiency-item severity-${finding.severity}`}>
              <div>
                <strong>{finding.title}</strong>
                <span className="mono">{finding.jobId}</span>
              </div>
              <p>{finding.detail}</p>
              <span>{finding.action}</span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No obvious allocation-shape issues in this history window." />
      )}
    </div>
  );
}
