import { Activity, Clock3, Database, Filter } from "lucide-react";
import type { ReactNode } from "react";
import { shortTime } from "../api";

export function Metric({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail ? <em>{detail}</em> : null}
      </div>
    </div>
  );
}

export function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

export function StatusLine({
  loadedAt,
  loading,
  staleCount,
  cacheCount,
  scope,
  refreshCadence,
  onRefreshCadence
}: {
  loadedAt: string | null;
  loading: boolean;
  staleCount: number;
  cacheCount: number;
  scope: "mine" | "lab" | "cluster";
  refreshCadence: "off" | "30" | "60";
  onRefreshCadence: (value: "off" | "30" | "60") => void;
}) {
  return (
    <div className="status-line" aria-label="Dashboard status">
      <div>
        <Activity size={16} aria-hidden="true" />
        <span>{loading ? "loading" : "ready"}</span>
      </div>
      <div>
        <Database size={16} aria-hidden="true" />
        <span>
          {cacheCount} cache {cacheCount === 1 ? "entry" : "entries"}
          {staleCount ? ` / ${staleCount} stale` : ""}
        </span>
      </div>
      <div>
        <Filter size={16} aria-hidden="true" />
        <span>{scope}</span>
      </div>
      <div>
        <Clock3 size={16} aria-hidden="true" />
        <span>{loadedAt ? shortTime(loadedAt) : "not loaded"}</span>
      </div>
      <RefreshControl cadence={refreshCadence} onCadence={onRefreshCadence} />
    </div>
  );
}

export function RefreshControl({
  cadence,
  onCadence
}: {
  cadence: "off" | "30" | "60";
  onCadence: (value: "off" | "30" | "60") => void;
}) {
  return (
    <div className="segmented compact-segmented" aria-label="Auto refresh">
      {(["off", "30", "60"] as const).map((item) => (
        <button
          type="button"
          key={item}
          className={cadence === item ? "active" : ""}
          onClick={() => onCadence(item)}
        >
          {item === "off" ? "manual" : `${item}s`}
        </button>
      ))}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ScopeControl({
  scope,
  onScope
}: {
  scope: "mine" | "lab" | "cluster";
  onScope: (scope: "mine" | "lab" | "cluster") => void;
}) {
  return (
    <div className="segmented" aria-label="Queue scope">
      {(["mine", "lab", "cluster"] as const).map((item) => (
        <button
          type="button"
          key={item}
          className={scope === item ? "active" : ""}
          onClick={() => onScope(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
