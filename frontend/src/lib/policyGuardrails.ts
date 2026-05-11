import type { AccountLimits, PartitionSummary, QueueJob } from "../types";
import type { PlannerInput } from "./requestPlanner";

export type PolicyStatus = "clear" | "watch" | "blocked" | "unknown";

export type PolicyCheck = {
  id: string;
  label: string;
  status: PolicyStatus;
  used: string;
  limit: string;
  message: string;
};

export type PolicyGuardrail = {
  qos: string;
  scope: "selected" | "default" | "visible";
  status: PolicyStatus;
  message: string;
  checks: PolicyCheck[];
};

export type PolicyGuardrailSummary = {
  status: PolicyStatus;
  label: string;
  message: string;
};

const ACTIVE_STATES = new Set(["CONFIGURING", "PENDING", "RUNNING", "SUSPENDED"]);

export function evaluatePolicyGuardrails({
  input,
  accountLimits,
  partitions,
  partition,
  jobs
}: {
  input: PlannerInput;
  accountLimits: AccountLimits | null;
  partitions: PartitionSummary[];
  partition: string | null;
  jobs: QueueJob[];
}): { summary: PolicyGuardrailSummary; rows: PolicyGuardrail[] } {
  if (!accountLimits?.qos.length) {
    return {
      summary: {
        status: "unknown",
        label: "limits unavailable",
        message: "QOS/account limits are not available; validate large requests with sacctmgr before submitting."
      },
      rows: []
    };
  }

  const partitionQos = new Set(partitions.find((entry) => entry.name === partition)?.qos ?? []);
  const hasSelectedQos = partitionQos.size > 0;
  const userJobs = visibleUserJobs(jobs, accountLimits.user);
  const rows = accountLimits.qos
    .map((qos) =>
      assessQos({
        input,
        qosName: qos.name,
        tres: qos.max_tres_per_user,
        maxJobs: qos.max_jobs_per_user,
        maxSubmit: qos.max_submit_per_user,
        currentJobs: userJobs,
        scope: qosScope(qos.name, hasSelectedQos, partitionQos)
      })
    )
    .sort((left, right) => scopeRank(left.scope) - scopeRank(right.scope) || statusRank(right.status) - statusRank(left.status));

  const selectedRows = rows.filter((row) => row.scope === "selected");
  const defaultRows = rows.filter((row) => row.scope === "default");
  const summaryRows = selectedRows.length ? selectedRows : defaultRows.length ? defaultRows : rows;
  return { summary: summarize(summaryRows, partition), rows };
}

function qosScope(qosName: string, hasSelectedQos: boolean, partitionQos: Set<string>): PolicyGuardrail["scope"] {
  if (hasSelectedQos && partitionQos.has(qosName)) return "selected";
  if (qosName === "normal") return "default";
  return "visible";
}

function assessQos({
  input,
  qosName,
  tres,
  maxJobs,
  maxSubmit,
  currentJobs,
  scope
}: {
  input: PlannerInput;
  qosName: string;
  tres: Record<string, string>;
  maxJobs: number | null;
  maxSubmit: number | null;
  currentJobs: number;
  scope: PolicyGuardrail["scope"];
}): PolicyGuardrail {
  const checks = [
    numericCheck("cpu", input.cpus, parseCount(tres.cpu), "CPU"),
    memoryCheck(input.memoryGb, tres.mem),
    ...gpuChecks(input, tres),
    numericCheck("jobs", currentJobs + 1, maxJobs, "active jobs after submit"),
    numericCheck("submit", currentJobs + 1, maxSubmit, "submitted jobs after submit")
  ].filter(Boolean) as PolicyCheck[];
  const status = checks.reduce<PolicyStatus>((current, check) => worstStatus(current, check.status), checks.length ? "clear" : "unknown");
  return { qos: qosName, scope, status, message: qosMessage(qosName, status, checks), checks };
}

function gpuChecks(input: PlannerInput, tres: Record<string, string>): PolicyCheck[] {
  if (input.gpus === 0) return [];
  const keys = Object.keys(tres).filter((key) => key === "gres/gpu" || (input.gpuType !== "any" && key === `gres/gpu:${input.gpuType}`));
  return keys.map((key) => numericCheck(key, input.gpus, parseCount(tres[key]), key === "gres/gpu" ? "GPU" : `${input.gpuType} GPU`)).filter(Boolean) as PolicyCheck[];
}

function numericCheck(id: string, requested: number, limit: number | null, label: string): PolicyCheck | null {
  if (limit === null || limit <= 0) return null;
  return checkLimit(id, requested, limit, label, `${requested.toLocaleString()}`, `${limit.toLocaleString()}`);
}

function memoryCheck(memoryGb: number, rawLimit: string | undefined): PolicyCheck | null {
  const limit = rawLimit ? parseMemoryGb(rawLimit) : null;
  if (limit === null || limit <= 0) return null;
  return checkLimit("mem", memoryGb, limit, "memory", `${memoryGb.toLocaleString()} GB`, rawLimit ?? `${limit.toLocaleString()} GB`);
}

function checkLimit(id: string, requested: number, limit: number, label: string, used: string, limitText: string): PolicyCheck {
  const status = requested > limit ? "blocked" : requested >= limit * 0.85 ? "watch" : "clear";
  const suffix = status === "blocked" ? "exceeds" : status === "watch" ? "is close to" : "fits";
  return { id, label, status, used, limit: limitText, message: `${label} ${suffix} the visible limit` };
}

function qosMessage(qosName: string, status: PolicyStatus, checks: PolicyCheck[]): string {
  const labels = checks.filter((check) => check.status === status).map((check) => check.label);
  if (status === "blocked") return `${qosName} would reject this shape: ${labels.join(", ")}.`;
  if (status === "watch") return `${qosName} is close to ${labels.join(", ")}.`;
  if (status === "clear") return `${qosName} allows this request.`;
  return `${qosName} has no CPU, GPU, memory, or job-count limits in the visible QOS data.`;
}

function summarize(rows: PolicyGuardrail[], partition: string | null): PolicyGuardrailSummary {
  const status = rows.reduce<PolicyStatus>((current, row) => worstStatus(current, row.status), rows.length ? "clear" : "unknown");
  const target = partition ?? "the selected partition";
  if (status === "blocked") {
    return {
      status,
      label: "blocked before queue",
      message: "The request is over a visible account/QOS limit before the scheduler can place it."
    };
  }
  if (status === "watch") {
    return {
      status,
      label: "near a guardrail",
      message: `The request fits ${target}, but one visible QOS limit is nearly saturated.`
    };
  }
  if (status === "clear") {
    return {
      status,
      label: "policy clear",
      message: `The request fits the visible account and QOS limits for ${target}.`
    };
  }
  return {
    status,
    label: "limits incomplete",
    message: "Visible QOS data does not include enough TRES fields to preflight this request."
  };
}

function visibleUserJobs(jobs: QueueJob[], user: string | null): number {
  return jobs.filter((job) => ACTIVE_STATES.has(job.state) && (!user || job.user === user)).length;
}

function parseCount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
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

function worstStatus(left: PolicyStatus, right: PolicyStatus): PolicyStatus {
  return statusRank(left) >= statusRank(right) ? left : right;
}

function statusRank(status: PolicyStatus): number {
  if (status === "blocked") return 3;
  if (status === "watch") return 2;
  if (status === "unknown") return 1;
  return 0;
}

function scopeRank(scope: PolicyGuardrail["scope"]): number {
  if (scope === "selected") return 0;
  if (scope === "default") return 1;
  return 2;
}
