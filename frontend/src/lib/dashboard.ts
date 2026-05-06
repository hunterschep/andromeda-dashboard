import type { CacheMeta, NodeResource, QueueJob } from "../types";

export type ToolCommand = {
  id: string;
  group: string;
  label: string;
  command: string;
  description: string;
};

export function stateText(node: NodeResource): string {
  return [node.state, ...node.state_flags].join("+");
}

export function gpuInventoryText(node: NodeResource): string {
  if (!node.gres.length) return "none";
  return node.gres.map((gpu) => `${gpu.type} ${gpu.free}/${gpu.total}`).join(", ");
}

export function fleetClass(node: NodeResource): string {
  const state = stateText(node).toLowerCase();
  if (state.includes("down") || state.includes("fail")) return "is-down";
  if (state.includes("drain")) return "is-drain";
  if (state.includes("mixed")) return "is-mixed";
  if (state.includes("alloc")) return "is-allocated";
  if (state.includes("idle")) return "is-idle";
  return "is-other";
}

export function secondsText(value: number | null): string {
  if (value === null || value === undefined) return "n/a";
  return `${value.toFixed(2)}s`;
}

export function tresText(values: Record<string, string>): string {
  const entries = Object.entries(values);
  if (!entries.length) return "n/a";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function dedupeCache(cache: CacheMeta[]): CacheMeta[] {
  const byKey = new Map<string, CacheMeta>();
  for (const meta of cache) byKey.set(meta.key, meta);
  return Array.from(byKey.values()).sort((left, right) => left.key.localeCompare(right.key));
}

export function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function buildCommands(alias: string): ToolCommand[] {
  return [
    {
      id: "identity",
      group: "ssh",
      label: "Identity Probe",
      command: `ssh ${alias} 'hostname; whoami; pwd; sinfo --version; squeue -u "$USER"'`,
      description: "Validate alias, identity, Slurm version, and your queue."
    },
    {
      id: "quota",
      group: "storage",
      label: "Quota Check",
      command: `ssh ${alias} 'acct-chk "$USER"; squeue -u "$USER"'`,
      description: "Check storage/account status before larger data movement."
    },
    {
      id: "nodes",
      group: "slurm",
      label: "Node JSON",
      command: `ssh ${alias} 'scontrol show nodes --json | jq ".nodes | length"'`,
      description: "Confirm the node inventory endpoint and count returned nodes."
    },
    {
      id: "queue",
      group: "slurm",
      label: "Queue JSON",
      command: `ssh ${alias} 'squeue --json | jq ".jobs | length"'`,
      description: "Confirm live queue JSON and count visible jobs."
    },
    {
      id: "starts",
      group: "slurm",
      label: "Start Estimates",
      command: `ssh ${alias} 'squeue --start --json | jq ".jobs[:10]"'`,
      description: "Inspect Slurm start estimates for the first visible pending jobs."
    },
    {
      id: "history",
      group: "accounting",
      label: "Recent History",
      command: `ssh ${alias} 'sacct --json -S now-7days -n -X | jq ".jobs | length"'`,
      description: "Check accounting visibility for the current seven-day window."
    },
    {
      id: "scheduler",
      group: "scheduler",
      label: "Scheduler Health",
      command: `ssh ${alias} 'sdiag; sprio -w'`,
      description: "Show scheduler cycle/backfill stats and priority factor weights."
    },
    {
      id: "qos",
      group: "limits",
      label: "QOS Limits",
      command: `ssh ${alias} 'sacctmgr show qos format=Name,MaxJobsPU,MaxSubmitPU,MaxTRESPU -P -n'`,
      description: "Review per-user job, submission, CPU, GPU, and memory caps."
    }
  ];
}

export function summarizeNodes(nodes: NodeResource[]) {
  const states = new Map<string, number>();
  const gpus = new Map<string, number>();
  const partitions = new Map<string, number>();
  for (const node of nodes) {
    states.set(node.state, (states.get(node.state) ?? 0) + 1);
    for (const gpu of node.gpu_types.length ? node.gpu_types : ["cpu-only"]) {
      gpus.set(gpu, (gpus.get(gpu) ?? 0) + 1);
    }
    for (const partition of node.partitions.length ? node.partitions : ["unassigned"]) {
      partitions.set(partition, (partitions.get(partition) ?? 0) + 1);
    }
  }
  return { states: rankEntries(states), gpus: rankEntries(gpus), partitions: rankEntries(partitions) };
}

export function summarizeQueuePressure(jobs: QueueJob[]) {
  const reasons = new Map<string, number>();
  const partitions = new Map<string, number>();
  const gpus = new Map<string, number>();
  let running = 0;
  let pending = 0;
  let pendingCpus = 0;
  let pendingGpus = 0;

  for (const job of jobs) {
    if (job.state === "RUNNING") running += 1;
    if (job.state === "PENDING") {
      pending += 1;
      pendingCpus += job.cpus;
      pendingGpus += job.gpu_count;
      const reason = job.reason_label ?? job.state_reason ?? "not specified";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    partitions.set(job.partition ?? "none", (partitions.get(job.partition ?? "none") ?? 0) + 1);
    if (job.gpus.length) {
      for (const gpu of job.gpus) gpus.set(gpu.type, (gpus.get(gpu.type) ?? 0) + gpu.count);
    } else {
      gpus.set("cpu-only", (gpus.get("cpu-only") ?? 0) + 1);
    }
  }

  return {
    running,
    pending,
    pendingCpus,
    pendingGpus,
    reasons: rankEntries(reasons),
    partitions: rankEntries(partitions),
    gpus: rankEntries(gpus)
  };
}

export function summarizeUsers(jobs: QueueJob[]) {
  const byUser = new Map<string, { user: string; running: number; pending: number; cpus: number; gpus: number }>();
  for (const job of jobs) {
    const current = byUser.get(job.user) ?? { user: job.user, running: 0, pending: 0, cpus: 0, gpus: 0 };
    if (job.state === "RUNNING") current.running += 1;
    if (job.state === "PENDING") current.pending += 1;
    current.cpus += job.cpus;
    current.gpus += job.gpu_count;
    byUser.set(job.user, current);
  }
  return Array.from(byUser.values()).sort(
    (left, right) =>
      right.running + right.pending - (left.running + left.pending) ||
      right.gpus - left.gpus ||
      right.cpus - left.cpus ||
      left.user.localeCompare(right.user)
  );
}

export function rankEntries(values: Map<string, number>): [string, number][] {
  return Array.from(values.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
  );
}

export function jobSortScore(job: QueueJob): number {
  const stateWeight = job.state === "RUNNING" ? 10_000 : job.state === "PENDING" ? 5_000 : 0;
  return stateWeight + job.gpu_count * 250 + job.cpus;
}
