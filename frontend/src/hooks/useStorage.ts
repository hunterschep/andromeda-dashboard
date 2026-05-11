import { useEffect, useState } from "react";
import { api } from "../api";
import type { StorageResponse } from "../types";
import { emptyResource, errorMessage, type AsyncResource } from "./useAsyncResource";

export function useStorage(loadedAt: string | null) {
  const [storage, setStorage] = useState<AsyncResource<StorageResponse>>(emptyResource);

  useEffect(() => {
    if (!loadedAt) return;
    let cancelled = false;
    setStorage((current) => ({ ...current, loading: true, error: null }));
    api
      .storage()
      .then((response) => {
        if (!cancelled) setStorage({ data: response, loading: false, error: null, loadedAt: new Date().toISOString() });
      })
      .catch((error) => {
        if (!cancelled) setStorage({ data: null, loading: false, error: errorMessage(error, "Storage unavailable"), loadedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [loadedAt]);

  return storage;
}
