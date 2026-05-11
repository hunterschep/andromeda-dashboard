import { Filter, ListFilter, Search } from "lucide-react";
import type { QueueForecast } from "../lib/intelligence";
import type { HistoryResponse, NodeResource, PartitionSummary, PriorityJob, QueueJob, QueuePredictionResponse, SchedulerHealth } from "../types";
import { BackfillPanel } from "./BackfillPanel";
import { BackfillSlotBoard } from "./BackfillSlotBoard";
import { AllocationConstellationPanel } from "./AllocationConstellationPanel";
import { CapacityLossLedger } from "./CapacityLossLedger";
import { ContentionPanel } from "./ContentionPanel";
import { DependencyChainAuditor } from "./DependencyChainAuditor";
import { DependencyRadarPanel } from "./DependencyRadarPanel";
import { FilterSelect, ScopeControl, SectionTitle } from "./common";
import { FleetMap } from "./FleetMap";
import { IncidentPanel } from "./IncidentPanel";
import { QueueForecastPanel } from "./Intelligence";
import { LabFootprintPanel } from "./LabFootprintPanel";
import { NodeClassAtlas } from "./NodeClassAtlas";
import { NodeNeighborhoodMap } from "./NodeNeighborhoodMap";
import { NodeSummary } from "./Nodes";
import { NodeTable } from "./NodeTable";
import { PartitionStrategyPanel } from "./PartitionStrategyPanel";
import { PolicyConstraintDecoderPanel } from "./PolicyConstraintDecoderPanel";
import { PriorityFactorsPanel } from "./PriorityFactorsPanel";
import { PriorityOrderBookPanel } from "./PriorityOrderBookPanel";
import { QueueMotionPanel } from "./QueueMotionPanel";
import { QueueConfidenceLedger } from "./QueueConfidenceLedger";
import { QueuePressurePanel, QueueTable, ReasonDecoderPanel, UserWorkloadPanel } from "./Queue";
import { QueueRunwayPanel } from "./QueueRunwayPanel";
import { QueueShapeMixPanel } from "./QueueShapeMixPanel";
import { QueueStorylinePanel } from "./QueueStorylinePanel";
import { QueueTrafficFlowPanel } from "./QueueTrafficFlowPanel";
import { RequestSurgeryPanel } from "./RequestSurgeryPanel";
import { SchedulerWeightCompass } from "./SchedulerWeightCompass";
import { StartPathDecoderPanel } from "./StartPathDecoderPanel";
import { WaitBudgetPanel } from "./WaitBudgetPanel";
import { WaitDoctorPanel } from "./WaitDoctorPanel";
import { WalltimePanel } from "./WalltimePanel";

type NodeSummaryData = {
  states: [string, number][];
  gpus: [string, number][];
  partitions: [string, number][];
};

export function NodesSection({
  filteredNodes,
  allNodes,
  nodeSummary,
  partitions,
  gpuTypes,
  nodeStates,
  nodePartitionFilter,
  nodeGpuFilter,
  nodeStateFilter,
  nodeQuery,
  jobs,
  alias,
  onCopy,
  setNodePartitionFilter,
  setNodeGpuFilter,
  setNodeStateFilter,
  setNodeQuery
}: {
  filteredNodes: NodeResource[];
  allNodes: NodeResource[];
  nodeSummary: NodeSummaryData;
  partitions: PartitionSummary[];
  gpuTypes: string[];
  nodeStates: string[];
  nodePartitionFilter: string;
  nodeGpuFilter: string;
  nodeStateFilter: string;
  nodeQuery: string;
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
  setNodePartitionFilter: (value: string) => void;
  setNodeGpuFilter: (value: string) => void;
  setNodeStateFilter: (value: string) => void;
  setNodeQuery: (value: string) => void;
}) {
  return (
    <section id="nodes" className="panel">
      <div className="section-row">
        <SectionTitle icon={<ListFilter size={18} />} title="Node Explorer" />
        <div className="section-actions">
          <span className="count-label">{filteredNodes.length} matched</span>
        </div>
      </div>
      <div className="filters node-filters">
        <FilterSelect
          label="Partition"
          value={nodePartitionFilter}
          onChange={setNodePartitionFilter}
          options={partitions.map((partition) => partition.name)}
        />
        <FilterSelect label="GPU" value={nodeGpuFilter} onChange={setNodeGpuFilter} options={gpuTypes} />
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
      <FleetMap nodes={filteredNodes} />
      <AllocationConstellationPanel nodes={filteredNodes} jobs={jobs} alias={alias} onCopy={onCopy} />
      <NodeNeighborhoodMap nodes={filteredNodes} jobs={jobs} alias={alias} onCopy={onCopy} />
      <NodeClassAtlas nodes={filteredNodes} />
      <IncidentPanel nodes={allNodes} />
      <CapacityLossLedger nodes={allNodes} jobs={jobs} alias={alias} onCopy={onCopy} />
      <NodeSummary summary={nodeSummary} />
      <NodeTable nodes={filteredNodes} />
    </section>
  );
}

type QueuePressure = {
  running: number;
  pending: number;
  pendingCpus: number;
  pendingGpus: number;
  reasons: [string, number][];
  partitions: [string, number][];
  gpus: [string, number][];
};

type UserWorkload = {
  user: string;
  running: number;
  pending: number;
  cpus: number;
  gpus: number;
};

export function QueueSection({
  scope,
  setScope,
  partitionFilter,
  gpuFilter,
  stateFilter,
  reasonFilter,
  query,
  setPartitionFilter,
  setGpuFilter,
  setStateFilter,
  setReasonFilter,
  setQuery,
  partitions,
  gpuTypes,
  nodes,
  reasons,
  queuePressure,
  userWorkload,
  filteredJobs,
  forecast,
  history,
  prediction,
  priorityJobs,
  scheduler,
  alias,
  onCopy
}: {
  scope: "mine" | "lab" | "cluster";
  setScope: (value: "mine" | "lab" | "cluster") => void;
  partitionFilter: string;
  gpuFilter: string;
  stateFilter: string;
  reasonFilter: string;
  query: string;
  setPartitionFilter: (value: string) => void;
  setGpuFilter: (value: string) => void;
  setStateFilter: (value: string) => void;
  setReasonFilter: (value: string) => void;
  setQuery: (value: string) => void;
  partitions: PartitionSummary[];
  gpuTypes: string[];
  nodes: NodeResource[];
  reasons: string[];
  queuePressure: QueuePressure;
  userWorkload: UserWorkload[];
  filteredJobs: QueueJob[];
  forecast: QueueForecast;
  history: HistoryResponse | null;
  prediction: QueuePredictionResponse | null;
  priorityJobs: PriorityJob[];
  scheduler: SchedulerHealth | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  return (
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
        <FilterSelect label="Reason" value={reasonFilter} onChange={setReasonFilter} options={reasons} />
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
      <LabFootprintPanel jobs={filteredJobs} />
      <QueueShapeMixPanel jobs={filteredJobs} />
      <QueueTrafficFlowPanel jobs={filteredJobs} alias={alias} onCopy={onCopy} />
      <QueueConfidenceLedger jobs={filteredJobs} priorityJobs={priorityJobs} scheduler={scheduler} history={history} prediction={prediction} alias={alias} onCopy={onCopy} />
      <QueueStorylinePanel jobs={filteredJobs} nodes={nodes} partitions={partitions} priorityJobs={priorityJobs} alias={alias} onCopy={onCopy} />
      <WaitBudgetPanel jobs={filteredJobs} history={history} alias={alias} onCopy={onCopy} />
      <StartPathDecoderPanel jobs={filteredJobs} nodes={nodes} priorityJobs={priorityJobs} scheduler={scheduler} alias={alias} onCopy={onCopy} />
      <WaitDoctorPanel jobs={filteredJobs} nodes={nodes} partitions={partitions} priorityJobs={priorityJobs} alias={alias} onCopy={onCopy} />
      <RequestSurgeryPanel jobs={filteredJobs} nodes={nodes} partitions={partitions} alias={alias} onCopy={onCopy} />
      <PolicyConstraintDecoderPanel jobs={filteredJobs} nodes={nodes} partitions={partitions} alias={alias} onCopy={onCopy} />
      <ReasonDecoderPanel jobs={filteredJobs} />
      <DependencyRadarPanel jobs={filteredJobs} alias={alias} onCopy={onCopy} />
      <DependencyChainAuditor jobs={filteredJobs} history={history} alias={alias} onCopy={onCopy} />
      <QueueMotionPanel jobs={filteredJobs} alias={alias} onCopy={onCopy} />
      <BackfillSlotBoard nodes={nodes} partitions={partitions} scheduler={scheduler} alias={alias} onCopy={onCopy} />
      <BackfillPanel nodes={nodes} partitions={partitions} jobs={filteredJobs} />
      <PartitionStrategyPanel jobs={filteredJobs} partitions={partitions} />
      <WalltimePanel jobs={filteredJobs} partitions={partitions} />
      <PriorityFactorsPanel jobs={filteredJobs} priorityJobs={priorityJobs} />
      <PriorityOrderBookPanel jobs={filteredJobs} priorityJobs={priorityJobs} alias={alias} onCopy={onCopy} />
      <SchedulerWeightCompass scheduler={scheduler} jobs={filteredJobs} priorityJobs={priorityJobs} alias={alias} onCopy={onCopy} />
      <ContentionPanel partitions={partitions} nodes={nodes} jobs={filteredJobs} />
      <QueueForecastPanel forecast={forecast} />
      <QueueRunwayPanel jobs={filteredJobs} />
      <QueueTable jobs={filteredJobs} />
    </section>
  );
}
