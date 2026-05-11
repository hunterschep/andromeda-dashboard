import { BarChart3 } from "lucide-react";
import { formatDuration } from "../api";
import { buildHistoryAnalytics } from "../lib/historyAnalytics";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function HistoryIntelligencePanel({ history }: { history: HistoryResponse | null }) {
  const analytics = buildHistoryAnalytics(history?.jobs ?? []);
  if (!analytics.total) return <EmptyState text="No historical rows available for analytics." />;
  return (
    <div className="history-intel-panel">
      <div className="history-intel-head">
        <SectionTitle icon={<BarChart3 size={18} />} title="History Intelligence" />
        <span>{analytics.cleanRate}% clean</span>
      </div>
      <dl className="history-intel-summary">
        <div>
          <dt>best partition</dt>
          <dd>{analytics.bestPartition}</dd>
        </div>
        <div>
          <dt>quiet window</dt>
          <dd>{analytics.quietWindow}</dd>
        </div>
        <div>
          <dt>GPU jobs</dt>
          <dd>{analytics.gpuJobs}</dd>
        </div>
      </dl>
      <div className="wait-band-grid">
        {analytics.waitBands.map((band) => (
          <div key={band.label}>
            <span>{band.label}</span>
            <strong>{band.count}</strong>
          </div>
        ))}
      </div>
      <div className="submit-strategy">
        <strong>Submit Strategy</strong>
        {analytics.submitWindows.slice(0, 4).map((window) => (
          <article key={window.label}>
            <div>
              <span>{window.label}</span>
              <em>{formatDuration(window.medianWait)}</em>
            </div>
            <dl>
              <div>
                <dt>clean</dt>
                <dd>{window.cleanRate}%</dd>
              </div>
              <div>
                <dt>GPU</dt>
                <dd>{window.gpuJobs}</dd>
              </div>
              <div>
                <dt>jobs</dt>
                <dd>{window.jobs}</dd>
              </div>
            </dl>
            <p>{window.advice}</p>
          </article>
        ))}
      </div>
      <div className="partition-history-list">
        {analytics.partitions.slice(0, 4).map((partition) => (
          <article key={partition.partition}>
            <div>
              <strong className="mono">{partition.partition}</strong>
              <span>{partition.jobs} jobs / {partition.failures} failed</span>
            </div>
            <div className="friction-track" aria-label={`${partition.partition} friction ${partition.friction}`}>
              <span style={{ width: `${Math.min(100, partition.friction)}%` }} />
            </div>
            <dl>
              <div>
                <dt>wait</dt>
                <dd>{formatDuration(partition.medianWait)}</dd>
              </div>
              <div>
                <dt>runtime</dt>
                <dd>{formatDuration(partition.medianRuntime)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
