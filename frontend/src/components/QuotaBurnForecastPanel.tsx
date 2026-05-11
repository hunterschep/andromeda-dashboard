import { Copy, Flame } from "lucide-react";
import { buildQuotaBurnForecast } from "../lib/quotaBurn";
import type { HistoryResponse, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function QuotaBurnForecastPanel({
  storage,
  history,
  alias,
  onCopy
}: {
  storage: StorageResponse | null;
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const forecast = buildQuotaBurnForecast({ storage, history, alias });
  return (
    <section className={`quota-burn quota-burn-${forecast.tone}`} aria-label="Quota burn forecast">
      <div className="quota-burn-head">
        <SectionTitle icon={<Flame size={18} />} title="Quota Burn Forecast" />
        <div>
          <span>{forecast.label}</span>
          <button
            type="button"
            className="copy-button"
            title="Copy quota burn probe"
            aria-label="Copy quota burn probe"
            onClick={() => onCopy(forecast.command, "quota burn")}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{forecast.headline}</p>
      <div className="quota-burn-grid">
        {forecast.signals.map((signal) => (
          <article className={`quota-burn-signal tone-${signal.tone}`} key={signal.id}>
            <div>
              <strong>{signal.label}</strong>
              <span>{signal.value}</span>
            </div>
            <p>{signal.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
