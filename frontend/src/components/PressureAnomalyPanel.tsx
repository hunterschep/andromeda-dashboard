import { Siren } from "lucide-react";
import { buildPressureAnomalies } from "../lib/pressureAnomalies";
import type { TelemetryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PressureAnomalyPanel({ telemetry }: { telemetry: TelemetryResponse | null }) {
  const summary = buildPressureAnomalies(telemetry?.samples ?? []);
  return (
    <article className="pressure-anomaly-panel">
      <div className="pressure-anomaly-head">
        <SectionTitle icon={<Siren size={18} />} title="Pressure Anomalies" />
        <span>{summary.label}</span>
      </div>
      {summary.anomalies.length ? (
        <div className="pressure-anomaly-list">
          {summary.anomalies.slice(0, 4).map((anomaly) => (
            <article key={anomaly.title} className={`pressure-anomaly-row tone-${anomaly.tone}`}>
              <div>
                <strong>{anomaly.title}</strong>
                <span>{anomaly.time}</span>
              </div>
              <dl>
                <div>
                  <dt>signal</dt>
                  <dd>{anomaly.signal}</dd>
                </div>
              </dl>
              <p>{anomaly.message}</p>
              <em>{anomaly.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No telemetry anomalies are visible in this sample window." />
      )}
    </article>
  );
}
