import { useEffect, useMemo, useState } from "react";
import { formatMemory, formatNumber } from "../api";
import { fleetClass, gpuInventoryText, stateText } from "../lib/dashboard";
import type { NodeResource } from "../types";
import { EmptyState } from "./common";

type FleetGroup = {
  label: string;
  nodes: NodeResource[];
  gpuNodes: number;
  available: number;
  idleCpu: number;
  freeGpu: number;
  freeMem: number;
};

export function FleetMap({ nodes }: { nodes: NodeResource[] }) {
  const groups = useMemo(() => groupFleet(nodes), [nodes]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected =
    nodes.find((node) => node.name === selectedName) ?? groups[0]?.nodes[0] ?? null;

  useEffect(() => {
    if (!selectedName || !nodes.some((node) => node.name === selectedName)) {
      setSelectedName(groups[0]?.nodes[0]?.name ?? null);
    }
  }, [groups, nodes, selectedName]);

  if (!nodes.length) return <EmptyState text="No nodes match the current filters." />;
  return (
    <div className="fleet-panel">
      <div className="fleet-head">
        <div className="section-title inline-title">
          <h2>Fleet Map</h2>
        </div>
        <FleetLegend />
      </div>
      <div className="fleet-map">
        <div className="fleet-lanes">
          {groups.map((group) => (
            <section className="fleet-lane" key={group.label}>
              <div className="fleet-lane-head">
                <strong>{group.label}</strong>
                <div className="fleet-lane-metrics">
                  <span>
                    <b>{group.nodes.length}</b> nodes
                  </span>
                  <span>
                    <b>{group.available}</b> usable
                  </span>
                  <span>
                    <b>{formatNumber(group.idleCpu)}</b> idle CPU
                  </span>
                  {group.gpuNodes ? (
                    <span>
                      <b>{group.freeGpu}</b> free GPU
                    </span>
                  ) : null}
                  <span>
                    <b>{formatMemory(group.freeMem)}</b> free mem
                  </span>
                </div>
              </div>
              <div className="fleet-lane-grid" role="list" aria-label={`${group.label} nodes`}>
                {group.nodes.map((node) => (
                  <button
                    type="button"
                    key={node.name}
                    role="listitem"
                    className={`fleet-cell ${fleetClass(node)} ${node.gpu_total ? "has-gpu" : ""} ${selected?.name === node.name ? "active" : ""}`}
                    title={`${node.name} / ${stateText(node)} / ${node.cpus_idle} idle CPU / ${node.gpu_free} free GPU`}
                    onClick={() => setSelectedName(node.name)}
                  >
                    <span className="sr-only">{node.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <FleetInspector node={selected} />
      </div>
    </div>
  );
}

function FleetInspector({ node }: { node: NodeResource | null }) {
  if (!node) return <EmptyState text="No node selected." />;
  return (
    <aside className="fleet-inspector" aria-label="Selected node">
      <div>
        <span>Selected</span>
        <strong className="mono">{node.name}</strong>
      </div>
      <dl>
        <div>
          <dt>State</dt>
          <dd>{stateText(node)}</dd>
        </div>
        <div>
          <dt>Partitions</dt>
          <dd>{node.partitions.join(", ") || "n/a"}</dd>
        </div>
        <div>
          <dt>CPU</dt>
          <dd>
            {node.cpus_idle} idle / {node.cpus_total}
          </dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>{formatMemory(node.memory_free_mb)}</dd>
        </div>
        <div>
          <dt>GPU</dt>
          <dd>{gpuInventoryText(node)}</dd>
        </div>
        <div>
          <dt>Features</dt>
          <dd>{node.features.slice(0, 6).join(", ") || "n/a"}</dd>
        </div>
      </dl>
      {node.reason ? <p>{node.reason}</p> : null}
    </aside>
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
      <span>outline = GPU node</span>
    </div>
  );
}

function groupFleet(nodes: NodeResource[]): FleetGroup[] {
  const groups = new Map<string, NodeResource[]>();
  for (const node of nodes) {
    const label = node.gpu_types.length ? node.gpu_types.join(" / ") : "CPU only";
    groups.set(label, [...(groups.get(label) ?? []), node]);
  }
  return Array.from(groups.entries())
    .map(([label, groupNodes]) => ({
      label,
      nodes: groupNodes.sort((left, right) => left.name.localeCompare(right.name)),
      gpuNodes: groupNodes.filter((node) => node.gpu_total > 0).length,
      available: groupNodes.filter((node) => node.is_available).length,
      idleCpu: groupNodes.reduce((sum, node) => sum + (node.is_available ? node.cpus_idle : 0), 0),
      freeGpu: groupNodes.reduce((sum, node) => sum + (node.is_available ? node.gpu_free : 0), 0),
      freeMem: groupNodes.reduce(
        (sum, node) => sum + (node.is_available ? (node.memory_free_mb ?? 0) : 0),
        0
      )
    }))
    .sort((left, right) => Number(left.label === "CPU only") - Number(right.label === "CPU only") || right.freeGpu - left.freeGpu || right.available - left.available || left.label.localeCompare(right.label));
}
