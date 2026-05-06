import { ArrowDown, ArrowDownUp, ArrowUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatMemory } from "../api";
import { gpuInventoryText, stateText } from "../lib/dashboard";
import type { NodeResource } from "../types";
import { EmptyState } from "./common";

const PAGE_SIZE = 20;
type SortKey = "name" | "state" | "partition" | "idleCpu" | "freeMem" | "freeGpu";

export function NodeTable({ nodes }: { nodes: NodeResource[] }) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    setPage(0);
  }, [nodes, sortKey, sortDir]);

  const sortedNodes = useMemo(() => sortNodes(nodes, sortKey, sortDir), [nodes, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sortedNodes.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageNodes = sortedNodes.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (!nodes.length) return <EmptyState text="No nodes match the current filters." />;
  const start = safePage * PAGE_SIZE + 1;
  const end = Math.min(sortedNodes.length, start + PAGE_SIZE - 1);
  return (
    <div className="node-table-block">
      <div className="table-toolbar">
        <span>
          {start}-{end} of {sortedNodes.length}
        </span>
        <div>
          <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={safePage === 0}>
            Previous
          </button>
          <span>
            Page {safePage + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
            disabled={safePage >= totalPages - 1}
          >
            Next
          </button>
        </div>
      </div>
      <div className="table-wrap node-table">
        <table>
          <thead>
            <tr>
              <SortableTh label="Node" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={setSort} />
              <SortableTh label="State" sortKey="state" activeKey={sortKey} dir={sortDir} onSort={setSort} />
              <SortableTh label="Partitions" sortKey="partition" activeKey={sortKey} dir={sortDir} onSort={setSort} />
              <SortableTh label="Idle CPU" sortKey="idleCpu" activeKey={sortKey} dir={sortDir} onSort={setSort} />
              <SortableTh label="Free Mem" sortKey="freeMem" activeKey={sortKey} dir={sortDir} onSort={setSort} />
              <SortableTh label="Free GPU" sortKey="freeGpu" activeKey={sortKey} dir={sortDir} onSort={setSort} />
              <th>Features</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {pageNodes.map((node) => (
              <tr key={node.name}>
                <td className="mono">{node.name}</td>
                <td>{stateText(node)}</td>
                <td>{node.partitions.join(", ") || "n/a"}</td>
                <td>
                  {node.cpus_idle} / {node.cpus_total}
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
    </div>
  );

  function setSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(defaultSortDir(nextKey));
    }
  }
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <th>
      <button type="button" className="sort-button" onClick={() => onSort(sortKey)}>
        {label}
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ArrowDownUp size={12} aria-hidden="true" />;
  return dir === "asc" ? (
    <ArrowUp size={12} aria-hidden="true" />
  ) : (
    <ArrowDown size={12} aria-hidden="true" />
  );
}

function sortNodes(nodes: NodeResource[], key: SortKey, dir: "asc" | "desc") {
  const direction = dir === "asc" ? 1 : -1;
  return nodes.slice().sort((left, right) => {
    const leftValue = sortValue(left, key);
    const rightValue = sortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return (leftValue - rightValue) * direction || left.name.localeCompare(right.name);
    }
    return (
      String(leftValue).localeCompare(String(rightValue)) * direction ||
      left.name.localeCompare(right.name)
    );
  });
}

function sortValue(node: NodeResource, key: SortKey): string | number {
  if (key === "name") return node.name;
  if (key === "state") return stateText(node);
  if (key === "partition") return node.partitions[0] ?? "";
  if (key === "idleCpu") return node.cpus_idle;
  if (key === "freeMem") return node.memory_free_mb ?? -1;
  return node.gpu_free;
}

function defaultSortDir(key: SortKey): "asc" | "desc" {
  return key === "name" || key === "state" || key === "partition" ? "asc" : "desc";
}
