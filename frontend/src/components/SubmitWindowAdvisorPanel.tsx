import { Copy, TimerReset } from "lucide-react";
import { buildSubmitWindowAdvisor } from "../lib/submitWindowAdvisor";
import type { GpuPool, HistoryResponse, QueueJob, TelemetryResponse } from "../types";
import { SectionTitle } from "./common";

export function SubmitWindowAdvisorPanel({
  telemetry,
  jobs,
  history,
  gpuPools,
  alias,
  onCopy
}: {
  telemetry: TelemetryResponse | null;
  jobs: QueueJob[];
  history: HistoryResponse | null;
  gpuPools: GpuPool[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const advisor = buildSubmitWindowAdvisor({ telemetry, jobs, history, gpuPools, alias });
  return (
    <article className={`submit-window-panel tone-${advisor.tone}`}>
      <div className="submit-window-head">
        <SectionTitle icon={<TimerReset size={18} />} title="Submit Window Advisor" />
        <div>
          <span>{advisor.label}</span>
          <button
            type="button"
            className="copy-button"
            onClick={() => onCopy(advisor.command, "queue timing")}
            title="Copy queue timing probe"
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{advisor.headline}</p>
      <div className="submit-window-grid">
        {advisor.rows.map((row) => (
          <div className={`submit-window-row tone-${row.tone}`} key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <p>{row.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
