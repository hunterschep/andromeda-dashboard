import type {
  ConfigStatus,
  HistoryResponse,
  InsightsResponse,
  QueueResponse,
  ResourceResponse
} from "./types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  config: () => getJson<ConfigStatus>("/api/config/status"),
  resources: () => getJson<ResourceResponse>("/api/resources"),
  queue: (scope: "mine" | "lab" | "cluster") => getJson<QueueResponse>(`/api/queue?scope=${scope}`),
  myJobs: () => getJson<QueueResponse>("/api/jobs/mine"),
  history: (days: 7 | 30) => getJson<HistoryResponse>(`/api/history?days=${days}`),
  insights: () => getJson<InsightsResponse>("/api/insights")
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
