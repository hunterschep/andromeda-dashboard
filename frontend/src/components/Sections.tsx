import { Filter, ListFilter, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { NodeResource, PartitionSummary, QueueJob } from "../types";
import { EmptyState, FilterSelect, ScopeControl, SectionTitle } from "./common";
import { FleetGrid, NodeSummary, NodeTable } from "./Nodes";
import { QueuePressurePanel, QueueTable, UserWorkloadPanel } from "./Queue";

const NODE_PREVIEW_LIMIT = 80;

type NodeSummaryData = {
  states: [string, number][];
  gpus: [string, number][];
  partitions: [string, number][];
};

export function NodesSection({
  filteredNodes,
  displayedNodes,
  nodeSummary,
  partitions,
  gpuTypes,
  nodeStates,
  nodePartitionFilter,
  nodeGpuFilter,
  nodeStateFilter,
  nodeQuery,
  showAllNodes,
  setNodePartitionFilter,
  setNodeGpuFilter,
  setNodeStateFilter,
  setNodeQuery,
  setShowAllNodes
}: {
  filteredNodes: NodeResource[];
  displayedNodes: NodeResource[];
  nodeSummary: NodeSummaryData;
  partitions: PartitionSummary[];
  gpuTypes: string[];
  nodeStates: string[];
  nodePartitionFilter: string;
  nodeGpuFilter: string;
  nodeStateFilter: string;
  nodeQuery: string;
  showAllNodes: boolean;
  setNodePartitionFilter: (value: string) => void;
  setNodeGpuFilter: (value: string) => void;
  setNodeStateFilter: (value: string) => void;
  setNodeQuery: (value: string) => void;
  setShowAllNodes: Dispatch<SetStateAction<boolean>>;
}) {
  return (
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
      <FleetGrid nodes={filteredNodes} />
      <NodeSummary summary={nodeSummary} />
      <NodeTable nodes={displayedNodes} />
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
  reasons,
  queuePressure,
  userWorkload,
  filteredJobs
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
  reasons: string[];
  queuePressure: QueuePressure;
  userWorkload: UserWorkload[];
  filteredJobs: QueueJob[];
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
      <QueueTable jobs={filteredJobs} />
    </section>
  );
}

export { NODE_PREVIEW_LIMIT };
