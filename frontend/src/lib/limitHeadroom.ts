import type { AccountLimits, QueueJob } from "../types";

export type LimitHeadroomTone = "clear" | "tight" | "blocked" | "unknown";

export type LimitHeadroomCheck = {
  id: string;
  label: string;
  used: string;
  limit: string;
  room: string;
  tone: LimitHeadroomTone;
};

export type LimitHeadroomRow = {
  qos: string;
  tone: LimitHeadroomTone;
  active: number;
  summary: string;
  action: string;
  checks: LimitHeadroomCheck[];
};

export type LimitHeadroom = {
  label: string;
  headline: string;
  rows: LimitHeadroomRow[];
  command: string;
};

const ACTIVE_STATES = new Set(["CONFIGURING", "PENDING", "RUNNING", "SUSPENDED"]);

export function buildLimitHeadroom(accountLimits: AccountLimits | null, jobs: QueueJob[], alias: string): LimitHeadroom {
  if (!accountLimits?.qos.length) {
    return {
      label: "limits unavailable",
      headline: "Account and QOS ceilings are not visible in this snapshot.",
      rows: [],
      command: commandFor(alias)
    };
  }
  const active = activeJobs(accountLimits, jobs);
  const usage = usageFor(active);
  const rows = accountLimits.qos.map((qos) => rowFor(qos, usage)).sort(compareRows);
  const blocked = rows.filter((row) => row.tone === "blocked").length;
  const tight = rows.filter((row) => row.tone === "tight").length;
  return {
    label: `${blocked} blocked / ${tight} tight QOS`,
    headline: headlineFor(rows, accountLimits.user),
    rows,
    command: commandFor(alias)
  };
}

function activeJobs(accountLimits: AccountLimits, jobs: QueueJob[]): QueueJob[] {
  const scoped = jobs.filter((job) => ACTIVE_STATES.has(job.state) && (!accountLimits.user || job.user === accountLimits.user));
  return scoped.length ? scoped : jobs.filter((job) => ACTIVE_STATES.has(job.state));
}

function usageFor(jobs: QueueJob[]) {
  const gpuTypes = new Map<string, number>();
  for (const job of jobs) {
    for (const gpu of job.gpus) gpuTypes.set(gpu.type, (gpuTypes.get(gpu.type) ?? 0) + gpu.count);
  }
  return {
    active: jobs.length,
    cpu: jobs.reduce((sum, job) => sum + job.cpus, 0),
    memoryGb: jobs.reduce((sum, job) => sum + (job.memory_mb ?? 0) / 1024, 0),
    gpu: jobs.reduce((sum, job) => sum + job.gpu_count, 0),
    gpuTypes
  };
}

function rowFor(qos: AccountLimits["qos"][number], usage: ReturnType<typeof usageFor>): LimitHeadroomRow {
  const checks = [
    numericCheck("jobs", "jobs", usage.active, cap(qos.max_jobs_per_user)),
    numericCheck("submit", "submit", usage.active, cap(qos.max_submit_per_user)),
    numericCheck("cpu", "CPU", usage.cpu, parseCount(qos.max_tres_per_user.cpu)),
    memoryCheck(usage.memoryGb, qos.max_tres_per_user.mem),
    numericCheck("gpu", "GPU", usage.gpu, parseCount(qos.max_tres_per_user["gres/gpu"])),
    ...typedGpuChecks(usage.gpuTypes, qos.max_tres_per_user)
  ].filter((check): check is LimitHeadroomCheck => Boolean(check));
  const tone = checks.reduce<LimitHeadroomTone>((current, check) => worstTone(current, check.tone), checks.length ? "clear" : "unknown");
  return {
    qos: qos.name,
    tone,
    active: usage.active,
    summary: summaryFor(qos.name, tone, checks, usage.active),
    action: actionFor(tone, checks),
    checks
  };
}

function typedGpuChecks(gpuTypes: Map<string, number>, tres: Record<string, string>): LimitHeadroomCheck[] {
  return Object.entries(tres)
    .filter(([key]) => key.startsWith("gres/gpu:"))
    .map(([key, value]) => {
      const type = key.replace("gres/gpu:", "");
      return numericCheck(key, `${type} GPU`, gpuTypes.get(type) ?? 0, parseCount(value));
    })
    .filter((check): check is LimitHeadroomCheck => Boolean(check));
}

function numericCheck(id: string, label: string, used: number, limit: number | null): LimitHeadroomCheck | null {
  if (limit === null) return null;
  const room = limit - used;
  return {
    id,
    label,
    used: used.toLocaleString(),
    limit: limit.toLocaleString(),
    room: room >= 0 ? `${room.toLocaleString()} left` : `${Math.abs(room).toLocaleString()} over`,
    tone: toneFor(used, limit)
  };
}

function memoryCheck(usedGb: number, rawLimit: string | undefined): LimitHeadroomCheck | null {
  const limit = rawLimit ? parseMemoryGb(rawLimit) : null;
  if (limit === null) return null;
  const room = limit - usedGb;
  return {
    id: "mem",
    label: "memory",
    used: gb(usedGb),
    limit: rawLimit ?? gb(limit),
    room: room >= 0 ? `${gb(room)} left` : `${gb(Math.abs(room))} over`,
    tone: toneFor(usedGb, limit)
  };
}

function summaryFor(qos: string, tone: LimitHeadroomTone, checks: LimitHeadroomCheck[], active: number): string {
  if (!checks.length) return `${qos} has no visible per-user job or TRES ceilings in parsed Slurm data.`;
  const worst = checks.filter((check) => check.tone === tone).map((check) => check.label).join(", ");
  if (tone === "blocked") return `${qos} is over visible ${worst} limit(s) for ${active} active or queued job(s).`;
  if (tone === "tight") return `${qos} is close to ${worst} limit(s); one more submission may hit policy before placement.`;
  return `${qos} has visible headroom across parsed job and TRES ceilings.`;
}

function actionFor(tone: LimitHeadroomTone, checks: LimitHeadroomCheck[]): string {
  if (tone === "blocked") return "End or cancel work under that policy, or choose a QOS/account path with actual headroom before resubmitting.";
  if (tone === "tight") return "Keep the next request narrow and verify QOS choice before launching arrays or notebooks.";
  if (tone === "unknown") return "Run sacctmgr and squeue probes before assuming resources are the blocker.";
  const tightest = checks.filter((check) => check.limit !== "n/a").sort((a, b) => toneRank(b.tone) - toneRank(a.tone))[0];
  return tightest ? `Policy is not the first suspect; visible ${tightest.label} room is ${tightest.room}.` : "Policy is not the first suspect in this snapshot.";
}

function headlineFor(rows: LimitHeadroomRow[], user: string | null): string {
  const blocked = rows.find((row) => row.tone === "blocked");
  if (blocked) return `${blocked.qos} is over a visible account ceiling; policy can block before GPUs or nodes matter.`;
  const tight = rows.find((row) => row.tone === "tight");
  if (tight) return `${tight.qos} is near a visible account ceiling for ${user ?? "this user"}.`;
  return `Parsed QOS ceilings show usable headroom for ${user ?? "this account"}.`;
}

function commandFor(alias: string): string {
  return `ssh ${alias} 'squeue -u "$USER" -t R,PD -O JobID:12,Name:24,State:12,NumCPUs:10,TresPerNode:24,Reason:30; sacctmgr show assoc user="$USER" format=Account,User,QOS,MaxJobs,MaxSubmit,MaxTRESPU -P'`;
}

function cap(value: number | null): number | null {
  return value && value > 0 ? value : null;
}

function parseCount(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseMemoryGb(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)\s*([KMGTPE]?)(?:B)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2].toUpperCase();
  if (unit === "K") return amount / 1024 / 1024;
  if (unit === "M" || unit === "") return amount / 1024;
  if (unit === "G") return amount;
  if (unit === "T") return amount * 1024;
  if (unit === "P") return amount * 1024 * 1024;
  return null;
}

function toneFor(used: number, limit: number): LimitHeadroomTone {
  if (used > limit) return "blocked";
  if (used >= limit * 0.85) return "tight";
  return "clear";
}

function worstTone(left: LimitHeadroomTone, right: LimitHeadroomTone): LimitHeadroomTone {
  return toneRank(left) >= toneRank(right) ? left : right;
}

function compareRows(left: LimitHeadroomRow, right: LimitHeadroomRow): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.qos.localeCompare(right.qos);
}

function toneRank(tone: LimitHeadroomTone): number {
  return { clear: 0, unknown: 1, tight: 2, blocked: 3 }[tone];
}

function gb(value: number): string {
  if (value >= 1024) return `${(value / 1024).toFixed(1)} TB`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value >= 10 ? 0 : 1 })} GB`;
}
