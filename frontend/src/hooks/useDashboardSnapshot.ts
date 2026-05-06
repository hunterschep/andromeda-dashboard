import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type {
  CacheMeta,
  ConfigStatus,
  HistoryResponse,
  InsightsResponse,
  QueueResponse,
  ResourceResponse
} from "../types";

export type LoadState = {
  config: ConfigStatus | null;
  resources: ResourceResponse | null;
  queue: QueueResponse | null;
  myJobs: QueueResponse | null;
  history: HistoryResponse | null;
  insightsData: InsightsResponse | null;
  cache: CacheMeta[];
  loadedAt: string | null;
  loading: boolean;
  error: string | null;
};

const emptyState: LoadState = {
  config: null,
  resources: null,
  queue: null,
  myJobs: null,
  history: null,
  insightsData: null,
  cache: [],
  loadedAt: null,
  loading: true,
  error: null
};

export function useDashboardSnapshot(scope: "mine" | "lab" | "cluster") {
  const [state, setState] = useState<LoadState>(emptyState);

  const load = useCallback(
    async (selectedScope = scope, silent = false) => {
      if (!silent) {
        setState((current) => ({ ...current, loading: true, error: null }));
      }
      try {
        const snapshot = await api.snapshot(selectedScope, 7);
        setState({
          config: snapshot.config,
          resources: snapshot.resources,
          queue: snapshot.queue,
          myJobs: snapshot.my_jobs,
          history: snapshot.history,
          insightsData: snapshot.insights,
          cache: snapshot.cache,
          loadedAt: new Date().toISOString(),
          loading: false,
          error: null
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load dashboard data"
        }));
      }
    },
    [scope]
  );

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  return { state, load };
}
