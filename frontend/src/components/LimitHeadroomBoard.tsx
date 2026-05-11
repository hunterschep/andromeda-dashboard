import { ClipboardCheck, Copy } from "lucide-react";
import { buildLimitHeadroom } from "../lib/limitHeadroom";
import type { AccountLimits, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function LimitHeadroomBoard({
  accountLimits,
  jobs,
  alias,
  onCopy
}: {
  accountLimits: AccountLimits | null;
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const board = buildLimitHeadroom(accountLimits, jobs, alias);
  return (
    <section className="limit-headroom-board" aria-label="Account limit headroom">
      <div className="limit-headroom-head">
        <SectionTitle icon={<ClipboardCheck size={18} />} title="Limit Headroom Board" />
        <div>
          <span>{board.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(board.command, "limit headroom")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {board.rows.length ? (
        <>
          <p>{board.headline}</p>
          <div className="limit-headroom-list">
            {board.rows.slice(0, 4).map((row) => (
              <article className={`limit-headroom-row tone-${row.tone}`} key={row.qos}>
                <div className="limit-headroom-title">
                  <strong className="mono">{row.qos}</strong>
                  <span>{row.active} active or queued job{row.active === 1 ? "" : "s"}</span>
                </div>
                <div className="limit-headroom-checks">
                  {row.checks.slice(0, 5).map((check) => (
                    <div className={`limit-check tone-${check.tone}`} key={`${row.qos}-${check.id}`}>
                      <span>{check.label}</span>
                      <strong>{check.used} / {check.limit}</strong>
                      <em>{check.room}</em>
                    </div>
                  ))}
                </div>
                <p>{row.summary}</p>
                <em>{row.action}</em>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text={board.headline} />
      )}
    </section>
  );
}
