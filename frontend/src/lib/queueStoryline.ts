import { formatDuration, formatMemory, shortTime } from "../api";
import type { NodeResource, PartitionSummary, PriorityJob, QueueJob } from "../types";

export type QueueStory = {
  jobId: string;
  title: string;
  tone: "gate" | "dated" | "fit" | "watch";
  wait: string;
  reason: string;
  next: string;
  evidence: string[];
  command: string;
};

export type QueueStoryline = {
  label: string;
  headline: string;
  stories: QueueStory[];
};

export function buildQueueStoryline({
  jobs,
  nodes,
  partitions,
  priorityJobs,
  alias
}: {
  jobs: QueueJob[];
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  priorityJobs: PriorityJob[];
  alias: string;
}): QueueStoryline {
  const stories = jobs
    .filter((job) => job.state === "PENDING")
    .map((job) => storyFor(job, nodes, partitions, priorityJobs, alias))
    .sort(compareStories)
    .slice(0, 4);
  const gates = stories.filter((story) => story.tone === "gate").length;
  const dated = stories.filter((story) => story.tone === "dated").length;
  return {
    label: stories.length ? `${gates} gate / ${dated} dated` : "clear",
    headline: stories.length
      ? `${stories.length} pending job${stories.length === 1 ? "" : "s"} can be explained from visible scheduler evidence.`
      : "No pending jobs need scheduler translation in this scope.",
    stories
  };
}

function storyFor(job: QueueJob, nodes: NodeResource[], partitions: PartitionSummary[], priorityJobs: PriorityJob[], alias: string): QueueStory {
  const gate = gateText(job);
  const priority = priorityJobs.find((item) => item.job_id === job.job_id);
  const partition = partitions.find((item) => item.name === job.partition);
  const fit = fitCount(job, nodes);
  const evidence = [
    requestText(job),
    fit ? `${fit} visible fit${fit === 1 ? "" : "s"}` : "no visible fit",
    priority ? `priority ${priority.priority}` : null,
    walltime(job, partition)
  ].filter((item): item is string => Boolean(item));
  if (gate) {
    return baseStory(
      job,
      "gate",
      "dependency gate",
      `${name(job)} is waiting on ${gate} before resources matter.`,
      "Resolve dependency first; reshaping CPU, GPU, or memory will not move this job yet.",
      evidence,
      alias
    );
  }
  if (job.estimated_start_time) {
    return baseStory(
      job,
      "dated",
      shortTime(job.estimated_start_time),
      `${name(job)} has a dated start estimate while asking for ${requestText(job)}.`,
      "Watch the estimate and avoid churn unless it slips or the run can safely shorten walltime.",
      evidence,
      alias
    );
  }
  if (!fit) {
    return baseStory(
      job,
      "fit",
      "no visible fit",
      `${name(job)} cannot fit on visible idle nodes with the current shape.`,
      "Shrink the widest resource request or choose a less constrained partition before waiting blindly.",
      evidence,
      alias
    );
  }
  return baseStory(
    job,
    "watch",
    job.state_reason ?? "pending",
    `${name(job)} has visible fit but no public start estimate.`,
    "Inspect priority, fairshare, and backfill before editing the submission.",
    evidence,
    alias
  );
}

function baseStory(job: QueueJob, tone: QueueStory["tone"], wait: string, reason: string, next: string, evidence: string[], alias: string): QueueStory {
  return {
    jobId: job.job_id,
    title: `${name(job)} / ${job.partition ?? "n/a"}`,
    tone,
    wait,
    reason,
    next,
    evidence,
    command: `ssh ${alias} 'squeue -j ${job.job_id} --start; sprio -j ${job.job_id}; scontrol show job -dd ${job.job_id} | sed -n "1,140p"'`
  };
}

function gateText(job: QueueJob): string | null {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  if (job.dependency) return job.dependency;
  return /depend|hold|begin/.test(reason) ? job.state_reason ?? "scheduler gate" : null;
}

function fitCount(job: QueueJob, nodes: NodeResource[]): number {
  return nodes.filter((node) => node.is_available && (!job.partition || node.partitions.includes(job.partition)) && fits(node, job)).length;
}

function fits(node: NodeResource, job: QueueJob): boolean {
  const memory = node.memory_free_mb ?? node.memory_total_mb;
  return node.cpus_idle >= job.cpus && memory >= (job.memory_mb ?? 0) && node.gpu_free >= job.gpu_count;
}

function requestText(job: QueueJob): string {
  return `${job.cpus} CPU / ${formatMemory(job.memory_mb)} / ${job.gpu_count} GPU`;
}

function walltime(job: QueueJob, partition: PartitionSummary | undefined): string | null {
  if (job.time_limit_seconds) return `${formatDuration(job.time_limit_seconds)} walltime`;
  return partition?.default_time ? `${partition.default_time} default time` : null;
}

function name(job: QueueJob): string {
  return job.name ?? job.job_id;
}

function compareStories(left: QueueStory, right: QueueStory): number {
  return toneRank(right.tone) - toneRank(left.tone) || left.jobId.localeCompare(right.jobId);
}

function toneRank(tone: QueueStory["tone"]): number {
  return { watch: 0, dated: 1, fit: 2, gate: 3 }[tone];
}
