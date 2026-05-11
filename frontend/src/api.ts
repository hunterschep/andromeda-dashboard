import type {
  ConfigStatus,
  DashboardSnapshot,
  HistoryResponse,
  InsightsResponse,
  QueuePredictionResponse,
  QueueResponse,
  ResourceResponse,
  StorageResponse,
  TelemetryResponse
} from "./types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (looksLikeMissingBackend(response.status, body)) {
      throw new Error(
        `Backend API is not reachable. Start it with ".venv/bin/andromeda-dashboard serve" from the repo root, then refresh.`
      );
    }
    throw new Error(`${path} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

function looksLikeMissingBackend(status: number, body: string): boolean {
  const text = body.toLowerCase();
  return status === 500 && (text.includes("proxy") || text.includes("econnrefused") || text.includes("127.0.0.1:8765"));
}

export const api = {
  config: () => getJson<ConfigStatus>("/api/config/status"),
  resources: () => getJson<ResourceResponse>("/api/resources"),
  queue: (scope: "mine" | "lab" | "cluster") => getJson<QueueResponse>(`/api/queue?scope=${scope}`),
  myJobs: () => getJson<QueueResponse>("/api/jobs/mine"),
  history: (days: 7 | 30) => getJson<HistoryResponse>(`/api/history?days=${days}`),
  insights: () => getJson<InsightsResponse>("/api/insights"),
  telemetry: (scope: "mine" | "lab" | "cluster", hours = 24) =>
    getJson<TelemetryResponse>(`/api/telemetry?scope=${scope}&hours=${hours}`),
  prediction: (scope: "mine" | "lab" | "cluster", hours = 24) =>
    getJson<QueuePredictionResponse>(`/api/prediction?scope=${scope}&hours=${hours}`),
  storage: () => getJson<StorageResponse>("/api/storage"),
  snapshot: (scope: "mine" | "lab" | "cluster", days: 7 | 30) =>
    getJson<DashboardSnapshot>(`/api/snapshot?scope=${scope}&days=${days}`)
};

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "n/a";
  return new Intl.NumberFormat().format(value);
}

export function formatMemory(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return "n/a";
  if (mb >= 1024 * 1024) return `${(mb / 1024 / 1024).toFixed(1)} TB`;
  return `${Math.round(mb / 1024).toLocaleString()} GB`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "n/a";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function shortTime(value: string | null | undefined): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
