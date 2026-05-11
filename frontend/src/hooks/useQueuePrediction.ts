import { useEffect, useState } from "react";
import { api } from "../api";
import type { QueuePredictionResponse } from "../types";
import { emptyResource, errorMessage, type AsyncResource } from "./useAsyncResource";

export function useQueuePrediction(scope: "mine" | "lab" | "cluster", loadedAt: string | null) {
  const [prediction, setPrediction] = useState<AsyncResource<QueuePredictionResponse>>(emptyResource);

  useEffect(() => {
    if (!loadedAt) return;
    let cancelled = false;
    setPrediction((current) => ({ ...current, loading: true, error: null }));
    api
      .prediction(scope, 24)
      .then((response) => {
        if (!cancelled) setPrediction({ data: response, loading: false, error: null, loadedAt: new Date().toISOString() });
      })
      .catch((error) => {
        if (!cancelled) setPrediction({ data: null, loading: false, error: errorMessage(error, "Prediction unavailable"), loadedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [scope, loadedAt]);

  return prediction;
}
