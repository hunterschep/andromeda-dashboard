import { shortTime } from "../api";
import type { CacheMeta } from "../types";

export type FreshnessTone = "live" | "degraded" | "stale";

export type FreshnessSource = {
  key: string;
  status: string;
  detail: string;
  tone: FreshnessTone;
};

export type DataFreshness = {
  tone: FreshnessTone;
  label: string;
  headline: string;
  command: string;
  sources: FreshnessSource[];
};

export function buildDataFreshness({
  cache,
  loadedAt,
  loading,
  error,
  alias
}: {
  cache: CacheMeta[];
  loadedAt: string | null;
  loading: boolean;
  error: string | null;
  alias: string;
}): DataFreshness {
  const stale = cache.filter((meta) => meta.is_stale);
  const errored = cache.filter((meta) => meta.errors.length);
  const tone = error || stale.length ? "degraded" : loading ? "stale" : "live";
  return {
    tone,
    label: labelFor(tone, stale.length, cache.length),
    headline: headlineFor({ tone, stale, errored, loadedAt, error }),
    command: freshnessCommand(alias),
    sources: sourcesFor(cache)
  };
}

function labelFor(tone: FreshnessTone, stale: number, total: number): string {
  if (tone === "live") return `${total} live source${total === 1 ? "" : "s"}`;
  if (tone === "stale") return "loading sources";
  return `${stale} stale / ${total} sources`;
}

function headlineFor({
  tone,
  stale,
  errored,
  loadedAt,
  error
}: {
  tone: FreshnessTone;
  stale: CacheMeta[];
  errored: CacheMeta[];
  loadedAt: string | null;
  error: string | null;
}): string {
  if (error) return `Dashboard load is degraded: ${error}`;
  if (stale.length) return `${stale.map((meta) => meta.key).join(", ")} cache is stale; treat affected panels as last-known Slurm state.`;
  if (errored.length) return `${errored.length} source(s) returned warnings, but current data is still within TTL.`;
  if (!loadedAt) return "Waiting for the first successful Andromeda snapshot.";
  if (tone === "stale") return "Snapshot is still loading; source freshness will resolve after the current probe.";
  return `All visible sources are within TTL as of ${shortTime(loadedAt)}.`;
}

function sourcesFor(cache: CacheMeta[]): FreshnessSource[] {
  if (!cache.length) return [{ key: "snapshot", status: "waiting", detail: "No source metadata has been returned yet.", tone: "stale" }];
  return cache.slice(0, 6).map((meta) => {
    const tone = meta.is_stale || meta.errors.length ? "degraded" : "live";
    return {
      key: meta.key,
      status: meta.is_stale ? "stale" : "fresh",
      detail: sourceDetail(meta),
      tone
    };
  });
}

function sourceDetail(meta: CacheMeta): string {
  const captured = meta.captured_at ? shortTime(meta.captured_at) : "unknown capture";
  const errors = meta.errors.length ? `; ${meta.errors.join("; ")}` : "";
  return `${meta.key} cache is ${meta.is_stale ? "stale" : "fresh"} (${captured}, ttl ${meta.ttl_seconds}s)${errors}`;
}

function freshnessCommand(alias: string): string {
  return `ssh ${alias} 'hostname; date; squeue -u "$USER" -o "%i|%j|%P|%t|%M|%R"; sinfo -o "%P|%a|%l|%D|%C|%G"; sdiag 2>/dev/null | sed -n "1,40p"'`;
}
