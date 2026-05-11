import type { HistoryJob } from "../types";

export type FailureSeverity = "info" | "warning" | "critical";

export type FailureDiagnostic = {
  jobId: string;
  name: string;
  state: string;
  partition: string;
  exitCode: string;
  request: string;
  allocated: string;
  title: string;
  severity: FailureSeverity;
  confidence: "low" | "medium" | "high";
  explanation: string;
  nextAction: string;
};

export type FailureCommand = {
  label: string;
  command: string;
  detail: string;
};

export type FailureSummary = {
  total: number;
  failed: number;
  cleanRate: number;
  timeout: number;
  oom: number;
  gpuSuspect: number;
};

export function buildFailureDiagnostics(jobs: HistoryJob[]) {
  const failedJobs = jobs.filter(isFailedHistoryJob);
  return {
    summary: {
      total: jobs.length,
      failed: failedJobs.length,
      cleanRate: jobs.length ? Math.round(((jobs.length - failedJobs.length) / jobs.length) * 100) : 100,
      timeout: failedJobs.filter((job) => job.state.includes("TIMEOUT")).length,
      oom: failedJobs.filter(isOomLike).length,
      gpuSuspect: failedJobs.filter((job) => requestedGpu(job) > 0).length
    },
    diagnostics: failedJobs.map(classifyFailure).slice(0, 6)
  };
}

export function diagnosticCommand(alias: string, jobId: string): string {
  return `ssh ${alias} 'sacct -j ${jobId} --format=JobID,JobName,State,ExitCode,Elapsed,ReqTRES,AllocTRES,MaxRSS,MaxVMSize -P; seff ${jobId} 2>/dev/null || true'`;
}

export function failureCommands(alias: string, item: FailureDiagnostic): FailureCommand[] {
  const commands: FailureCommand[] = [
    {
      label: "accounting",
      command: diagnosticCommand(alias, item.jobId),
      detail: "Accounting, MaxRSS, requested TRES, allocated TRES, and seff if available."
    },
    {
      label: "logs",
      command: `ssh ${alias} '${logProbe(item.jobId)}'`,
      detail: "Resolve StdOut and StdErr from Slurm and tail whichever files exist."
    }
  ];
  if (/GPU|CUDA|module/i.test(`${item.title} ${item.explanation} ${item.nextAction}`)) {
    commands.push({
      label: "CUDA context",
      command: `ssh ${alias} 'sacct -j ${item.jobId} --format=JobID,AllocTRES,TRESUsageInAve,TRESUsageInMax -P; scontrol show job -dd ${item.jobId} | sed -n "1,120p"'`,
      detail: "Check allocated GPU TRES, accounting GPU utilization, and submitted environment hints."
    });
  }
  if (/memory|quota|filesystem|space|rss/i.test(`${item.title} ${item.explanation} ${item.nextAction}`)) {
    commands.push({
      label: "quota",
      command: `ssh ${alias} 'acct-chk "$USER"; sacct -j ${item.jobId} --format=JobID,State,MaxRSS,MaxVMSize,ReqMem,Elapsed -P'`,
      detail: "Check account quotas plus memory accounting for likely OOM or filesystem pressure."
    });
  }
  return commands;
}

function classifyFailure(job: HistoryJob): FailureDiagnostic {
  const state = job.state.toUpperCase();
  const base = diagnosticBase(job);
  if (state.includes("OUT_OF_MEMORY") || isOomLike(job)) {
    return {
      ...base,
      title: "Likely memory kill",
      severity: "critical",
      confidence: state.includes("OUT_OF_MEMORY") ? "high" : "medium",
      explanation: "The job looks like it was killed after exceeding memory or receiving a kill signal.",
      nextAction: "Check MaxRSS, lower batch size, or request memory closer to observed peak plus headroom."
    };
  }
  if (state.includes("TIMEOUT")) {
    return {
      ...base,
      title: "Walltime exhausted",
      severity: "warning",
      confidence: "high",
      explanation: "The run reached its Slurm time limit before finishing.",
      nextAction: "Add checkpointing, reduce the experiment size, or move to a longer partition."
    };
  }
  if (state.includes("NODE_FAIL") || state.includes("BOOT_FAIL")) {
    return {
      ...base,
      title: "Node-side failure",
      severity: "critical",
      confidence: "high",
      explanation: "The accounting state points to an infrastructure or node health failure.",
      nextAction: "Resubmit if the workload is deterministic, and include this job ID in any help request."
    };
  }
  if (state.includes("CANCELLED")) {
    return {
      ...base,
      title: "Cancelled run",
      severity: "info",
      confidence: "medium",
      explanation: "The job was cancelled before completion, either by a user, dependency, or policy action.",
      nextAction: "Check who cancelled it and whether QOS, dependency, or preemption policy was involved."
    };
  }
  if (requestedGpu(job) > 0) {
    return {
      ...base,
      title: "GPU job exited non-zero",
      severity: "warning",
      confidence: "medium",
      explanation: "The job requested GPU resources and exited unsuccessfully; CUDA, modules, data paths, or application code are likely suspects.",
      nextAction: "Inspect stderr, CUDA/module versions, and GPU visibility from the job environment."
    };
  }
  return {
    ...base,
    title: "Application exit",
    severity: "warning",
    confidence: "medium",
    explanation: "Slurm allocated the job, but the process returned a non-zero or incomplete terminal state.",
    nextAction: "Inspect stdout/stderr and compare requested resources with MaxRSS and elapsed runtime."
  };
}

function diagnosticBase(job: HistoryJob) {
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    state: job.state,
    partition: job.partition ?? "n/a",
    exitCode: job.exit_code ?? "n/a",
    request: tresText(job.requested_tres ?? {}),
    allocated: tresText(job.allocated_tres ?? {})
  };
}

function isFailedHistoryJob(job: HistoryJob): boolean {
  const state = job.state.toUpperCase();
  return !["COMPLETED", "RUNNING"].some((healthy) => state.includes(healthy));
}

function isOomLike(job: HistoryJob): boolean {
  return job.state.toUpperCase().includes("OOM") || job.exit_code?.startsWith("0:9") || false;
}

function requestedGpu(job: HistoryJob): number {
  const requested = job.requested_tres ?? {};
  return Number(requested["gres/gpu"] ?? requested.gpu ?? 0) || 0;
}

function tresText(values: Record<string, string>): string {
  const order = ["cpu", "mem", "gres/gpu", "gpu", "node"];
  const entries = [
    ...order.filter((key) => values[key]).map((key) => [key, values[key]] as const),
    ...Object.entries(values).filter(([key]) => !order.includes(key))
  ];
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "n/a";
}

function logProbe(jobId: string): string {
  return `job=$(scontrol show job -dd ${jobId}); for field in StdOut StdErr; do path=$(printf "%s\\n" "$job" | sed -n "s/.*$field=\\([^ ]*\\).*/\\1/p"); if [[ -n "$path" && "$path" != "(null)" ]]; then echo "== $field $path =="; tail -n 120 "$path"; fi; done`;
}
