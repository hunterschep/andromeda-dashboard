import { RadioTower } from "lucide-react";
import { buildRefreshHealth } from "../lib/refreshHealth";
import type { AsyncResource } from "../hooks/useAsyncResource";
import type { CacheMeta, QueuePredictionResponse, StorageResponse, TelemetryResponse } from "../types";
import { SectionTitle } from "./common";

export function RefreshHealthPanel({
  loadedAt,
  loading,
  error,
  cache,
  cadence,
  telemetry,
  prediction,
  storage
}: {
  loadedAt: string | null;
  loading: boolean;
  error: string | null;
  cache: CacheMeta[];
  cadence: "off" | "30" | "60";
  telemetry: AsyncResource<TelemetryResponse>;
  prediction: AsyncResource<QueuePredictionResponse>;
  storage: AsyncResource<StorageResponse>;
}) {
  const health = buildRefreshHealth({
    snapshot: { loadedAt, loading, error, cache, cadence },
    telemetry,
    prediction,
    storage
  });
  return (
    <article className={`refresh-health refresh-health-${health.status}`}>
      <div className="refresh-health-head">
        <SectionTitle icon={<RadioTower size={18} />} title="Refresh Health" />
        <span>{health.label}</span>
      </div>
      <p>{health.headline}</p>
      <div className="refresh-health-grid">
        {health.feeds.map((feed) => (
          <div className={`refresh-feed status-${feed.status}`} key={feed.id}>
            <span>{feed.label}</span>
            <strong>{feed.value}</strong>
            <em>{feed.detail}</em>
          </div>
        ))}
      </div>
    </article>
  );
}
