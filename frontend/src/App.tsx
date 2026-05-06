import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  Filter,
  Gauge,
  HardDrive,
  RefreshCw,
  Search,
  Server,
  Settings,
  User
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, formatDuration, formatMemory, formatNumber, shortTime } from "./api";
import type {
  ConfigStatus,
  GpuPool,
  HistoryResponse,
  Insight,
  PartitionSummary,
  QueueJob,
  QueueResponse,
  ResourceResponse
} from "./types";

type LoadState = {
  config: ConfigStatus | null;
  resources: ResourceResponse | null;
  queue: QueueResponse | null;
  myJobs: QueueResponse | null;
  history: HistoryResponse | null;
  insights: Insight[];
  loading: boolean;
  error: string | null;
};

const emptyState: LoadState = {
  config: null,
  resources: null,
  queue: null,
  myJobs: null,
  history: null,
  insights: [],
  loading: true,
  error: null
};

export function App() {
  const [state, setState] = useState<LoadState>(emptyState);
  const [scope, setScope] = useState<"mine" | "lab" | "cluster">("mine");
  const [partitionFilter, setPartitionFilter] = useState("all");
  const [gpuFilter, setGpuFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [query, setQuery] = useState("");

  async function load(selectedScope = scope) {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [config, resources, queue, myJobs, history, insights] = await Promise.all([
        api.config(),
        api.resources(),
        api.queue(selectedScope),
        api.myJobs(),
        api.history(7),
        api.insights()
      ]);
      setState({
        config,
        resources,
        queue,
        myJobs,
        history,
        insights: insights.insights,
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

  const stale = useMemo(() => {
    const metas = [
      ...(state.resources?.cache ?? []),
      ...(state.queue?.cache ?? []),
      ...(state.myJobs?.cache ?? []),
      ...(state.history?.cache ?? [])
    ];
    return metas.filter((meta) => meta.is_stale);
  }, [state.resources, state.queue, state.myJobs, state.history]);

  const partitions = state.resources?.partitions ?? [];
  const gpuTypes = state.resources?.gpu_pools.map((pool) => pool.type) ?? [];
  const reasons = Array.from(
    new Set((state.queue?.jobs ?? []).map((job) => job.state_reason).filter(Boolean) as string[])
  ).sort();

  const filteredJobs = useMemo(() => {
    return (state.queue?.jobs ?? []).filter((job) => {
      const matchesPartition = partitionFilter === "all" || job.partition === partitionFilter;
      const matchesGpu = gpuFilter === "all" || job.gpus.some((gpu) => gpu.type === gpuFilter);
      const matchesState = stateFilter === "all" || job.state === stateFilter;
      const matchesReason = reasonFilter === "all" || job.state_reason === reasonFilter;
      const haystack = `${job.job_id} ${job.name ?? ""} ${job.user} ${job.partition ?? ""}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query.toLowerCase());
      return matchesPartition && matchesGpu && matchesState && matchesReason && matchesQuery;
    });
  }, [state.queue, partitionFilter, gpuFilter, stateFilter, reasonFilter, query]);

  const cluster = state.resources?.cluster;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Server size={20} aria-hidden="true" />
          <span>Andromeda</span>
        </div>
        <nav aria-label="Dashboard sections">
          <a href="#overview">Overview</a>
          <a href="#gpus">GPU Pools</a>
          <a href="#partitions">Partitions</a>
          <a href="#queue">Queue</a>
          <a href="#jobs">My Jobs</a>
          <a href="#insights">Insights</a>
        </nav>
        <div className="config-box">
          <Settings size={16} aria-hidden="true" />
          <div>
            <strong>{state.config?.ssh_alias ?? "andromeda"}</strong>
            <span>{state.config?.config_exists ? "config loaded" : "default config"}</span>
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>Compute Dashboard</h1>
            <p>Read-only Slurm resources from the configured SSH alias.</p>
          </div>
          <button type="button" className="icon-button" onClick={() => void load(scope)} title="Refresh data">
            <RefreshCw size={18} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </header>

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

        <section id="overview" className="overview-grid" aria-label="Cluster overview">
          <Metric icon={<Activity size={18} />} label="Running / Pending" value={`${cluster?.running_jobs ?? 0} / ${cluster?.pending_jobs ?? 0}`} />
          <Metric icon={<Server size={18} />} label="Nodes Available" value={`${cluster?.nodes_available ?? 0} / ${cluster?.nodes_total ?? 0}`} />
          <Metric icon={<Gauge size={18} />} label="Free GPUs" value={formatNumber(cluster?.gpu_free)} detail={`${formatNumber(cluster?.gpu_total)} total`} />
          <Metric icon={<Cpu size={18} />} label="Idle CPUs" value={formatNumber(cluster?.cpus_idle)} detail={`${formatNumber(cluster?.cpus_total)} total`} />
          <Metric icon={<HardDrive size={18} />} label="Free Memory" value={formatMemory(cluster?.memory_free_mb)} />
        </section>

        <section id="gpus" className="panel">
          <SectionTitle icon={<Database size={18} />} title="GPU Availability" />
          <GpuTable pools={state.resources?.gpu_pools ?? []} loading={state.loading} />
        </section>

        <section id="partitions" className="panel">
          <SectionTitle icon={<Server size={18} />} title="Partitions" />
          <PartitionTable partitions={partitions} />
        </section>

        <section id="queue" className="panel">
          <div className="section-row">
            <SectionTitle icon={<Filter size={18} />} title="Queue Explorer" />
            <ScopeControl scope={scope} onScope={setScope} />
          </div>
          <div className="filters">
            <label>
              <span>Partition</span>
              <select value={partitionFilter} onChange={(event) => setPartitionFilter(event.target.value)}>
                <option value="all">All</option>
                {partitions.map((partition) => (
                  <option value={partition.name} key={partition.name}>
                    {partition.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>GPU</span>
              <select value={gpuFilter} onChange={(event) => setGpuFilter(event.target.value)}>
                <option value="all">All</option>
                {gpuTypes.map((type) => (
                  <option value={type} key={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>State</span>
              <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="RUNNING">Running</option>
                <option value="PENDING">Pending</option>
                <option value="COMPLETING">Completing</option>
              </select>
            </label>
            <label>
              <span>Reason</span>
              <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value)}>
                <option value="all">All</option>
                {reasons.map((reason) => (
                  <option value={reason} key={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>
            <label className="search">
              <span>Search</span>
              <Search size={16} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="job, user, partition" />
            </label>
          </div>
          <QueueTable jobs={filteredJobs} />
        </section>

        <section id="jobs" className="panel two-column">
          <div>
            <SectionTitle icon={<User size={18} />} title="My Jobs" />
            <JobList jobs={state.myJobs?.jobs ?? []} />
          </div>
          <div>
            <SectionTitle icon={<Gauge size={18} />} title="Recent History" />
            <HistoryBox history={state.history} />
          </div>
        </section>

        <section id="insights" className="panel">
          <SectionTitle icon={<AlertTriangle size={18} />} title="Insights" />
          <InsightsList insights={state.insights} />
        </section>
      </main>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail?: string }) {
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

function ScopeControl({ scope, onScope }: { scope: "mine" | "lab" | "cluster"; onScope: (scope: "mine" | "lab" | "cluster") => void }) {
  return (
    <div className="segmented" aria-label="Queue scope">
      {(["mine", "lab", "cluster"] as const).map((item) => (
        <button type="button" key={item} className={scope === item ? "active" : ""} onClick={() => onScope(item)}>
          {item}
        </button>
      ))}
    </div>
  );
}

function GpuTable({ pools, loading }: { pools: GpuPool[]; loading: boolean }) {
  if (!pools.length) {
    return <EmptyState text={loading ? "Loading GPU pools." : "No GPU inventory found in the current node snapshot."} />;
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

function JobList({ jobs }: { jobs: QueueJob[] }) {
  if (!jobs.length) return <EmptyState text="No visible jobs for the configured user." />;
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <article key={job.job_id} className="job-item">
          <div>
            <strong>
              {job.job_id} {job.name ? `- ${job.name}` : ""}
            </strong>
            <span>
              {job.state} on {job.partition ?? "n/a"}
            </span>
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
          {insight.details.length ? <small>{insight.details.join(" | ")}</small> : null}
        </article>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
