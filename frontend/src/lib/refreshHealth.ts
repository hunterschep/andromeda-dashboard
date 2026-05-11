import { shortTime } from "../api";
import type { AsyncResource } from "../hooks/useAsyncResource";
import type { CacheMeta, QueuePredictionResponse, StorageResponse, TelemetryResponse } from "../types";

export type RefreshFeedStatus = "live" | "loading" | "waiting" | "degraded";

export type RefreshFeed = {
  id: string;
  label: string;
  status: RefreshFeedStatus;
  value: string;
  detail: string;
};

export type RefreshHealth = {
  status: RefreshFeedStatus;
  label: string;
  headline: string;
  feeds: RefreshFeed[];
};

type SnapshotInput = {
  loadedAt: string | null;
  loading: boolean;
  error: string | null;
  cache: CacheMeta[];
  cadence: "off" | "30" | "60";
};

export function buildRefreshHealth({
  snapshot,
  telemetry,
  prediction,
  storage
}: {
  snapshot: SnapshotInput;
  telemetry: AsyncResource<TelemetryResponse>;
  prediction: AsyncResource<QueuePredictionResponse>;
  storage: AsyncResource<StorageResponse>;
}): RefreshHealth {
  const feeds = [
    snapshotFeed(snapshot),
    telemetryFeed(telemetry),
    predictionFeed(prediction),
    storageFeed(storage)
  ];
  const status = overall(feeds);
  return {
    status,
    label: labelFor(feeds, snapshot.cadence),
    headline: headlineFor(feeds, snapshot.cadence),
    feeds
  };
}

function snapshotFeed(input: SnapshotInput): RefreshFeed {
  const stale = input.cache.filter((meta) => meta.is_stale).length;
  if (input.error) return feed("snapshot", "Snapshot", "degraded", "error", input.error);
  if (input.loading) return feed("snapshot", "Snapshot", "loading", "loading", "Main snapshot refresh is in flight.");
  if (!input.loadedAt) return feed("snapshot", "Snapshot", "waiting", "waiting", "No successful snapshot has landed yet.");
  const status: RefreshFeedStatus = stale ? "degraded" : "live";
  return feed("snapshot", "Snapshot", status, shortTime(input.loadedAt), stale ? `${stale} cache source(s) are stale.` : "Main Slurm snapshot is current.");
}

function telemetryFeed(resource: AsyncResource<TelemetryResponse>): RefreshFeed {
  if (resource.error) return feed("telemetry", "Telemetry", "degraded", "error", resource.error);
  if (resource.loading) return feed("telemetry", "Telemetry", "loading", "loading", "Historical pressure samples are refreshing.");
  if (!resource.data) return feed("telemetry", "Telemetry", "waiting", "waiting", "No telemetry samples have loaded for this snapshot.");
  return feed("telemetry", "Telemetry", "live", `${resource.data.summary.count} samples`, `Latest pressure ${resource.data.summary.latest_pressure}%.`);
}

function predictionFeed(resource: AsyncResource<QueuePredictionResponse>): RefreshFeed {
  if (resource.error) return feed("prediction", "Prediction", "degraded", "error", resource.error);
  if (resource.loading) return feed("prediction", "Prediction", "loading", "loading", "Queue forecast is refreshing.");
  if (!resource.data) return feed("prediction", "Prediction", "waiting", "waiting", "Queue prediction has not loaded yet.");
  return feed("prediction", "Prediction", "live", resource.data.confidence, `${resource.data.wait_band}; ${resource.data.pending_trend_per_hour} pending/hour.`);
}

function storageFeed(resource: AsyncResource<StorageResponse>): RefreshFeed {
  if (resource.error) return feed("storage", "Storage", "degraded", "error", resource.error);
  if (resource.loading) return feed("storage", "Storage", "loading", "loading", "Quota parser is refreshing.");
  if (!resource.data) return feed("storage", "Storage", "waiting", "waiting", "Storage quota data has not loaded yet.");
  const critical = resource.data.volumes.filter((volume) => volume.severity === "critical").length;
  const status: RefreshFeedStatus = critical ? "degraded" : "live";
  return feed("storage", "Storage", status, `${resource.data.volumes.length} volume${resource.data.volumes.length === 1 ? "" : "s"}`, critical ? `${critical} critical quota signal(s).` : "Quota parser returned usable volume data.");
}

function feed(id: string, label: string, status: RefreshFeedStatus, value: string, detail: string): RefreshFeed {
  return { id, label, status, value, detail };
}

function overall(feeds: RefreshFeed[]): RefreshFeedStatus {
  if (feeds.some((feed) => feed.status === "degraded")) return "degraded";
  if (feeds.some((feed) => feed.status === "loading")) return "loading";
  if (feeds.some((feed) => feed.status === "waiting")) return "waiting";
  return "live";
}

function labelFor(feeds: RefreshFeed[], cadence: "off" | "30" | "60"): string {
  const live = feeds.filter((feed) => feed.status === "live").length;
  const degraded = feeds.filter((feed) => feed.status === "degraded").length;
  const suffix = cadence === "off" ? "manual" : `${cadence}s`;
  return `${live}/${feeds.length} live / ${degraded} degraded / ${suffix}`;
}

function headlineFor(feeds: RefreshFeed[], cadence: "off" | "30" | "60"): string {
  const degraded = feeds.filter((feed) => feed.status === "degraded");
  if (degraded.length) return `${degraded.map((feed) => feed.label).join(", ")} feed${degraded.length === 1 ? " is" : "s are"} degraded; related panels are last-known or partial.`;
  if (feeds.some((feed) => feed.status === "loading")) return "Refresh is in flight; downstream panels will settle as feeds return.";
  if (feeds.some((feed) => feed.status === "waiting")) return "Some auxiliary feeds are still waiting for the first successful refresh.";
  return cadence === "off" ? "All dashboard feeds are live; auto refresh is manual." : `All dashboard feeds are live on a ${cadence}s refresh cadence.`;
}
