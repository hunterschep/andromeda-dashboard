import { Copy, DatabaseZap } from "lucide-react";
import { buildDataFreshness } from "../lib/dataFreshness";
import type { CacheMeta } from "../types";
import { SectionTitle } from "./common";

export function DataFreshnessPanel({
  cache,
  loadedAt,
  loading,
  error,
  alias,
  onCopy
}: {
  cache: CacheMeta[];
  loadedAt: string | null;
  loading: boolean;
  error: string | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const freshness = buildDataFreshness({ cache, loadedAt, loading, error, alias });
  return (
    <article className={`data-freshness-panel tone-${freshness.tone}`}>
      <div className="data-freshness-head">
        <SectionTitle icon={<DatabaseZap size={18} />} title="Data Freshness Sentinel" />
        <div>
          <span>{freshness.label}</span>
          <button
            type="button"
            className="copy-button"
            onClick={() => onCopy(freshness.command, "freshness probe")}
            title="Copy freshness probe"
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{freshness.headline}</p>
      <div className="freshness-source-list">
        {freshness.sources.map((source) => (
          <div className={`freshness-source tone-${source.tone}`} key={source.key}>
            <span>{source.key}</span>
            <strong>{source.status}</strong>
            <p>{source.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
