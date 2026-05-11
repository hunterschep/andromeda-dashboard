import { Copy, GitBranch } from "lucide-react";
import { buildDependencyRadar } from "../lib/dependencyRadar";
import type { QueueJob } from "../types";
import { SectionTitle } from "./common";

export function DependencyRadarPanel({
  jobs,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const radar = buildDependencyRadar(jobs, alias);
  return (
    <div className="dependency-radar">
      <div className="dependency-radar-head">
        <SectionTitle icon={<GitBranch size={18} />} title="Dependency Radar" />
        <span>{radar.label}</span>
      </div>
      <p>{radar.message}</p>
      {radar.items.length ? (
        <div className="dependency-radar-list">
          {radar.items.slice(0, 4).map((item) => (
            <article className={`dependency-radar-row severity-${item.severity}`} key={item.jobId}>
              <div className="dependency-radar-title">
                <div>
                  <strong>{item.jobName}</strong>
                  <span className="mono">{item.jobId} / {item.user}</span>
                </div>
                <em>{item.label}</em>
              </div>
              <dl>
                <div>
                  <dt>dependency</dt>
                  <dd>{item.dependency}</dd>
                </div>
                <div>
                  <dt>blockers</dt>
                  <dd>{item.blockers.join(", ") || "n/a"}</dd>
                </div>
              </dl>
              <p>{item.message}</p>
              <div className="dependency-radar-action">
                <span>{item.action}</span>
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => onCopy(item.command, `${item.jobId} dependency`)}
                  title={`Copy dependency probe for ${item.jobId}`}
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
