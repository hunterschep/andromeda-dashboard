import { Download, RefreshCw, Server, Settings } from "lucide-react";
import type { ConfigStatus } from "../types";

export function Sidebar({ alias, config }: { alias: string; config: ConfigStatus | null }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Server size={20} aria-hidden="true" />
        <span>Andromeda</span>
      </div>
      <nav aria-label="Dashboard sections">
        <a href="#overview">Overview</a>
        <a href="#nodes">Nodes</a>
        <a href="#gpus">GPU Pools</a>
        <a href="#partitions">Partitions</a>
        <a href="#queue">Queue</a>
        <a href="#jobs">My Jobs</a>
        <a href="#tools">Diagnostics</a>
      </nav>
      <div className="config-box">
        <Settings size={16} aria-hidden="true" />
        <div>
          <strong>{alias}</strong>
          <span>{config?.config_exists ? "config loaded" : "default config"}</span>
        </div>
      </div>
    </aside>
  );
}

export function Topbar({
  alias,
  user,
  scope,
  onExport,
  onRefresh
}: {
  alias: string;
  user: string;
  scope: string;
  onExport: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="topbar">
      <div>
        <h1>Andromeda Compute</h1>
        <p>
          {alias} / {user} / {scope}
        </p>
      </div>
      <div className="toolbar">
        <button type="button" className="icon-button" onClick={onExport}>
          <Download size={18} aria-hidden="true" />
          <span>Export JSON</span>
        </button>
        <button type="button" className="icon-button" onClick={onRefresh} title="Refresh data">
          <RefreshCw size={18} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>
    </header>
  );
}
