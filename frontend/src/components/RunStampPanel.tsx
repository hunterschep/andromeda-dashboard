import { ClipboardCheck, Copy } from "lucide-react";
import { buildRunStamp } from "../lib/runStamp";
import type { GpuPool, HistoryResponse, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function RunStampPanel({
  history,
  storage,
  gpuPools,
  onCopy
}: {
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  gpuPools: GpuPool[];
  onCopy: (text: string, label: string) => void;
}) {
  const stamp = buildRunStamp({ history, storage, gpuPools });
  return (
    <section className={`run-stamp run-stamp-${stamp.status}`} aria-label="Run stamp injector">
      <div className="run-stamp-head">
        <SectionTitle icon={<ClipboardCheck size={18} />} title="Run Stamp Injector" />
        <div>
          <span>{stamp.label}</span>
          <button
            type="button"
            className="runbook-command"
            title="Copy run stamp"
            onClick={() => onCopy(stamp.snippet, "run stamp")}
          >
            <Copy size={14} aria-hidden="true" />
            Copy run stamp
          </button>
        </div>
      </div>
      <p>{stamp.headline}</p>
      <div className="run-stamp-grid">
        {stamp.checks.map((check) => (
          <article className={`run-stamp-check status-${check.status}`} key={check.id}>
            <div>
              <strong>{check.label}</strong>
              <span>{check.value}</span>
            </div>
            <p>{check.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
