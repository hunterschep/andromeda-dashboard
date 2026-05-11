import { Copy, SlidersHorizontal } from "lucide-react";
import { buildRightSizeAdvice } from "../lib/rightSize";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function RightSizeAdvisor({
  history,
  onCopy
}: {
  history: HistoryResponse | null;
  onCopy: (text: string, label: string) => void;
}) {
  const advice = buildRightSizeAdvice(history?.jobs ?? []);
  if (!history?.jobs.length) return <EmptyState text="No accounting data available for right-size advice." />;
  return (
    <div className="right-size-panel">
      <div className="right-size-head">
        <SectionTitle icon={<SlidersHorizontal size={18} />} title="Right-size Advisor" />
        <span>{advice.confidence} confidence</span>
      </div>
      <p>{advice.headline}</p>
      <div className="right-size-signals">
        {advice.signals.map((signal) => (
          <article key={signal.label} className={`severity-${signal.severity}`}>
            <div>
              <strong>{signal.label}</strong>
              <span>{signal.value}</span>
            </div>
            <p>{signal.detail}</p>
          </article>
        ))}
      </div>
      <button
        type="button"
        className="right-size-copy"
        onClick={() => onCopy(advice.sbatch, "right-size request")}
        title="Copy right-sized sbatch lines"
      >
        <Copy size={14} aria-hidden="true" />
        <span>Copy sbatch deltas</span>
      </button>
    </div>
  );
}
