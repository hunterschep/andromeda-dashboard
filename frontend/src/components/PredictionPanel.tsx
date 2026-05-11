import { TrendingUp } from "lucide-react";
import { formatDuration } from "../api";
import type { QueuePredictionResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function PredictionPanel({ prediction }: { prediction: QueuePredictionResponse | null }) {
  const evidence = prediction ? evidenceFor(prediction) : [];
  return (
    <article className="prediction-panel">
      <div className="prediction-head">
        <SectionTitle icon={<TrendingUp size={18} />} title="Queue Prediction" />
        <span>{prediction?.confidence ?? "low"} confidence</span>
      </div>
      {prediction ? (
        <>
          <dl className="prediction-summary">
            <div>
              <dt>trend</dt>
              <dd>{prediction.trend}</dd>
            </div>
            <div>
              <dt>wait</dt>
              <dd>{prediction.wait_band}</dd>
            </div>
            <div>
              <dt>range</dt>
              <dd>{rangeText(prediction.wait_range_minutes)}</dd>
            </div>
            <div>
              <dt>clearance</dt>
              <dd>{formatDuration(minutesToSeconds(prediction.estimated_clear_minutes))}</dd>
            </div>
            <div>
              <dt>pending/hr</dt>
              <dd>{prediction.pending_trend_per_hour}</dd>
            </div>
          </dl>
          <p>{prediction.recommendation}</p>
          {evidence.length ? (
            <div className="prediction-evidence">
              {evidence.map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState text="Queue prediction loads after telemetry is available." />
      )}
    </article>
  );
}

function minutesToSeconds(minutes: number | null): number | null {
  return minutes === null ? null : minutes * 60;
}

function rangeText(range: QueuePredictionResponse["wait_range_minutes"]): string {
  if (!range) return "unknown";
  if (range.lower === null && range.upper === null) return "unknown";
  if (range.upper === null) return `${range.lower ?? 0}m+`;
  return `${range.lower ?? 0}-${range.upper}m`;
}

function evidenceFor(prediction: QueuePredictionResponse): string[] {
  if (prediction.confidence_reasons?.length) return prediction.confidence_reasons;
  return [
    `${prediction.confidence} confidence from current prediction payload`,
    `pending trend is ${prediction.pending_trend_per_hour} jobs/hour`
  ];
}
