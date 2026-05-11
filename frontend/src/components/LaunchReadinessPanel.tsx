import { Copy, Rocket } from "lucide-react";
import { buildLaunchReadiness } from "../lib/launchReadiness";
import type { AccountLimits, GpuPool, HistoryResponse, QueueJob, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function LaunchReadinessPanel({
  gpuPools,
  jobs,
  history,
  storage,
  accountLimits,
  alias,
  onCopy
}: {
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  accountLimits: AccountLimits | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const readiness = buildLaunchReadiness({ gpuPools, jobs, history, storage, accountLimits, alias });
  return (
    <div className={`launch-readiness launch-${readiness.status}`}>
      <div className="launch-readiness-head">
        <SectionTitle icon={<Rocket size={18} />} title="Launch Readiness" />
        <div>
          <span>{readiness.label}</span>
          <button
            type="button"
            className="copy-button"
            onClick={() => onCopy(readiness.command, "launch preflight")}
            title="Copy launch preflight probe"
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{readiness.headline}</p>
      <div className="launch-check-grid">
        {readiness.checks.map((check) => (
          <article className={`launch-check status-${check.status}`} key={check.id}>
            <div>
              <strong>{check.label}</strong>
              <span>{check.value}</span>
            </div>
            <p>{check.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
