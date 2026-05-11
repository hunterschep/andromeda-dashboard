import { useEffect, useState } from "react";
import { api } from "../api";
import type { TelemetryResponse } from "../types";
import { emptyResource, errorMessage, type AsyncResource } from "./useAsyncResource";

export function useTelemetry(scope: "mine" | "lab" | "cluster", loadedAt: string | null) {
  const [telemetry, setTelemetry] = useState<AsyncResource<TelemetryResponse>>(emptyResource);

  useEffect(() => {
    if (!loadedAt) return;
    let cancelled = false;
    setTelemetry((current) => ({ ...current, loading: true, error: null }));
    api
      .telemetry(scope, 168)
      .then((response) => {
        if (!cancelled) setTelemetry({ data: response, loading: false, error: null, loadedAt: new Date().toISOString() });
      })
      .catch((error) => {
        if (!cancelled) setTelemetry({ data: null, loading: false, error: errorMessage(error, "Telemetry unavailable"), loadedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [scope, loadedAt]);

  return telemetry;
}
