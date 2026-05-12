import { AlertTriangle, Cpu, Database, Gauge, HardDrive, Rows3, Server, Terminal, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatMemory, formatNumber } from "./api";
import { JobList, JobRuntimePanel, HistoryBox, HistoryTable } from "./components/Jobs";
import { GpuTable, PartitionMatrix, PartitionTable } from "./components/Resources";
import { Sidebar, Topbar } from "./components/Shell";
import { AccountLimitsPanel, CacheTable, CommandList, SchedulerPanel, StoragePanel } from "./components/Tools";
import { Metric, SectionTitle, StatusLine } from "./components/common";
import { NodesSection, QueueSection } from "./components/Sections";
import { useDashboardSnapshot } from "./hooks/useDashboardSnapshot";
import { useStorage } from "./hooks/useStorage";
import {
  buildCommands,
  dedupeCache,
  fallbackCopy,
  summarizeNodes,
  summarizeQueuePressure,
  summarizeUsers
} from "./lib/dashboard";

export function App() {
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
  const [refreshCadence, setRefreshCadence] = useState<"off" | "30" | "60">("off");
  const [copied, setCopied] = useState<string | null>(null);
  const { state, load } = useDashboardSnapshot(scope);
  const storageResource = useStorage(state.loadedAt);

  useEffect(() => {
    if (refreshCadence === "off") return undefined;
    const interval = window.setInterval(() => void load(scope, true), Number(refreshCadence) * 1000);
    return () => window.clearInterval(interval);
  }, [load, refreshCadence, scope]);

  const allCache = useMemo(() => {
    if (state.cache.length) return dedupeCache(state.cache);
    return dedupeCache([
      ...(state.resources?.cache ?? []),
      ...(state.queue?.cache ?? []),
      ...(state.myJobs?.cache ?? []),
      ...(state.history?.cache ?? []),
      ...(state.insightsData?.cache ?? [])
    ]);
  }, [state]);

  const stale = useMemo(() => allCache.filter((meta) => meta.is_stale), [allCache]);
  const partitions = state.resources?.partitions ?? [];
  const nodes = state.resources?.nodes ?? [];
  const gpuPools = state.resources?.gpu_pools ?? [];
  const gpuTypes = gpuPools.map((pool) => pool.type);
  const nodeStates = Array.from(new Set(nodes.map((node) => node.state))).sort();
  const reasons = Array.from(new Set((state.queue?.jobs ?? []).map((job) => job.state_reason).filter(Boolean) as string[])).sort();

  const filteredJobs = useMemo(() => {
    return (state.queue?.jobs ?? []).filter((job) => {
      const matchesPartition = partitionFilter === "all" || job.partition === partitionFilter;
      const matchesGpu = gpuFilter === "all" || job.gpus.some((gpu) => gpu.type === gpuFilter);
      const matchesState = stateFilter === "all" || job.state === stateFilter;
      const matchesReason = reasonFilter === "all" || job.state_reason === reasonFilter;
      const haystack = `${job.job_id} ${job.name ?? ""} ${job.user} ${job.partition ?? ""}`.toLowerCase();
      return matchesPartition && matchesGpu && matchesState && matchesReason && (!query || haystack.includes(query.toLowerCase()));
    });
  }, [state.queue, partitionFilter, gpuFilter, stateFilter, reasonFilter, query]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const matchesPartition = nodePartitionFilter === "all" || node.partitions.includes(nodePartitionFilter);
      const matchesGpu = nodeGpuFilter === "all" || node.gpu_types.includes(nodeGpuFilter);
      const matchesState = nodeStateFilter === "all" || node.state === nodeStateFilter;
      const haystack = `${node.name} ${node.state} ${node.partitions.join(" ")} ${node.features.join(" ")}`.toLowerCase();
      return matchesPartition && matchesGpu && matchesState && (!nodeQuery || haystack.includes(nodeQuery.toLowerCase()));
    });
  }, [nodes, nodePartitionFilter, nodeGpuFilter, nodeStateFilter, nodeQuery]);

  const nodeSummary = useMemo(() => summarizeNodes(filteredNodes), [filteredNodes]);
  const queuePressure = useMemo(() => summarizeQueuePressure(state.queue?.jobs ?? []), [state.queue]);
  const userWorkload = useMemo(() => summarizeUsers(state.queue?.jobs ?? []), [state.queue]);
  const cluster = state.resources?.cluster;
  const alias = state.config?.ssh_alias ?? "andromeda";
  const commands = useMemo(() => buildCommands(alias), [alias]);

  async function copyText(text: string, label: string) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else fallbackCopy(text);
    } catch {
      fallbackCopy(text);
    }
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1400);
  }

  function exportSnapshot() {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `andromeda-dashboard-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <Sidebar alias={alias} config={state.config} />
      <main>
        <Topbar alias={alias} user={state.config?.current_user ?? "remote user"} scope={state.queue?.scope ?? scope} onExport={exportSnapshot} onRefresh={() => void load(scope)} />
        <StatusLine loadedAt={state.loadedAt} loading={state.loading} staleCount={stale.length} cacheCount={allCache.length} scope={state.queue?.scope ?? scope} refreshCadence={refreshCadence} onRefreshCadence={setRefreshCadence} />
        <Notices error={state.error} stale={stale} />
        <section id="overview" className="overview-strip" aria-label="Cluster overview">
          <Metric icon={<Gauge size={18} />} label="Jobs" value={`${formatNumber(cluster?.running_jobs ?? 0)} / ${formatNumber(cluster?.pending_jobs ?? 0)}`} detail="running / pending" />
          <Metric icon={<Server size={18} />} label="Nodes" value={`${formatNumber(cluster?.nodes_available ?? 0)} / ${formatNumber(cluster?.nodes_total ?? 0)}`} detail="available / total" />
          <Metric icon={<Database size={18} />} label="GPUs" value={formatNumber(cluster?.gpu_free)} detail={`${formatNumber(cluster?.gpu_total)} total`} />
          <Metric icon={<Cpu size={18} />} label="CPUs" value={formatNumber(cluster?.cpus_idle)} detail={`${formatNumber(cluster?.cpus_total)} total`} />
          <Metric icon={<HardDrive size={18} />} label="Memory" value={formatMemory(cluster?.memory_free_mb)} detail="free" />
        </section>
        <NodesSection {...{ filteredNodes, nodeSummary, partitions, gpuTypes, nodeStates, nodePartitionFilter, nodeGpuFilter, nodeStateFilter, nodeQuery, setNodePartitionFilter, setNodeGpuFilter, setNodeStateFilter, setNodeQuery }} />
        <section id="gpus" className="panel">
          <SectionTitle icon={<Database size={18} />} title="GPU Pools" />
          <GpuTable pools={gpuPools} loading={state.loading} />
        </section>
        <section id="partitions" className="panel">
          <SectionTitle icon={<Rows3 size={18} />} title="Partitions" />
          <PartitionMatrix partitions={partitions} />
          <div className="section-subtitle">
            <SectionTitle icon={<Server size={18} />} title="Partition Detail" />
          </div>
          <PartitionTable partitions={partitions} />
        </section>
        <QueueSection {...{ scope, setScope, partitionFilter, gpuFilter, stateFilter, reasonFilter, query, setPartitionFilter, setGpuFilter, setStateFilter, setReasonFilter, setQuery, partitions, gpuTypes, reasons, queuePressure, userWorkload, filteredJobs }} />
        <section id="jobs" className="panel two-column">
          <div>
            <SectionTitle icon={<User size={18} />} title={`My Jobs - ${state.config?.current_user ?? "remote user"}`} />
            <JobRuntimePanel jobs={state.myJobs?.jobs ?? []} />
            <JobList jobs={state.myJobs?.jobs ?? []} onCopy={copyText} alias={alias} />
          </div>
          <div>
            <SectionTitle icon={<AlertTriangle size={18} />} title="Recent History" />
            <HistoryBox history={state.history} />
            <HistoryTable history={state.history} />
          </div>
        </section>
        <section id="tools" className="panel">
          <div className="section-row">
            <SectionTitle icon={<Terminal size={18} />} title="Diagnostics" />
            {copied ? <span className="count-label">Copied {copied}</span> : null}
          </div>
          <div className="tools-grid">
            <SchedulerPanel scheduler={state.insightsData?.scheduler ?? null} />
            <AccountLimitsPanel accountLimits={state.insightsData?.account_limits ?? null} />
            <StoragePanel storage={storageResource.data} alias={alias} onCopy={copyText} />
          </div>
          <CommandList commands={commands} onCopy={copyText} />
          <CacheTable cache={allCache} />
        </section>
      </main>
    </div>
  );
}

function Notices({ error, stale }: { error: string | null; stale: { key: string }[] }) {
  return (
    <>
      {error ? (
        <div className="notice error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {stale.length ? (
        <div className="notice warning" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>Showing cached data for {stale.map((meta) => meta.key).join(", ")}.</span>
        </div>
      ) : null}
    </>
  );
}
