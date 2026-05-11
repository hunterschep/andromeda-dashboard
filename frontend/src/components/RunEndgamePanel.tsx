import { Copy, Flag } from "lucide-react";
import { buildRunEndgame } from "../lib/runEndgame";
import type { HistoryResponse, QueueJob, StorageResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function RunEndgamePanel({
  jobs,
  history,
  storage,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const endgame = buildRunEndgame({ jobs, history, storage, alias });
  return (
    <section className="run-endgame-panel" aria-label="Run endgame board">
      <div className="run-endgame-head">
        <SectionTitle icon={<Flag size={18} />} title="Run Endgame Board" />
        <span>{endgame.label}</span>
      </div>
      <p>{endgame.headline}</p>
      {endgame.rows.length ? (
        <div className="run-endgame-list">
          {endgame.rows.slice(0, 5).map((row) => (
            <article className={`run-endgame-row tone-${row.tone}`} key={row.jobId}>
              <div className="run-endgame-title">
                <div>
                  <strong>{row.name}</strong>
                  <span className="mono">{row.jobId} / {row.node}</span>
                </div>
                <button type="button" className="copy-button" onClick={() => onCopy(row.command, `${row.jobId} endgame`)}>
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <dl>
                <div>
                  <dt>remaining</dt>
                  <dd>{row.remaining}</dd>
                </div>
                <div>
                  <dt>progress</dt>
                  <dd>{row.progress === null ? "n/a" : `${row.progress}%`}</dd>
                </div>
                <div>
                  <dt>storage</dt>
                  <dd>{row.storage}</dd>
                </div>
                <div>
                  <dt>risk</dt>
                  <dd>{row.risk}</dd>
                </div>
              </dl>
              <p>{row.headline}</p>
              <em>{row.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No running allocations need endgame planning right now." />
      )}
    </section>
  );
}
