import { Copy, Radar } from "lucide-react";
import { buildNextLaunchImpact } from "../lib/nextLaunchImpact";
import type { PlannerInput, PlannerResult } from "../lib/requestPlanner";
import type { AccountLimits, GpuPool, HistoryResponse, QueueJob, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function NextLaunchImpact({
  input,
  best,
  gpuPools,
  jobs,
  history,
  storage,
  accountLimits,
  alias,
  onCopy
}: {
  input: PlannerInput;
  best: PlannerResult | null;
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  accountLimits: AccountLimits | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const impact = buildNextLaunchImpact({ input, result: best, gpuPools, jobs, history, storage, accountLimits, alias });
  return (
    <div className={`next-launch-impact impact-${impact.status}`}>
      <div className="next-launch-head">
        <SectionTitle icon={<Radar size={18} />} title="Next Launch Impact" />
        <div>
          <span>{impact.label}</span>
          <button
            type="button"
            className="copy-button"
            title="Copy impact probe"
            aria-label="Copy next launch impact probe"
            onClick={() => onCopy(impact.command, "next launch impact")}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{impact.headline}</p>
      <div className="next-launch-grid">
        {impact.rows.map((row) => (
          <article className={`next-launch-row status-${row.status}`} key={row.id}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.value}</span>
            </div>
            <p>{row.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
