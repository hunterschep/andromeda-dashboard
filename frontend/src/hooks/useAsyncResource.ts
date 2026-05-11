export type AsyncResource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  loadedAt: string | null;
};

export function emptyResource<T>(): AsyncResource<T> {
  return {
    data: null,
    loading: false,
    error: null,
    loadedAt: null
  };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
