import { Clipboard, Copy, Database, Gauge, HardDrive } from "lucide-react";
import { formatNumber, shortTime } from "../api";
import { secondsText, tresText, type ToolCommand } from "../lib/dashboard";
import type { AccountLimits, CacheMeta, Insight, SchedulerHealth, StorageResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function InsightsList({ insights }: { insights: Insight[] }) {
  if (!insights.length) return <EmptyState text="No insights available yet." />;
  return (
    <div className="insight-list">
      {insights.map((insight) => (
        <article className={`insight ${insight.severity}`} key={insight.id}>
          <div>
            <strong>{insight.title}</strong>
            <span>{insight.confidence} confidence</span>
          </div>
          <p>{insight.message}</p>
          {insight.details.length ? (
            <div className="detail-line">{insight.details.join(" | ")}</div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function SchedulerPanel({ scheduler }: { scheduler: SchedulerHealth | null }) {
  if (!scheduler) return <EmptyState text="Scheduler health is not available." />;
  return (
    <div className="tool-panel">
      <SectionTitle icon={<Gauge size={18} />} title="Scheduler" />
      <dl className="compact-dl">
        <div>
          <dt>Last cycle</dt>
          <dd>{secondsText(scheduler.last_cycle_seconds)}</dd>
        </div>
        <div>
          <dt>Mean cycle</dt>
          <dd>{secondsText(scheduler.mean_cycle_seconds)}</dd>
        </div>
        <div>
          <dt>Backfill depth</dt>
          <dd>{scheduler.backfill_last_depth ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Backfill cycle</dt>
          <dd>{secondsText(scheduler.backfill_last_cycle_seconds)}</dd>
        </div>
      </dl>
      <KeyValueList values={scheduler.priority_weights} empty="No priority weights found." />
    </div>
  );
}

export function AccountLimitsPanel({ accountLimits }: { accountLimits: AccountLimits | null }) {
  if (!accountLimits) return <EmptyState text="Account and QOS limits are not available." />;
  return (
    <div className="tool-panel">
      <SectionTitle icon={<Clipboard size={18} />} title="Account Limits" />
      <div className="account-line">
        <span>{accountLimits.user ?? "unknown user"}</span>
        <span>{accountLimits.account ?? "unknown account"}</span>
      </div>
      {accountLimits.qos.length ? (
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>QOS</th>
                <th>Jobs</th>
                <th>Submit</th>
                <th>TRES</th>
              </tr>
            </thead>
            <tbody>
              {accountLimits.qos.map((qos) => (
                <tr key={qos.name}>
                  <td className="mono">{qos.name}</td>
                  <td>{qos.max_jobs_per_user ?? "n/a"}</td>
                  <td>{qos.max_submit_per_user ?? "n/a"}</td>
                  <td>{tresText(qos.max_tres_per_user)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState text="No QOS limit rows returned." />
      )}
    </div>
  );
}

export function StoragePanel({
  storage,
  alias,
  onCopy
}: {
  storage: StorageResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="tool-panel storage-panel">
      <div className="storage-head">
        <SectionTitle icon={<HardDrive size={18} />} title="Storage Pressure" />
        <button
          type="button"
          className="copy-button"
          onClick={() => onCopy(`ssh ${alias} 'acct-chk "$USER"'`, "storage")}
          title="Copy storage quota command"
        >
          <Copy size={15} aria-hidden="true" />
        </button>
      </div>
      {storage?.volumes.length ? (
        <div className="storage-list">
          {storage.volumes.map((volume) => (
            <article className={`storage-row severity-${volume.severity}`} key={volume.path ?? volume.name}>
              <div>
                <strong>{volume.name}</strong>
                <span className="mono">{volume.path ?? "n/a"}</span>
              </div>
              <div className="storage-meter" aria-label={`${volume.name} storage use`}>
                <i style={{ width: `${Math.min(volume.percent_used ?? 0, 100)}%` }} />
              </div>
              <dl>
                <div>
                  <dt>space</dt>
                  <dd>{gb(volume.used_gb)} / {gb(volume.quota_gb)}</dd>
                </div>
                <div>
                  <dt>used</dt>
                  <dd>{volume.percent_used ?? "n/a"}%</dd>
                </div>
                <div>
                  <dt>files</dt>
                  <dd>{formatNumber(volume.files_used)} / {formatNumber(volume.files_quota)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="Storage quota output has not been parsed yet." />
      )}
    </div>
  );
}

export function CommandList({
  commands,
  onCopy
}: {
  commands: ToolCommand[];
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="command-list">
      {commands.map((command) => (
        <article className="command-row" key={command.id}>
          <div>
            <strong>{command.label}</strong>
            <span>{command.description}</span>
            <code>{command.command}</code>
          </div>
          <button
            type="button"
            className="copy-button"
            onClick={() => onCopy(command.command, command.label)}
            title={`Copy ${command.label}`}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </article>
      ))}
    </div>
  );
}

export function CacheTable({ cache }: { cache: CacheMeta[] }) {
  if (!cache.length) return <EmptyState text="No cache entries have been loaded." />;
  return (
    <div className="cache-block">
      <SectionTitle icon={<Database size={18} />} title="Cache Diagnostics" />
      <div className="table-wrap">
        <table className="compact-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Captured</th>
              <th>TTL</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {cache.map((meta) => (
              <tr key={meta.key}>
                <td className="mono">{meta.key}</td>
                <td>{shortTime(meta.captured_at)}</td>
                <td>{meta.ttl_seconds}s</td>
                <td>{meta.is_stale ? "stale" : "fresh"}</td>
                <td>{meta.errors.join("; ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function gb(value: number | null): string {
  if (value === null) return "n/a";
  if (value >= 1024) return `${(value / 1024).toFixed(1)} TB`;
  return `${value.toFixed(1)} GB`;
}

function KeyValueList({ values, empty }: { values: Record<string, number>; empty: string }) {
  const entries = Object.entries(values);
  if (!entries.length) return <div className="muted-line">{empty}</div>;
  return (
    <div className="kv-list">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{key}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
