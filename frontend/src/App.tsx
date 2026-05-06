import {
  Activity,
  AlertTriangle,
  Clock3,
  Clipboard,
  Copy,
  Cpu,
  Database,
  Download,
  Filter,
  Gauge,
  HardDrive,
  ListFilter,
  Network,
  RefreshCw,
  Rows3,
  Search,
  Server,
  Settings,
  Terminal,
  User,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, formatDuration, formatMemory, formatNumber, shortTime } from "./api";
import type {
  AccountLimits,
  CacheMeta,
  ConfigStatus,
  GpuPool,
  HistoryResponse,
  Insight,
  InsightsResponse,
  NodeResource,
  PartitionSummary,
  QueueJob,
  QueueResponse,
  ResourceResponse,
  SchedulerHealth
} from "./types";

type LoadState = {
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

type ToolCommand = {
  id: string;
  group: string;
  label: string;
  command: string;
  description: string;
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

const NODE_PREVIEW_LIMIT = 80;

export function App() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [scope, setScope] = useState<"mine" | "lab" | "cluster">("mine");
  const [partitionFilter, setPartitionFilter] = useState("all");
  const [gpuFilter, setGpuFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [nodePartitionFilter, setNodePartitionFilter] = useState("all");
  const [nodeGpuFilter, setNodeGpuFilter] = useState("all");
  const [nodeStateFilter, setNodeStateFilter] = useState("all");
  const [nodeQuery, setNodeQuery] = useState("");
  const [showAllNodes, setShowAllNodes] = useState(false);
  const [refreshCadence, setRefreshCadence] = useState<"off" | "30" | "60">("off");
  const [copied, setCopied] = useState<string | null>(null);

  async function load(selectedScope = scope, silent = false) {
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
  }

  useEffect(() => {
    void load(scope);
  }, [scope]);

  useEffect(() => {
    if (refreshCadence === "off") return undefined;
    const interval = window.setInterval(() => {
      void load(scope, true);
    }, Number(refreshCadence) * 1000);
    return () => window.clearInterval(interval);
  }, [refreshCadence, scope]);

  useEffect(() => {
    setShowAllNodes(false);
  }, [nodePartitionFilter, nodeGpuFilter, nodeStateFilter, nodeQuery]);

  const allCache = useMemo(() => {
    if (state.cache.length) return dedupeCache(state.cache);
    return dedupeCache([
      ...(state.resources?.cache ?? []),
      ...(state.queue?.cache ?? []),
      ...(state.myJobs?.cache ?? []),
      ...(state.history?.cache ?? []),
      ...(state.insightsData?.cache ?? [])
    ]);
  }, [state.cache, state.resources, state.queue, state.myJobs, state.history, state.insightsData]);

  const stale = useMemo(() => allCache.filter((meta) => meta.is_stale), [allCache]);
  const partitions = state.resources?.partitions ?? [];
  const nodes = state.resources?.nodes ?? [];
  const gpuTypes = state.resources?.gpu_pools.map((pool) => pool.type) ?? [];
  const nodeStates = Array.from(new Set(nodes.map((node) => node.state))).sort();
  const reasons = Array.from(
    new Set((state.queue?.jobs ?? []).map((job) => job.state_reason).filter(Boolean) as string[])
  ).sort();

  const filteredJobs = useMemo(() => {
    return (state.queue?.jobs ?? []).filter((job) => {
      const matchesPartition = partitionFilter === "all" || job.partition === partitionFilter;
      const matchesGpu = gpuFilter === "all" || job.gpus.some((gpu) => gpu.type === gpuFilter);
      const matchesState = stateFilter === "all" || job.state === stateFilter;
      const matchesReason = reasonFilter === "all" || job.state_reason === reasonFilter;
      const haystack =
        `${job.job_id} ${job.name ?? ""} ${job.user} ${job.partition ?? ""}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query.toLowerCase());
      return matchesPartition && matchesGpu && matchesState && matchesReason && matchesQuery;
    });
  }, [state.queue, partitionFilter, gpuFilter, stateFilter, reasonFilter, query]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const matchesPartition =
        nodePartitionFilter === "all" || node.partitions.includes(nodePartitionFilter);
      const matchesGpu = nodeGpuFilter === "all" || node.gpu_types.includes(nodeGpuFilter);
      const matchesState = nodeStateFilter === "all" || node.state === nodeStateFilter;
      const haystack =
        `${node.name} ${node.state} ${node.partitions.join(" ")} ${node.features.join(" ")}`.toLowerCase();
      const matchesQuery = !nodeQuery || haystack.includes(nodeQuery.toLowerCase());
      return matchesPartition && matchesGpu && matchesState && matchesQuery;
    });
  }, [nodes, nodePartitionFilter, nodeGpuFilter, nodeStateFilter, nodeQuery]);
  const displayedNodes = showAllNodes
    ? filteredNodes
    : filteredNodes.slice(0, NODE_PREVIEW_LIMIT);
  const nodeSummary = useMemo(() => summarizeNodes(filteredNodes), [filteredNodes]);
  const queuePressure = useMemo(
    () => summarizeQueuePressure(state.queue?.jobs ?? []),
    [state.queue]
  );
  const userWorkload = useMemo(() => summarizeUsers(state.queue?.jobs ?? []), [state.queue]);

  const cluster = state.resources?.cluster;
  const alias = state.config?.ssh_alias ?? "andromeda";
  const commands = useMemo(() => buildCommands(alias), [alias]);
  const insights = state.insightsData?.insights ?? [];

  async function copyText(text: string, label: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      fallbackCopy(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    }
  }

  function exportSnapshot() {
    const snapshot = {
      exported_at: new Date().toISOString(),
      config: state.config,
      resources: state.resources,
      queue: state.queue,
      my_jobs: state.myJobs,
      history: state.history,
      insights: state.insightsData
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `andromeda-dashboard-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
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
          <a href="#insights">Insights</a>
          <a href="#tools">Tools</a>
        </nav>
        <div className="config-box">
          <Settings size={16} aria-hidden="true" />
          <div>
            <strong>{alias}</strong>
            <span>{state.config?.config_exists ? "config loaded" : "default config"}</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>Compute Dashboard</h1>
            <p>
              {alias} / {state.config?.current_user ?? "remote user"} / {state.queue?.scope ?? scope}
            </p>
          </div>
          <div className="toolbar">
            <button type="button" className="icon-button" onClick={exportSnapshot}>
              <Download size={18} aria-hidden="true" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void load(scope)}
              title="Refresh data"
            >
              <RefreshCw size={18} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <StatusLine
          loadedAt={state.loadedAt}
          loading={state.loading}
          staleCount={stale.length}
          cacheCount={allCache.length}
          scope={state.queue?.scope ?? scope}
          refreshCadence={refreshCadence}
          onRefreshCadence={setRefreshCadence}
        />

        {state.error ? (
          <div className="notice error" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>{state.error}</span>
          </div>
        ) : null}

        {stale.length ? (
          <div className="notice warning" role="status">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>Showing cached data for {stale.map((meta) => meta.key).join(", ")}.</span>
          </div>
        ) : null}

        <section id="overview" className="overview-strip" aria-label="Cluster overview">
          <Metric
            icon={<Gauge size={18} />}
            label="Jobs"
            value={`${cluster?.running_jobs ?? 0} / ${cluster?.pending_jobs ?? 0}`}
            detail="running / pending"
          />
          <Metric
            icon={<Server size={18} />}
            label="Nodes"
            value={`${cluster?.nodes_available ?? 0} / ${cluster?.nodes_total ?? 0}`}
            detail="available / total"
          />
          <Metric
            icon={<Database size={18} />}
            label="GPUs"
            value={formatNumber(cluster?.gpu_free)}
            detail={`${formatNumber(cluster?.gpu_total)} total`}
          />
          <Metric
            icon={<Cpu size={18} />}
            label="CPUs"
            value={formatNumber(cluster?.cpus_idle)}
            detail={`${formatNumber(cluster?.cpus_total)} total`}
          />
          <Metric
            icon={<HardDrive size={18} />}
            label="Memory"
            value={formatMemory(cluster?.memory_free_mb)}
            detail="free"
          />
        </section>

        <section id="nodes" className="panel">
          <div className="section-row">
            <SectionTitle icon={<ListFilter size={18} />} title="Node Explorer" />
            <div className="section-actions">
              <span className="count-label">
                {filteredNodes.length} matched, {displayedNodes.length} shown
              </span>
              {filteredNodes.length > NODE_PREVIEW_LIMIT ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowAllNodes((current) => !current)}
                >
                  {showAllNodes ? "Show first 80" : "Show all"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="filters node-filters">
            <FilterSelect
              label="Partition"
              value={nodePartitionFilter}
              onChange={setNodePartitionFilter}
              options={partitions.map((partition) => partition.name)}
            />
            <FilterSelect
              label="GPU"
              value={nodeGpuFilter}
              onChange={setNodeGpuFilter}
              options={gpuTypes}
            />
            <FilterSelect
              label="State"
              value={nodeStateFilter}
              onChange={setNodeStateFilter}
              options={nodeStates}
            />
            <label className="search">
              <span>Search</span>
              <Search size={16} aria-hidden="true" />
              <input
                value={nodeQuery}
                onChange={(event) => setNodeQuery(event.target.value)}
                placeholder="node, feature, state"
              />
            </label>
          </div>
          <FleetGrid nodes={filteredNodes} />
          <NodeSummary summary={nodeSummary} />
          <NodeTable nodes={displayedNodes} />
        </section>

        <section id="gpus" className="panel">
          <SectionTitle icon={<Database size={18} />} title="GPU Availability" />
          <GpuTable pools={state.resources?.gpu_pools ?? []} loading={state.loading} />
        </section>

        <section id="partitions" className="panel">
          <SectionTitle icon={<Rows3 size={18} />} title="Partition Matrix" />
          <PartitionMatrix partitions={partitions} />
          <div className="section-subtitle">
            <SectionTitle icon={<Server size={18} />} title="Partition Detail" />
          </div>
          <PartitionTable partitions={partitions} />
        </section>

        <section id="queue" className="panel">
          <div className="section-row">
            <SectionTitle icon={<Filter size={18} />} title="Queue Explorer" />
            <ScopeControl scope={scope} onScope={setScope} />
          </div>
          <div className="filters">
            <FilterSelect
              label="Partition"
              value={partitionFilter}
              onChange={setPartitionFilter}
              options={partitions.map((partition) => partition.name)}
            />
            <FilterSelect label="GPU" value={gpuFilter} onChange={setGpuFilter} options={gpuTypes} />
            <FilterSelect
              label="State"
              value={stateFilter}
              onChange={setStateFilter}
              options={["RUNNING", "PENDING", "COMPLETING"]}
            />
            <FilterSelect
              label="Reason"
              value={reasonFilter}
              onChange={setReasonFilter}
              options={reasons}
            />
            <label className="search">
              <span>Search</span>
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="job, user, partition"
              />
            </label>
          </div>
          <div className="queue-intel">
            <QueuePressurePanel summary={queuePressure} />
            <UserWorkloadPanel users={userWorkload} />
          </div>
          <QueueTable jobs={filteredJobs} />
        </section>

        <section id="jobs" className="panel two-column">
          <div>
            <SectionTitle
              icon={<User size={18} />}
              title={`My Jobs - ${state.config?.current_user ?? "remote user"}`}
            />
            <JobRuntimePanel jobs={state.myJobs?.jobs ?? []} />
            <JobList jobs={state.myJobs?.jobs ?? []} onCopy={copyText} alias={alias} />
          </div>
          <div>
            <SectionTitle icon={<Clock3 size={18} />} title="Recent History" />
            <HistoryBox history={state.history} />
            <HistoryTable history={state.history} />
          </div>
        </section>

        <section id="insights" className="panel">
          <SectionTitle icon={<AlertTriangle size={18} />} title="Insights" />
          <InsightsList insights={insights} />
        </section>

        <section id="tools" className="panel">
          <div className="section-row">
            <SectionTitle icon={<Terminal size={18} />} title="Power Tools" />
            {copied ? <span className="count-label">Copied {copied}</span> : null}
          </div>
          <div className="tools-grid">
            <SchedulerPanel scheduler={state.insightsData?.scheduler ?? null} />
            <AccountLimitsPanel accountLimits={state.insightsData?.account_limits ?? null} />
          </div>
          <CommandList commands={commands} onCopy={copyText} />
          <CacheTable cache={allCache} />
        </section>
      </main>
    </div>
  );
}

function Metric({
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

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function StatusLine({
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

function RefreshControl({
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

function FilterSelect({
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

function ScopeControl({
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

function FleetGrid({ nodes }: { nodes: NodeResource[] }) {
  if (!nodes.length) return <EmptyState text="No nodes match the current filters." />;
  const columns = Math.min(32, Math.max(12, Math.ceil(Math.sqrt(nodes.length * 1.9))));
  return (
    <div className="fleet-panel">
      <div className="fleet-head">
        <div className="section-title inline-title">
          <Network size={18} aria-hidden="true" />
          <h2>Fleet Grid</h2>
        </div>
        <FleetLegend />
      </div>
      <div
        className="fleet-grid"
        role="list"
        aria-label={`${nodes.length} filtered nodes`}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(9px, 1fr))` }}
      >
        {nodes.map((node) => (
          <div
            key={node.name}
            role="listitem"
            tabIndex={0}
            className={`fleet-cell ${fleetClass(node)} ${node.gpu_total ? "has-gpu" : ""}`}
            title={`${node.name} / ${stateText(node)} / ${node.cpus_idle} idle CPU / ${node.gpu_free} free GPU / ${formatMemory(node.memory_free_mb)}`}
          >
            <span className="sr-only">
              {node.name} {stateText(node)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FleetLegend() {
  return (
    <div className="fleet-legend" aria-label="Fleet legend">
      <span>
        <i className="legend-idle" aria-hidden="true" /> idle
      </span>
      <span>
        <i className="legend-mixed" aria-hidden="true" /> mixed
      </span>
      <span>
        <i className="legend-allocated" aria-hidden="true" /> allocated
      </span>
      <span>
        <i className="legend-drain" aria-hidden="true" /> drain
      </span>
      <span>
        <i className="legend-down" aria-hidden="true" /> down
      </span>
    </div>
  );
}

function NodeSummary({
  summary
}: {
  summary: {
    states: [string, number][];
    gpus: [string, number][];
    partitions: [string, number][];
  };
}) {
  return (
    <div className="node-summary" aria-label="Node summary">
      <SummaryColumn title="States" rows={summary.states} />
      <SummaryColumn title="GPU Types" rows={summary.gpus} />
      <SummaryColumn title="Partitions" rows={summary.partitions} />
    </div>
  );
}

function SummaryColumn({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div className="summary-column">
      <strong>{title}</strong>
      {rows.length ? (
        rows.slice(0, 6).map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <em>{count}</em>
          </div>
        ))
      ) : (
        <div>
          <span>none</span>
          <em>0</em>
        </div>
      )}
    </div>
  );
}

function NodeTable({ nodes }: { nodes: NodeResource[] }) {
  if (!nodes.length) return <EmptyState text="No nodes match the current filters." />;
  return (
    <div className="table-wrap node-table">
      <table>
        <thead>
          <tr>
            <th>Node</th>
            <th>State</th>
            <th>Partitions</th>
            <th>CPU</th>
            <th>Memory</th>
            <th>GPU</th>
            <th>Features</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr key={node.name}>
              <td className="mono">{node.name}</td>
              <td>{stateText(node)}</td>
              <td>{node.partitions.join(", ") || "n/a"}</td>
              <td>
                {node.cpus_idle} idle / {node.cpus_total}
              </td>
              <td>
                {formatMemory(node.memory_free_mb)} / {formatMemory(node.memory_total_mb)}
              </td>
              <td>{gpuInventoryText(node)}</td>
              <td>{node.features.slice(0, 4).join(", ") || "n/a"}</td>
              <td>{node.reason ?? "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GpuTable({ pools, loading }: { pools: GpuPool[]; loading: boolean }) {
  if (!pools.length) {
    return (
      <EmptyState
        text={loading ? "Loading GPU pools." : "No GPU inventory found in the current node snapshot."}
      />
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Total</th>
            <th>Used</th>
            <th>Free</th>
            <th>Usable</th>
            <th>Nodes</th>
            <th>Unavailable</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr key={pool.type}>
              <td className="mono">{pool.type}</td>
              <td>{pool.total}</td>
              <td>{pool.used}</td>
              <td>{pool.free}</td>
              <td>{pool.usable}</td>
              <td>
                {pool.nodes_available} / {pool.nodes_total}
              </td>
              <td>{pool.unhealthy_nodes.slice(0, 4).join(", ") || "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartitionMatrix({ partitions }: { partitions: PartitionSummary[] }) {
  if (!partitions.length) return <EmptyState text="No partition matrix available." />;
  return (
    <div className="availability-matrix" aria-label="Partition availability matrix">
      {partitions.map((partition) => (
        <div className="matrix-row" key={partition.name}>
          <strong className="mono">{partition.name}</strong>
          <span>{partition.idle_nodes} idle nodes</span>
          <span>{formatNumber(partition.cpus_idle)} idle CPU</span>
          <span>{partition.gpu_free} free GPU</span>
          <span>{formatMemory(partition.memory_free_mb)}</span>
          <span>{partition.max_time ?? "n/a"}</span>
        </div>
      ))}
    </div>
  );
}

function PartitionTable({ partitions }: { partitions: PartitionSummary[] }) {
  if (!partitions.length) return <EmptyState text="No partition metadata available." />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Partition</th>
            <th>Nodes</th>
            <th>Idle / Mixed / Down</th>
            <th>Idle CPUs</th>
            <th>Free Memory</th>
            <th>GPUs Free</th>
            <th>Max Time</th>
            <th>Node Classes</th>
          </tr>
        </thead>
        <tbody>
          {partitions.map((partition) => (
            <tr key={partition.name}>
              <td className="mono">{partition.name}</td>
              <td>{partition.total_nodes}</td>
              <td>
                {partition.idle_nodes} / {partition.mixed_nodes} / {partition.down_nodes}
              </td>
              <td>{formatNumber(partition.cpus_idle)}</td>
              <td>{formatMemory(partition.memory_free_mb)}</td>
              <td>
                {partition.gpu_free} / {partition.gpu_total}
              </td>
              <td>{partition.max_time ?? "n/a"}</td>
              <td>{partition.node_classes.slice(0, 2).join("; ") || "n/a"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueueTable({ jobs }: { jobs: QueueJob[] }) {
  if (!jobs.length) return <EmptyState text="No jobs match the current filters." />;
  return (
    <div className="table-wrap queue-table">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>User</th>
            <th>Partition</th>
            <th>State</th>
            <th>Request</th>
            <th>Reason</th>
            <th>Estimate</th>
            <th>Nodes</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job_id}>
              <td>
                <strong className="mono">{job.job_id}</strong>
                <span>{job.name ?? (job.anonymized ? "anonymized" : "unnamed")}</span>
              </td>
              <td>{job.user}</td>
              <td>{job.partition ?? "n/a"}</td>
              <td>{job.state}</td>
              <td>
                {job.cpus} CPU, {formatMemory(job.memory_mb)}, {job.gpu_count || 0} GPU
              </td>
              <td>{job.reason_label ?? job.state_reason ?? "n/a"}</td>
              <td>{shortTime(job.estimated_start_time)}</td>
              <td>{job.nodes.join(", ") || "pending"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QueuePressurePanel({
  summary
}: {
  summary: {
    running: number;
    pending: number;
    pendingCpus: number;
    pendingGpus: number;
    reasons: [string, number][];
    partitions: [string, number][];
    gpus: [string, number][];
  };
}) {
  return (
    <div className="intel-panel">
      <div className="intel-heading">
        <SectionTitle icon={<Gauge size={18} />} title="Queue Pressure" />
      </div>
      <dl className="compact-dl four-up">
        <div>
          <dt>Running</dt>
          <dd>{summary.running}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{summary.pending}</dd>
        </div>
        <div>
          <dt>Pending CPU</dt>
          <dd>{formatNumber(summary.pendingCpus)}</dd>
        </div>
        <div>
          <dt>Pending GPU</dt>
          <dd>{summary.pendingGpus}</dd>
        </div>
      </dl>
      <div className="intel-columns">
        <MiniRank title="Reasons" rows={summary.reasons} empty="none" />
        <MiniRank title="Partitions" rows={summary.partitions} empty="none" />
        <MiniRank title="GPU asks" rows={summary.gpus} empty="none" />
      </div>
    </div>
  );
}

function UserWorkloadPanel({
  users
}: {
  users: { user: string; running: number; pending: number; cpus: number; gpus: number }[];
}) {
  return (
    <div className="intel-panel">
      <div className="intel-heading">
        <SectionTitle icon={<Users size={18} />} title="Visible Users" />
      </div>
      {users.length ? (
        <div className="user-workload">
          {users.slice(0, 8).map((user) => (
            <div key={user.user}>
              <strong>{user.user}</strong>
              <span>
                {user.running} run / {user.pending} pend
              </span>
              <em>
                {formatNumber(user.cpus)} CPU / {user.gpus} GPU
              </em>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No visible users in this scope." />
      )}
    </div>
  );
}

function MiniRank({ title, rows, empty }: { title: string; rows: [string, number][]; empty: string }) {
  return (
    <div className="mini-rank">
      <strong>{title}</strong>
      {rows.length ? (
        rows.slice(0, 5).map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <em>{count}</em>
          </div>
        ))
      ) : (
        <div>
          <span>{empty}</span>
          <em>0</em>
        </div>
      )}
    </div>
  );
}

function JobRuntimePanel({ jobs }: { jobs: QueueJob[] }) {
  const visible = jobs
    .slice()
    .sort((left, right) => jobSortScore(right) - jobSortScore(left))
    .slice(0, 10);
  if (!visible.length) return null;
  return (
    <div className="runtime-panel">
      {visible.map((job) => {
        const progress =
          job.elapsed_seconds && job.time_limit_seconds
            ? Math.min(100, Math.round((job.elapsed_seconds / job.time_limit_seconds) * 100))
            : null;
        return (
          <div className="runtime-row" key={job.job_id}>
            <strong className="mono">{job.job_id}</strong>
            <span>{job.state}</span>
            <span>{job.partition ?? "n/a"}</span>
            <span>{formatDuration(job.elapsed_seconds)}</span>
            <span>{job.gpu_count} GPU</span>
            <div className="runtime-track" aria-label={`${job.job_id} runtime`}>
              <i style={{ width: `${progress ?? 0}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JobList({
  jobs,
  onCopy,
  alias
}: {
  jobs: QueueJob[];
  onCopy: (text: string, label: string) => void;
  alias: string;
}) {
  if (!jobs.length) return <EmptyState text="No visible jobs for the configured user." />;
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <article key={job.job_id} className="job-item">
          <div className="job-heading">
            <div>
              <strong>
                {job.job_id} {job.name ? `- ${job.name}` : ""}
              </strong>
              <span>
                {job.state} on {job.partition ?? "n/a"}
              </span>
            </div>
            <button
              type="button"
              className="copy-button"
              onClick={() =>
                onCopy(`ssh ${alias} 'scontrol show job -dd ${job.job_id}'`, `job ${job.job_id}`)
              }
              title="Copy job detail command"
            >
              <Copy size={15} aria-hidden="true" />
            </button>
          </div>
          <dl>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatDuration(job.elapsed_seconds)}</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{formatDuration(job.time_limit_seconds)}</dd>
            </div>
            <div>
              <dt>Request</dt>
              <dd>
                {job.cpus} CPU / {job.gpu_count} GPU
              </dd>
            </div>
            <div>
              <dt>Nodes</dt>
              <dd>{job.nodes.join(", ") || "pending"}</dd>
            </div>
          </dl>
          {job.dependency ? <p>Dependency: {job.dependency}</p> : null}
          {job.state_reason ? <p>{job.reason_label ?? job.state_reason}</p> : null}
        </article>
      ))}
    </div>
  );
}

function HistoryBox({ history }: { history: HistoryResponse | null }) {
  return (
    <div className="history-box">
      <dl>
        <div>
          <dt>Window</dt>
          <dd>{history?.days ?? 7} days</dd>
        </div>
        <div>
          <dt>Jobs</dt>
          <dd>{history?.jobs.length ?? 0}</dd>
        </div>
        <div>
          <dt>Median wait</dt>
          <dd>{formatDuration(history?.median_wait_seconds)}</dd>
        </div>
        <div>
          <dt>Median runtime</dt>
          <dd>{formatDuration(history?.median_runtime_seconds)}</dd>
        </div>
      </dl>
    </div>
  );
}

function HistoryTable({ history }: { history: HistoryResponse | null }) {
  const jobs = history?.jobs.slice(0, 12) ?? [];
  if (!jobs.length) return <EmptyState text="No accounting rows in this window." />;
  return (
    <div className="table-wrap history-table">
      <table className="compact-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>State</th>
            <th>Partition</th>
            <th>Wait</th>
            <th>Runtime</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job_id}>
              <td className="mono">{job.job_id}</td>
              <td>{job.state}</td>
              <td>{job.partition ?? "n/a"}</td>
              <td>{formatDuration(job.wait_seconds)}</td>
              <td>{formatDuration(job.runtime_seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InsightsList({ insights }: { insights: Insight[] }) {
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

function SchedulerPanel({ scheduler }: { scheduler: SchedulerHealth | null }) {
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

function AccountLimitsPanel({ accountLimits }: { accountLimits: AccountLimits | null }) {
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

function CommandList({
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

function CacheTable({ cache }: { cache: CacheMeta[] }) {
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

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function stateText(node: NodeResource): string {
  return [node.state, ...node.state_flags].join("+");
}

function gpuInventoryText(node: NodeResource): string {
  if (!node.gres.length) return "none";
  return node.gres.map((gpu) => `${gpu.type} ${gpu.free}/${gpu.total}`).join(", ");
}

function fleetClass(node: NodeResource): string {
  const state = stateText(node).toLowerCase();
  if (state.includes("down") || state.includes("fail")) return "is-down";
  if (state.includes("drain")) return "is-drain";
  if (state.includes("mixed")) return "is-mixed";
  if (state.includes("alloc")) return "is-allocated";
  if (state.includes("idle")) return "is-idle";
  return "is-other";
}

function secondsText(value: number | null): string {
  if (value === null || value === undefined) return "n/a";
  return `${value.toFixed(2)}s`;
}

function tresText(values: Record<string, string>): string {
  const entries = Object.entries(values);
  if (!entries.length) return "n/a";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

function dedupeCache(cache: CacheMeta[]): CacheMeta[] {
  const byKey = new Map<string, CacheMeta>();
  for (const meta of cache) byKey.set(meta.key, meta);
  return Array.from(byKey.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildCommands(alias: string): ToolCommand[] {
  return [
    {
      id: "identity",
      group: "ssh",
      label: "Identity Probe",
      command: `ssh ${alias} 'hostname; whoami; pwd; sinfo --version; squeue -u "$USER"'`,
      description: "Validate alias, identity, Slurm version, and your queue."
    },
    {
      id: "quota",
      group: "storage",
      label: "Quota Check",
      command: `ssh ${alias} 'acct-chk "$USER"; squeue -u "$USER"'`,
      description: "Check storage/account status before larger data movement."
    },
    {
      id: "nodes",
      group: "slurm",
      label: "Node JSON",
      command: `ssh ${alias} 'scontrol show nodes --json | jq ".nodes | length"'`,
      description: "Confirm the node inventory endpoint and count returned nodes."
    },
    {
      id: "queue",
      group: "slurm",
      label: "Queue JSON",
      command: `ssh ${alias} 'squeue --json | jq ".jobs | length"'`,
      description: "Confirm live queue JSON and count visible jobs."
    },
    {
      id: "starts",
      group: "slurm",
      label: "Start Estimates",
      command: `ssh ${alias} 'squeue --start --json | jq ".jobs[:10]"'`,
      description: "Inspect Slurm start estimates for the first visible pending jobs."
    },
    {
      id: "history",
      group: "accounting",
      label: "Recent History",
      command: `ssh ${alias} 'sacct --json -S now-7days -n -X | jq ".jobs | length"'`,
      description: "Check accounting visibility for the current seven-day window."
    },
    {
      id: "scheduler",
      group: "scheduler",
      label: "Scheduler Health",
      command: `ssh ${alias} 'sdiag; sprio -w'`,
      description: "Show scheduler cycle/backfill stats and priority factor weights."
    },
    {
      id: "qos",
      group: "limits",
      label: "QOS Limits",
      command: `ssh ${alias} 'sacctmgr show qos format=Name,MaxJobsPU,MaxSubmitPU,MaxTRESPU -P -n'`,
      description: "Review per-user job, submission, CPU, GPU, and memory caps."
    }
  ];
}

function summarizeNodes(nodes: NodeResource[]) {
  const states = new Map<string, number>();
  const gpus = new Map<string, number>();
  const partitions = new Map<string, number>();
  for (const node of nodes) {
    states.set(node.state, (states.get(node.state) ?? 0) + 1);
    for (const gpu of node.gpu_types.length ? node.gpu_types : ["cpu-only"]) {
      gpus.set(gpu, (gpus.get(gpu) ?? 0) + 1);
    }
    for (const partition of node.partitions.length ? node.partitions : ["unassigned"]) {
      partitions.set(partition, (partitions.get(partition) ?? 0) + 1);
    }
  }
  const byCount = (left: [string, number], right: [string, number]) =>
    right[1] - left[1] || left[0].localeCompare(right[0]);
  return {
    states: Array.from(states.entries()).sort(byCount),
    gpus: Array.from(gpus.entries()).sort(byCount),
    partitions: Array.from(partitions.entries()).sort(byCount)
  };
}

function summarizeQueuePressure(jobs: QueueJob[]) {
  const reasons = new Map<string, number>();
  const partitions = new Map<string, number>();
  const gpus = new Map<string, number>();
  let running = 0;
  let pending = 0;
  let pendingCpus = 0;
  let pendingGpus = 0;

  for (const job of jobs) {
    if (job.state === "RUNNING") running += 1;
    if (job.state === "PENDING") {
      pending += 1;
      pendingCpus += job.cpus;
      pendingGpus += job.gpu_count;
      reasons.set(
        job.reason_label ?? job.state_reason ?? "not specified",
        (reasons.get(job.reason_label ?? job.state_reason ?? "not specified") ?? 0) + 1
      );
    }
    partitions.set(job.partition ?? "none", (partitions.get(job.partition ?? "none") ?? 0) + 1);
    if (job.gpus.length) {
      for (const gpu of job.gpus) {
        gpus.set(gpu.type, (gpus.get(gpu.type) ?? 0) + gpu.count);
      }
    } else {
      gpus.set("cpu-only", (gpus.get("cpu-only") ?? 0) + 1);
    }
  }

  return {
    running,
    pending,
    pendingCpus,
    pendingGpus,
    reasons: rankEntries(reasons),
    partitions: rankEntries(partitions),
    gpus: rankEntries(gpus)
  };
}

function summarizeUsers(jobs: QueueJob[]) {
  const byUser = new Map<string, { user: string; running: number; pending: number; cpus: number; gpus: number }>();
  for (const job of jobs) {
    const current = byUser.get(job.user) ?? {
      user: job.user,
      running: 0,
      pending: 0,
      cpus: 0,
      gpus: 0
    };
    if (job.state === "RUNNING") current.running += 1;
    if (job.state === "PENDING") current.pending += 1;
    current.cpus += job.cpus;
    current.gpus += job.gpu_count;
    byUser.set(job.user, current);
  }
  return Array.from(byUser.values()).sort(
    (left, right) =>
      right.running + right.pending - (left.running + left.pending) ||
      right.gpus - left.gpus ||
      right.cpus - left.cpus ||
      left.user.localeCompare(right.user)
  );
}

function rankEntries(values: Map<string, number>): [string, number][] {
  return Array.from(values.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  );
}

function jobSortScore(job: QueueJob): number {
  const stateWeight = job.state === "RUNNING" ? 10_000 : job.state === "PENDING" ? 5_000 : 0;
  return stateWeight + (job.gpu_count * 250) + job.cpus;
}
