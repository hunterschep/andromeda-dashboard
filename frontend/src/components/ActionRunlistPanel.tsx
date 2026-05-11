import { Copy, ListChecks } from "lucide-react";
import { buildActionRunlist } from "../lib/actionRunlist";
import type { CacheMeta, GpuPool, QueueJob, QueuePredictionResponse, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function ActionRunlistPanel({
  jobs,
  myJobs,
  gpuPools,
  storage,
  cache,
  prediction,
  alias,
  onCopy
}: {
  jobs: QueueJob[];
  myJobs: QueueJob[];
  gpuPools: GpuPool[];
  storage: StorageResponse | null;
  cache: CacheMeta[];
  prediction: QueuePredictionResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const runlist = buildActionRunlist({ jobs, myJobs, gpuPools, storage, cache, prediction, alias });
  return (
    <article className="action-runlist-panel">
      <div className="action-runlist-head">
        <SectionTitle icon={<ListChecks size={18} />} title="Action Runlist" />
        <span>{runlist.label}</span>
      </div>
      <p>{runlist.headline}</p>
      <div className="action-runlist-grid">
        {runlist.items.map((item, index) => (
          <section className={`action-runlist-item tone-${item.tone}`} key={item.id}>
            <div className="action-runlist-title">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.title}</strong>
            </div>
            <p>{item.detail}</p>
            <button type="button" onClick={() => onCopy(item.command, `${item.title} command`)}>
              <Copy size={14} aria-hidden="true" />
              <span>Copy command</span>
            </button>
          </section>
        ))}
      </div>
    </article>
  );
}
