import { Copy, Rows3 } from "lucide-react";
import { buildPriorityOrderBook, formatScore } from "../lib/priorityOrderBook";
import type { PriorityJob, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PriorityOrderBookPanel({
  jobs,
  priorityJobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  priorityJobs: PriorityJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const book = buildPriorityOrderBook(jobs, priorityJobs, alias);
  return (
    <section className="priority-book" aria-label="Priority order book">
      <div className="priority-book-head">
        <SectionTitle icon={<Rows3 size={18} />} title="Priority Order Book" />
        <div>
          <span>{book.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(book.command, "priority order")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {book.rows.length ? (
        <>
          <p>{book.headline}</p>
          <div className="priority-book-list">
            {book.rows.slice(0, 6).map((row) => (
              <article className={`priority-book-row factor-${row.separator}`} key={row.jobId}>
                <div className="priority-book-title">
                  <strong>#{row.rank}</strong>
                  <div>
                    <span>{row.name}</span>
                    <em className="mono">{row.jobId} / {row.partition} / {row.request}</em>
                  </div>
                  <b>{formatScore(row.score)}</b>
                </div>
                <dl>
                  <div>
                    <dt>dominant</dt>
                    <dd>{row.dominant}</dd>
                  </div>
                  <div>
                    <dt>separator</dt>
                    <dd>{row.separator}</dd>
                  </div>
                  <div>
                    <dt>gap</dt>
                    <dd>{row.spread === null ? "n/a" : formatScore(row.spread)}</dd>
                  </div>
                </dl>
                <p>{row.message}</p>
                <span>{row.action}</span>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text={book.headline} />
      )}
    </section>
  );
}
