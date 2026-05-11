import { Copy, Monitor } from "lucide-react";
import { buildInteractiveSessionSentinel } from "../lib/interactiveSessions";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function InteractiveSessionSentinel({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const sentinel = buildInteractiveSessionSentinel(jobs, alias);
  return (
    <div className="interactive-sentinel">
      <div className="interactive-sentinel-head">
        <SectionTitle icon={<Monitor size={18} />} title="Interactive Session Sentinel" />
        <span>{sentinel.label}</span>
      </div>
      <p>{sentinel.message}</p>
      {sentinel.sessions.length ? (
        <div className="interactive-session-list">
          {sentinel.sessions.slice(0, 4).map((session) => (
            <article className={`interactive-session-row tone-${session.tone}`} key={session.jobId}>
              <div className="interactive-session-title">
                <div>
                  <strong>{session.title}</strong>
                  <span>
                    {session.name} · {session.jobId}
                  </span>
                </div>
                <div className="interactive-session-actions">
                  {session.commands.map((command) => (
                    <button
                      type="button"
                      className="runbook-command"
                      key={`${session.jobId}-${command.label}`}
                      onClick={() => onCopy(command.value, `${command.label} ${session.jobId}`)}
                    >
                      <Copy size={14} aria-hidden="true" />
                      {command.label}
                    </button>
                  ))}
                </div>
              </div>
              <p>{session.detail}</p>
              <dl>
                {session.facts.map((fact) => (
                  <div key={`${session.jobId}-${fact.label}`}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No interactive notebook sessions are visible." />
      )}
    </div>
  );
}
