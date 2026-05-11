import type { QueueJob } from "../types";

export type RunbookCommand = {
  label: string;
  command: string;
  detail: string;
};

export type JobRunbook = {
  jobId: string;
  name: string;
  state: string;
  node: string | null;
  commands: RunbookCommand[];
};

export function buildJobRunbooks(jobs: QueueJob[], alias: string): JobRunbook[] {
  return jobs
    .filter((job) => job.state === "RUNNING" || job.state === "PENDING")
    .slice()
    .sort(compareJobs)
    .slice(0, 4)
    .map((job) => runbook(job, alias));
}

function runbook(job: QueueJob, alias: string): JobRunbook {
  const commands = job.state === "RUNNING" ? runningCommands(job, alias) : pendingCommands(job, alias);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    state: job.state,
    node: job.nodes[0] ?? null,
    commands
  };
}

function runningCommands(job: QueueJob, alias: string): RunbookCommand[] {
  const commands = [
    {
      label: "tail output",
      command: `ssh ${alias} '${stdoutProbe(job.job_id)}'`,
      detail: "Resolve StdOut from scontrol and tail the live log if Slurm exposes it."
    },
    {
      label: "allocation",
      command: `ssh ${alias} 'sacct -j ${job.job_id} --format=JobID,JobName,State,Elapsed,Start,End,ReqTRES,AllocTRES -P; scontrol show job -dd ${job.job_id} | sed -n "1,100p"'`,
      detail: "Inspect accounting, requested TRES, allocated TRES, nodes, and scheduler fields."
    }
  ];
  if (job.gpu_count > 0 && job.nodes[0]) commands.push(gpuProbe(job, alias));
  if (looksLikeNotebook(job) && job.nodes[0]) commands.push(tunnelProbe(job, alias));
  return commands;
}

function pendingCommands(job: QueueJob, alias: string): RunbookCommand[] {
  return [
    {
      label: "start estimate",
      command: `ssh ${alias} 'squeue -j ${job.job_id} --start; sprio -j ${job.job_id}; scontrol show job -dd ${job.job_id} | sed -n "1,120p"'`,
      detail: "Compare Slurm start estimate, priority factors, requested resources, QOS, and reason fields."
    },
    {
      label: "queue slice",
      command: `ssh ${alias} 'squeue -p ${job.partition ?? "short"} -o "%.18i %.9P %.8T %.10M %.10l %.6D %.8C %.12b %R" | head -40'`,
      detail: "Show nearby jobs in the same partition with state, time, size, GPU request, and reason."
    }
  ];
}

function gpuProbe(job: QueueJob, alias: string): RunbookCommand {
  return {
    label: "GPU probe",
    command: `ssh ${alias} 'ssh ${job.nodes[0]} "hostname; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits"'`,
    detail: "Check the allocated node's visible GPU utilization and memory pressure."
  };
}

function tunnelProbe(job: QueueJob, alias: string): RunbookCommand {
  return {
    label: "Jupyter tunnel",
    command: `ssh -N -L 8888:${job.nodes[0]}:8888 ${alias}`,
    detail: "Open a local tunnel to the notebook port on the allocated compute node."
  };
}

function stdoutProbe(jobId: string): string {
  return `out=$(scontrol show job -dd ${jobId} | sed -n "s/.*StdOut=\\([^ ]*\\).*/\\1/p"); if [[ -n "$out" && "$out" != "(null)" ]]; then tail -n 120 "$out"; else scontrol show job -dd ${jobId} | sed -n "1,120p"; fi`;
}

function looksLikeNotebook(job: QueueJob): boolean {
  return /jupyter|notebook|lab/i.test(job.name ?? "");
}

function compareJobs(left: QueueJob, right: QueueJob): number {
  return score(right) - score(left) || left.job_id.localeCompare(right.job_id);
}

function score(job: QueueJob): number {
  return (job.state === "RUNNING" ? 10_000 : 5_000) + job.gpu_count * 600 + (job.elapsed_seconds ?? 0) / 60;
}
