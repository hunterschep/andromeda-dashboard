import { Terminal } from "lucide-react";
import type { ToolCommand } from "../lib/dashboard";
import type {
  AccountLimits,
  CacheMeta,
  GpuPool,
  HistoryResponse,
  PartitionSummary,
  QueueJob,
  SchedulerHealth,
  StorageResponse
} from "../types";
import { BackfillRecipeBuilder } from "./BackfillRecipeBuilder";
import { CheckpointBudgetPanel } from "./CheckpointBudgetPanel";
import { DataStagingPlanner } from "./DataStagingPlanner";
import { EnvironmentPreflightPanel } from "./EnvironmentPreflightPanel";
import { LaunchReadinessPanel } from "./LaunchReadinessPanel";
import { LimitHeadroomBoard } from "./LimitHeadroomBoard";
import { QuotaBurnForecastPanel } from "./QuotaBurnForecastPanel";
import { RequestPlannerPanel } from "./RequestPlanner";
import { RunStampPanel } from "./RunStampPanel";
import { RunShapeRecommender } from "./RunShapeRecommender";
import { StorageTriagePanel } from "./StorageTriagePanel";
import { SweepGovernorPanel } from "./SweepGovernorPanel";
import { AccountLimitsPanel, CacheTable, CommandList, SchedulerPanel, StoragePanel } from "./Tools";
import { SectionTitle } from "./common";

export function PowerToolsSection({
  copied,
  partitions,
  gpuPools,
  jobs,
  activeJobs,
  history,
  storage,
  accountLimits,
  scheduler,
  alias,
  commands,
  cache,
  onCopy
}: {
  copied: string | null;
  partitions: PartitionSummary[];
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  activeJobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  accountLimits: AccountLimits | null;
  scheduler: SchedulerHealth | null;
  alias: string;
  commands: ToolCommand[];
  cache: CacheMeta[];
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <section id="tools" className="panel">
      <div className="section-row">
        <SectionTitle icon={<Terminal size={18} />} title="Power Tools" />
        {copied ? <span className="count-label">Copied {copied}</span> : null}
      </div>
      <RequestPlannerPanel
        partitions={partitions}
        gpuPools={gpuPools}
        jobs={jobs}
        history={history}
        storage={storage}
        accountLimits={accountLimits}
        alias={alias}
        onCopy={onCopy}
      />
      <RunShapeRecommender history={history} onCopy={onCopy} />
      <SweepGovernorPanel jobs={jobs} history={history} accountLimits={accountLimits} onCopy={onCopy} />
      <LimitHeadroomBoard accountLimits={accountLimits} jobs={activeJobs.length ? activeJobs : jobs} alias={alias} onCopy={onCopy} />
      <EnvironmentPreflightPanel history={history} storage={storage} gpuPools={gpuPools} alias={alias} onCopy={onCopy} />
      <RunStampPanel history={history} storage={storage} gpuPools={gpuPools} onCopy={onCopy} />
      <LaunchReadinessPanel
        gpuPools={gpuPools}
        jobs={jobs}
        history={history}
        storage={storage}
        accountLimits={accountLimits}
        alias={alias}
        onCopy={onCopy}
      />
      <BackfillRecipeBuilder partitions={partitions} gpuPools={gpuPools} jobs={jobs} storage={storage} scheduler={scheduler} onCopy={onCopy} />
      <DataStagingPlanner storage={storage} jobs={jobs} history={history} alias={alias} onCopy={onCopy} />
      <CheckpointBudgetPanel storage={storage} jobs={activeJobs} alias={alias} onCopy={onCopy} />
      <QuotaBurnForecastPanel storage={storage} history={history} alias={alias} onCopy={onCopy} />
      <StoragePanel storage={storage} alias={alias} onCopy={onCopy} />
      <StorageTriagePanel storage={storage} alias={alias} onCopy={onCopy} />
      <div className="tools-grid">
        <SchedulerPanel scheduler={scheduler} />
        <AccountLimitsPanel accountLimits={accountLimits} />
      </div>
      <CommandList commands={commands} onCopy={onCopy} />
      <CacheTable cache={cache} />
    </section>
  );
}
