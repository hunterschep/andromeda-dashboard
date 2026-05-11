import type { AccountLimits, HistoryResponse, QueueJob } from "../types";

export type SweepGovernor = {
  label: string;
  headline: string;
  cap: number;
  tasks: number;
  pending: number;
  pendingGpu: number;
  active: number;
  cleanRate: number | null;
  qosHeadroom: number | null;
  rows: SweepGovernorRow[];
  script: string;
};

export type SweepGovernorRow = {
  label: string;
  value: string;
  tone: "ready" | "watch" | "tight";
  detail: string;
};

export function buildSweepGovernor(jobs: QueueJob[], history: HistoryResponse | null, limits: AccountLimits | null): SweepGovernor {
  const active = jobs.filter((job) => job.state === "RUNNING" || job.state === "PENDING").length;
  const pending = jobs.filter((job) => job.state === "PENDING").length;
  const pendingGpu = jobs.filter((job) => job.state === "PENDING").reduce((sum, job) => sum + job.gpu_count, 0);
  const cleanRate = cleanRateFor(history);
  const qosHeadroom = headroomFor(limits, active);
  const cap = capFor({ pending, pendingGpu, cleanRate, qosHeadroom });
  const tasks = 32;
  return {
    label: `${pending} pending / cap %${cap}`,
    headline: headlineFor(cap, cleanRate, pendingGpu),
    cap,
    tasks,
    pending,
    pendingGpu,
    active,
    cleanRate,
    qosHeadroom,
    rows: rowsFor({ pending, pendingGpu, active, cleanRate, qosHeadroom, cap }),
    script: scriptFor(cap, tasks)
  };
}

function rowsFor({
  pending,
  pendingGpu,
  active,
  cleanRate,
  qosHeadroom,
  cap
}: {
  pending: number;
  pendingGpu: number;
  active: number;
  cleanRate: number | null;
  qosHeadroom: number | null;
  cap: number;
}): SweepGovernorRow[] {
  return [
    {
      label: "queue",
      value: `${pending} pending`,
      tone: pendingGpu > 0 || pending >= 3 ? "watch" : "ready",
      detail: pendingGpu > 0 ? `${pendingGpu} pending GPU request(s) make wide sweeps costly.` : "Visible queue pressure is light enough for moderate arrays."
    },
    {
      label: "recent runs",
      value: cleanRate === null ? "unknown" : `${cleanRate}% clean`,
      tone: cleanRate !== null && cleanRate < 70 ? "tight" : "ready",
      detail: cleanRate !== null && cleanRate < 70 ? "Fix failures before multiplying them across an array." : "Recent accounting does not argue against scaling."
    },
    {
      label: "visible active",
      value: `${active} jobs`,
      tone: active >= 16 ? "watch" : "ready",
      detail: "This is the active footprint visible in the current queue scope."
    },
    {
      label: "array cap",
      value: `%${cap}`,
      tone: cap <= 2 ? "tight" : cap <= 4 ? "watch" : "ready",
      detail: `Use #SBATCH --array=0-31%${cap} until pressure changes.`
    },
    {
      label: "QOS room",
      value: qosHeadroom === null ? "n/a" : `${qosHeadroom}`,
      tone: qosHeadroom !== null && qosHeadroom < cap ? "tight" : "ready",
      detail: qosHeadroom === null ? "No per-user QOS job cap was parsed." : "Visible headroom against parsed per-user job limits."
    }
  ];
}

function capFor({
  pending,
  pendingGpu,
  cleanRate,
  qosHeadroom
}: {
  pending: number;
  pendingGpu: number;
  cleanRate: number | null;
  qosHeadroom: number | null;
}): number {
  let cap = pendingGpu > 0 || pending >= 3 ? 4 : 8;
  if (cleanRate !== null && cleanRate < 70) cap = Math.min(cap, 2);
  if (qosHeadroom !== null) cap = Math.min(cap, Math.max(1, Math.min(qosHeadroom, 8)));
  return cap;
}

function cleanRateFor(history: HistoryResponse | null): number | null {
  const jobs = history?.jobs ?? [];
  if (!jobs.length) return null;
  const clean = jobs.filter((job) => job.state === "COMPLETED").length;
  return Math.round((clean / jobs.length) * 100);
}

function headroomFor(limits: AccountLimits | null, active: number): number | null {
  const normal = limits?.qos.find((qos) => qos.name === "normal")?.max_jobs_per_user;
  if (typeof normal === "number") return Math.max(0, normal - active);
  const caps = (limits?.qos ?? []).map((qos) => qos.max_jobs_per_user).filter((value): value is number => typeof value === "number");
  if (!caps.length) return null;
  return Math.max(0, Math.max(...caps) - active);
}

function headlineFor(cap: number, cleanRate: number | null, pendingGpu: number): string {
  if (cleanRate !== null && cleanRate < 70) return `Throttle sweeps before scaling; recent clean rate is ${cleanRate}%.`;
  if (pendingGpu > 0) return "GPU pressure is visible; keep array concurrency modest.";
  if (cap >= 8) return "Queue conditions can tolerate a moderate sweep cap.";
  return "Use a conservative array cap until scheduler pressure clears.";
}

function scriptFor(cap: number, tasks: number): string {
  return [
    "#!/bin/bash",
    "#SBATCH --job-name=andromeda-governed-sweep",
    `#SBATCH --array=0-${tasks - 1}%${cap}`,
    "#SBATCH --nodes=1",
    "#SBATCH --ntasks=1",
    "#SBATCH --cpus-per-task=4",
    "#SBATCH --mem=16G",
    "#SBATCH --time=04:00:00",
    "#SBATCH --output=logs/%x-%A_%a.out",
    "#SBATCH --error=logs/%x-%A_%a.err",
    "",
    "set -euo pipefail",
    "cd \"$SLURM_SUBMIT_DIR\"",
    "mkdir -p logs",
    "python train.py --seed \"$SLURM_ARRAY_TASK_ID\""
  ].join("\n");
}
