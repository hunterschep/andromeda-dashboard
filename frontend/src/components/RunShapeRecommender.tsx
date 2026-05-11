import { Copy, ListChecks } from "lucide-react";
import { formatDuration } from "../api";
import { buildRunShapeRecommendations } from "../lib/runShape";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function RunShapeRecommender({
  history,
  onCopy
}: {
  history: HistoryResponse | null;
  onCopy: (text: string, label: string) => void;
}) {
  const summary = buildRunShapeRecommendations(history?.jobs ?? []);
  return (
    <div className="run-shape-panel">
      <div className="run-shape-head">
        <SectionTitle icon={<ListChecks size={18} />} title="Run Shape Recommender" />
        <span>{summary.label}</span>
      </div>
      {summary.recommendations.length ? (
        <div className="run-shape-list">
          {summary.recommendations.map((shape) => (
            <article key={shape.key} className={`run-shape-row tone-${shape.tone}`}>
              <div className="run-shape-title">
                <div>
                  <strong>{shape.title}</strong>
                  <span>{shape.partition} / {shape.request}</span>
                </div>
                <button type="button" className="copy-button" onClick={() => onCopy(shape.sbatch, `${shape.title} sbatch`)}>
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <dl>
                <div>
                  <dt>clean</dt>
                  <dd>{shape.cleanRate}%</dd>
                </div>
                <div>
                  <dt>wait</dt>
                  <dd>{formatDuration(shape.medianWait)}</dd>
                </div>
                <div>
                  <dt>jobs</dt>
                  <dd>{shape.jobs}</dd>
                </div>
              </dl>
              <p>{shape.message}</p>
              <span>{shape.action}</span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No accounting shapes are available for recommendations yet." />
      )}
    </div>
  );
}
