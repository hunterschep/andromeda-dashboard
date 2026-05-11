import { Copy, TimerReset } from "lucide-react";
import { buildGpuTurnoverLadder } from "../lib/gpuTurnoverLadder";
import type { GpuPool, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuTurnoverLadder({
  pools,
  jobs,
  alias,
  onCopy
}: {
  pools: GpuPool[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const ladder = buildGpuTurnoverLadder(pools, jobs, alias);
  return (
    <section className="gpu-turnover-ladder" aria-label="GPU turnover ladder">
      <div className="gpu-turnover-head">
        <SectionTitle icon={<TimerReset size={18} />} title="GPU Turnover Ladder" />
        <div>
          <span>{ladder.label}</span>
          <button
            type="button"
            className="copy-button"
            aria-label="Copy GPU turnover probe"
            title="Copy GPU turnover probe"
            onClick={() => onCopy(ladder.command, "gpu turnover")}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {ladder.rows.length ? (
        <div className="gpu-turnover-list">
          {ladder.rows.slice(0, 5).map((row) => (
            <article className="gpu-turnover-row" key={row.type}>
              <div className="gpu-turnover-title">
                <div>
                  <strong className="mono">{row.type}</strong>
                  <span>{row.label}</span>
                </div>
                <p>{row.headline}</p>
              </div>
              <div className="gpu-turnover-steps">
                {row.steps.map((step) => (
                  <div className={`turnover-step tone-${step.tone}`} key={`${row.type}-${step.id}`}>
                    <strong>{step.value}</strong>
                    <span>{step.label}</span>
                    <em>{step.detail}</em>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="GPU turnover ladder needs visible GPU pools or GPU jobs." />
      )}
    </section>
  );
}
