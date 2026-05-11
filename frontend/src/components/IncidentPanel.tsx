import { Siren } from "lucide-react";
import { formatMemory, formatNumber } from "../api";
import { stateText } from "../lib/dashboard";
import type { NodeResource } from "../types";
import { EmptyState, SectionTitle } from "./common";

type Incident = {
  key: string;
  label: string;
  severity: "info" | "warning" | "critical";
  nodes: NodeResource[];
  cpus: number;
  gpus: number;
  memoryMb: number;
  partitions: string[];
};

export function IncidentPanel({ nodes }: { nodes: NodeResource[] }) {
  const incidents = buildIncidents(nodes);
  return (
    <section className="incident-panel" aria-label="Infrastructure incidents">
      <div className="incident-head">
        <SectionTitle icon={<Siren size={18} />} title="Infrastructure Incidents" />
        <span>{incidents.length ? `${incidents.length} active groups` : "clear"}</span>
      </div>
      {incidents.length ? (
        <div className="incident-list">
          {incidents.slice(0, 5).map((incident) => (
            <article key={incident.key} className={`incident-row severity-${incident.severity}`}>
              <div className="incident-title">
                <div>
                  <strong>{incident.label}</strong>
                  <span>{incident.nodes.map((node) => node.name).slice(0, 4).join(", ")}</span>
                </div>
                <em>{incident.nodes.length} node{incident.nodes.length === 1 ? "" : "s"}</em>
              </div>
              <dl>
                <div>
                  <dt>CPU affected</dt>
                  <dd>{formatNumber(incident.cpus)}</dd>
                </div>
                <div>
                  <dt>GPU affected</dt>
                  <dd>{incident.gpus}</dd>
                </div>
                <div>
                  <dt>memory</dt>
                  <dd>{formatMemory(incident.memoryMb)}</dd>
                </div>
                <div>
                  <dt>partitions</dt>
                  <dd>{incident.partitions.slice(0, 4).join(", ") || "n/a"}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No down, drained, failing, or reason-tagged nodes in this view." />
      )}
    </section>
  );
}

function buildIncidents(nodes: NodeResource[]): Incident[] {
  const groups = new Map<string, NodeResource[]>();
  for (const node of nodes) {
    if (!isIncident(node)) continue;
    const key = node.reason?.trim() || stateText(node);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => incidentFromGroup(key, group))
    .sort((left, right) => severityRank(right) - severityRank(left) || right.gpus - left.gpus || right.cpus - left.cpus);
}

function incidentFromGroup(key: string, nodes: NodeResource[]): Incident {
  return {
    key,
    label: key,
    severity: severityFor(nodes),
    nodes,
    cpus: nodes.reduce((sum, node) => sum + node.cpus_total, 0),
    gpus: nodes.reduce((sum, node) => sum + node.gpu_total, 0),
    memoryMb: nodes.reduce((sum, node) => sum + node.memory_total_mb, 0),
    partitions: Array.from(new Set(nodes.flatMap((node) => node.partitions))).sort()
  };
}

function isIncident(node: NodeResource): boolean {
  const text = stateText(node).toLowerCase();
  return Boolean(node.reason) || /down|drain|fail|maint|no_respond|power/.test(text);
}

function severityFor(nodes: NodeResource[]): Incident["severity"] {
  const text = nodes.map((node) => stateText(node)).join(" ").toLowerCase();
  if (/down|fail|no_respond/.test(text)) return "critical";
  if (/drain|maint/.test(text)) return "warning";
  return "info";
}

function severityRank(incident: Incident): number {
  return { info: 0, warning: 1, critical: 2 }[incident.severity];
}
