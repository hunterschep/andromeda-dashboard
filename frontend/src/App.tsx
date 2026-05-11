import { AlertTriangle } from "lucide-react";
import { lazy, Suspense, type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityFeed } from "./components/ActivityFeed";
import { ActionRunlistPanel } from "./components/ActionRunlistPanel";
import { ComputeCommitmentPanel } from "./components/ComputeCommitmentPanel";
import { DataFreshnessPanel } from "./components/DataFreshnessPanel";
import { ExecutiveCommand } from "./components/ExecutiveCommand";
import { SectionTitle, StatusLine } from "./components/common";
import { CommandDeck } from "./components/Intelligence";
import { OpsBriefPanel } from "./components/OpsBriefPanel";
import { PredictionPanel } from "./components/PredictionPanel";
import { PressureAnomalyPanel } from "./components/PressureAnomalyPanel";
import { PressureCalendarPanel } from "./components/PressureCalendarPanel";
import { ReplayDeltaPanel } from "./components/ReplayDeltaPanel";
import { RefreshHealthPanel } from "./components/RefreshHealthPanel";
import { SchedulerWeatherPanel } from "./components/SchedulerWeatherPanel";
import { Sidebar, Topbar } from "./components/Shell";
import { SubmitWindowAdvisorPanel } from "./components/SubmitWindowAdvisorPanel";
import { TelemetryPanel } from "./components/TelemetryPanel";
import { InsightsList } from "./components/Tools";
import { useDashboardSnapshot } from "./hooks/useDashboardSnapshot";
import { useActivityFeed } from "./hooks/useActivityFeed";
import { useQueuePrediction } from "./hooks/useQueuePrediction";
import { useStorage } from "./hooks/useStorage";
import { useTelemetry } from "./hooks/useTelemetry";
import { buildAndromedaIntelligence } from "./lib/intelligence";
import {
  buildCommands,
  dedupeCache,
  fallbackCopy,
  summarizeNodes,
  summarizeQueuePressure,
  summarizeUsers
} from "./lib/dashboard";

const NodesSection = lazy(() => import("./components/Sections").then((module) => ({ default: module.NodesSection })));
const GpuSection = lazy(() => import("./components/GpuSection").then((module) => ({ default: module.GpuSection })));
const PartitionSection = lazy(() => import("./components/PartitionSection").then((module) => ({ default: module.PartitionSection })));
const QueueSection = lazy(() => import("./components/Sections").then((module) => ({ default: module.QueueSection })));
const JobsSection = lazy(() => import("./components/JobsSection").then((module) => ({ default: module.JobsSection })));
const PowerToolsSection = lazy(() => import("./components/PowerToolsSection").then((module) => ({ default: module.PowerToolsSection })));

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
  const gpuTypes = state.resources?.gpu_pools.map((pool) => pool.type) ?? [];
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
  const activityEvents = useActivityFeed({
    resources: state.resources,
    queue: state.queue,
    loadedAt: state.loadedAt
  });
  const telemetryResource = useTelemetry(state.queue?.scope ?? scope, state.loadedAt);
  const predictionResource = useQueuePrediction(state.queue?.scope ?? scope, state.loadedAt);
  const storageResource = useStorage(state.loadedAt);
  const telemetry = telemetryResource.data;
  const prediction = predictionResource.data;
  const storage = storageResource.data;
  const intelligence = useMemo(
    () =>
      buildAndromedaIntelligence({
        nodes,
        gpuPools: state.resources?.gpu_pools ?? [],
        partitions,
        jobs: state.queue?.jobs ?? [],
        history: state.history,
        scheduler: state.insightsData?.scheduler ?? null
      }),
    [nodes, partitions, state.queue, state.resources, state.history, state.insightsData]
  );
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
    <div className="app-shell executive-ui">
      <Sidebar alias={alias} config={state.config} />
      <main>
        <Topbar alias={alias} user={state.config?.current_user ?? "remote user"} scope={state.queue?.scope ?? scope} onExport={exportSnapshot} onRefresh={() => void load(scope)} />
        <StatusLine loadedAt={state.loadedAt} loading={state.loading} staleCount={stale.length} cacheCount={allCache.length} scope={state.queue?.scope ?? scope} refreshCadence={refreshCadence} onRefreshCadence={setRefreshCadence} />
        <Notices error={state.error} stale={stale} />
        <ExecutiveCommand
          cluster={cluster}
          gpuPools={state.resources?.gpu_pools ?? []}
          jobs={state.queue?.jobs ?? []}
          scheduler={state.insightsData?.scheduler ?? undefined}
          cache={allCache}
          loading={state.loading}
          loadedAt={state.loadedAt}
        />
        <CommandDeck intelligence={intelligence} scheduler={state.insightsData?.scheduler ?? null}>
          <ActivityFeed events={activityEvents} />
          <DataFreshnessPanel cache={allCache} loadedAt={state.loadedAt} loading={state.loading} error={state.error} alias={alias} onCopy={copyText} />
          <RefreshHealthPanel loadedAt={state.loadedAt} loading={state.loading} error={state.error} cache={allCache} cadence={refreshCadence} telemetry={telemetryResource} prediction={predictionResource} storage={storageResource} />
          <OpsBriefPanel jobs={state.queue?.jobs ?? []} gpuPools={state.resources?.gpu_pools ?? []} nodes={nodes} history={state.history} cache={allCache} onCopy={copyText} />
          <ActionRunlistPanel
            jobs={state.queue?.jobs ?? []}
            myJobs={state.myJobs?.jobs ?? []}
            gpuPools={state.resources?.gpu_pools ?? []}
            storage={storage}
            cache={allCache}
            prediction={prediction}
            alias={alias}
            onCopy={copyText}
          />
          <TelemetryPanel telemetry={telemetry} />
          <ReplayDeltaPanel telemetry={telemetry} />
          <PressureCalendarPanel telemetry={telemetry} />
          <SubmitWindowAdvisorPanel telemetry={telemetry} jobs={state.queue?.jobs ?? []} history={state.history} gpuPools={state.resources?.gpu_pools ?? []} alias={alias} onCopy={copyText} />
          <PressureAnomalyPanel telemetry={telemetry} />
          <PredictionPanel prediction={prediction} />
          <SchedulerWeatherPanel scheduler={state.insightsData?.scheduler ?? null} pendingJobs={state.queue?.pending ?? 0} alias={alias} onCopy={copyText} />
          <ComputeCommitmentPanel jobs={state.queue?.jobs ?? []} />
        </CommandDeck>
        <LazySection label="Node Explorer">
          <NodesSection {...{ filteredNodes, allNodes: nodes, nodeSummary, partitions, gpuTypes, nodeStates, nodePartitionFilter, nodeGpuFilter, nodeStateFilter, nodeQuery, jobs: state.queue?.jobs ?? [], alias, onCopy: copyText, setNodePartitionFilter, setNodeGpuFilter, setNodeStateFilter, setNodeQuery }} />
        </LazySection>
        <LazySection label="GPU Availability">
          <GpuSection nodes={nodes} pools={state.resources?.gpu_pools ?? []} jobs={state.queue?.jobs ?? []} scarcity={intelligence.gpuScarcity} loading={state.loading} alias={alias} onCopy={copyText} />
        </LazySection>
        <LazySection label="Partition Matrix">
          <PartitionSection partitions={partitions} jobs={state.queue?.jobs ?? []} alias={alias} onCopy={copyText} />
        </LazySection>
        <LazySection label="Queue Explorer">
          <QueueSection {...{ scope, setScope, partitionFilter, gpuFilter, stateFilter, reasonFilter, query, setPartitionFilter, setGpuFilter, setStateFilter, setReasonFilter, setQuery, partitions, gpuTypes, nodes, reasons, queuePressure, userWorkload, filteredJobs, forecast: intelligence.queue, history: state.history, prediction, priorityJobs: state.insightsData?.priority_jobs ?? [], scheduler: state.insightsData?.scheduler ?? null, alias, onCopy: copyText }} />
        </LazySection>
        <LazySection label="My Jobs">
          <JobsSection currentUser={state.config?.current_user ?? "remote user"} myJobs={state.myJobs} history={state.history} storage={storage} alias={alias} onCopy={copyText} />
        </LazySection>
        <section id="insights" className="panel">
          <SectionTitle icon={<AlertTriangle size={18} />} title="Insights" />
          <InsightsList insights={state.insightsData?.insights ?? []} />
        </section>
        <LazySection label="Power Tools">
          <PowerToolsSection
            copied={copied}
            partitions={partitions}
            gpuPools={state.resources?.gpu_pools ?? []}
            jobs={state.queue?.jobs ?? []}
            activeJobs={state.myJobs?.jobs ?? []}
            history={state.history}
            storage={storage}
            accountLimits={state.insightsData?.account_limits ?? null}
            scheduler={state.insightsData?.scheduler ?? null}
            alias={alias}
            commands={commands}
            cache={allCache}
            onCopy={copyText}
          />
        </LazySection>
      </main>
    </div>
  );
}

function LazySection({ label, children }: { label: string; children: ReactNode }) {
  return <Suspense fallback={<SectionFallback label={label} />}>{children}</Suspense>;
}

function SectionFallback({ label }: { label: string }) {
  return (
    <section className="panel section-loading" aria-label={`${label} loading`}>
      <span>{label} loading</span>
    </section>
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
