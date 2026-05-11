import { ClipboardCopy, ScrollText } from "lucide-react";
import { buildOpsBrief } from "../lib/opsBrief";
import type { CacheMeta, GpuPool, HistoryResponse, NodeResource, QueueJob } from "../types";
import { SectionTitle } from "./common";

export function OpsBriefPanel({
  jobs,
  gpuPools,
  nodes,
  history,
  cache,
  onCopy
}: {
  jobs: QueueJob[];
  gpuPools: GpuPool[];
  nodes: NodeResource[];
  history: HistoryResponse | null;
  cache: CacheMeta[];
  onCopy: (text: string, label: string) => void;
}) {
  const brief = buildOpsBrief({ jobs, gpuPools, nodes, history, cache });
  return (
    <article className={`ops-brief-panel tone-${brief.tone}`}>
      <div className="ops-brief-head">
        <SectionTitle icon={<ScrollText size={18} />} title="Ops Brief" />
        <div>
          <span>{brief.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(brief.copy, "ops brief")}>
            <ClipboardCopy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{brief.headline}</p>
      <div className="ops-brief-lines">
        {brief.lines.map((line) => (
          <div key={line.label}>
            <span>{line.label}</span>
            <strong>{line.value}</strong>
            <p>{line.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
