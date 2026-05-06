import { formatMemory, formatNumber } from "../api";
import type { GpuPool, PartitionSummary } from "../types";
import { EmptyState } from "./common";

export function GpuTable({ pools, loading }: { pools: GpuPool[]; loading: boolean }) {
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

export function PartitionMatrix({ partitions }: { partitions: PartitionSummary[] }) {
  if (!partitions.length) return <EmptyState text="No partition matrix available." />;
  return (
    <div className="availability-matrix" aria-label="Partition availability matrix">
      <div className="matrix-row matrix-head">
        <strong>Partition</strong>
        <span>Idle nodes</span>
        <span>Idle CPU</span>
        <span>Free GPU</span>
        <span>Free memory</span>
        <span>Max time</span>
      </div>
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

export function PartitionTable({ partitions }: { partitions: PartitionSummary[] }) {
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
