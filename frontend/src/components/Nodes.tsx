import { Network } from "lucide-react";
import { formatMemory } from "../api";
import { fleetClass, gpuInventoryText, stateText } from "../lib/dashboard";
import type { NodeResource } from "../types";
import { EmptyState } from "./common";

export function FleetGrid({ nodes }: { nodes: NodeResource[] }) {
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

export function NodeSummary({
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

export function NodeTable({ nodes }: { nodes: NodeResource[] }) {
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
