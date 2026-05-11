import type { QueueJob, QueueResponse, ResourceResponse } from "../types";

export type ActivityTone = "info" | "good" | "warn" | "bad";

export type ActivitySnapshot = {
  resources: ResourceResponse;
  queue: QueueResponse;
};

export type ActivityEvent = {
  id: string;
  at: string;
  tone: ActivityTone;
  title: string;
  detail: string;
};

export function buildActivityEvents(
  previous: ActivitySnapshot | null,
  current: ActivitySnapshot,
  at: string
): ActivityEvent[] {
  if (!previous) {
    return [
      event(
        "baseline",
        at,
        "info",
        "Snapshot loaded",
        `${current.queue.running} running / ${current.queue.pending} pending; ${current.resources.cluster.gpu_free}/${current.resources.cluster.gpu_total} GPUs free`
      )
    ];
  }
  const events = [
    ...clusterDeltas(previous, current, at),
    ...jobDeltas(previous.queue.jobs, current.queue.jobs, at),
    ...nodeDeltas(previous.resources, current.resources, at),
    ...gpuDeltas(previous.resources, current.resources, at)
  ];
  return events.length ? events : [event("heartbeat", at, "info", "No placement changes", "Snapshot refreshed without visible queue, node, or GPU deltas.")];
}

function clusterDeltas(previous: ActivitySnapshot, current: ActivitySnapshot, at: string) {
  const events: ActivityEvent[] = [];
  const pending = current.queue.pending - previous.queue.pending;
  const running = current.queue.running - previous.queue.running;
  const freeGpu = current.resources.cluster.gpu_free - previous.resources.cluster.gpu_free;
  if (pending !== 0) {
    events.push(event("pending", at, pending > 0 ? "warn" : "good", `Pending ${deltaText(pending)}`, `${current.queue.pending} jobs are pending in ${current.queue.scope} scope.`));
  }
  if (running !== 0) {
    events.push(event("running", at, running > 0 ? "good" : "info", `Running ${deltaText(running)}`, `${current.queue.running} jobs are running in ${current.queue.scope} scope.`));
  }
  if (freeGpu !== 0) {
    events.push(event("gpu-free", at, freeGpu > 0 ? "good" : "warn", `Free GPU ${deltaText(freeGpu)}`, `${current.resources.cluster.gpu_free}/${current.resources.cluster.gpu_total} GPUs are free now.`));
  }
  return events;
}

function jobDeltas(previousJobs: QueueJob[], currentJobs: QueueJob[], at: string) {
  const previousById = byJob(previousJobs);
  const currentById = byJob(currentJobs);
  const events: ActivityEvent[] = [];
  for (const job of currentJobs) {
    const previous = previousById.get(job.job_id);
    if (!previous) {
      events.push(event(`job-new-${job.job_id}`, at, job.state === "PENDING" ? "warn" : "info", `Job entered ${job.state}`, jobDetail(job)));
    } else if (previous.state !== job.state) {
      events.push(event(`job-state-${job.job_id}`, at, job.state === "RUNNING" ? "good" : "info", `${job.job_id} ${previous.state} -> ${job.state}`, jobDetail(job)));
    }
  }
  for (const job of previousJobs) {
    if (!currentById.has(job.job_id)) {
      events.push(event(`job-left-${job.job_id}`, at, "info", `Job left visible queue`, jobDetail(job)));
    }
  }
  return events.slice(0, 6);
}

function nodeDeltas(previous: ResourceResponse, current: ResourceResponse, at: string) {
  const previousByName = new Map(previous.nodes.map((node) => [node.name, node]));
  return current.nodes
    .filter((node) => previousByName.get(node.name)?.state !== undefined && previousByName.get(node.name)?.state !== node.state)
    .slice(0, 4)
    .map((node) => {
      const oldState = previousByName.get(node.name)?.state;
      const tone = node.is_available ? "good" : "bad";
      return event(`node-${node.name}`, at, tone, `${node.name} ${oldState} -> ${node.state}`, `${node.cpus_idle}/${node.cpus_total} CPU idle; ${node.gpu_free}/${node.gpu_total} GPUs free.`);
    });
}

function gpuDeltas(previous: ResourceResponse, current: ResourceResponse, at: string) {
  const previousByType = new Map(previous.gpu_pools.map((pool) => [pool.type, pool]));
  return current.gpu_pools
    .filter((pool) => previousByType.get(pool.type)?.usable !== undefined && previousByType.get(pool.type)?.usable !== pool.usable)
    .slice(0, 4)
    .map((pool) => {
      const delta = pool.usable - (previousByType.get(pool.type)?.usable ?? pool.usable);
      return event(`gpu-${pool.type}`, at, delta > 0 ? "good" : "warn", `${pool.type} usable ${deltaText(delta)}`, `${pool.usable}/${pool.total} usable across ${pool.nodes_available}/${pool.nodes_total} nodes.`);
    });
}

function byJob(jobs: QueueJob[]) {
  return new Map(jobs.map((job) => [job.job_id, job]));
}

function jobDetail(job: QueueJob) {
  return `${job.name ?? job.job_id}; ${job.partition ?? "n/a"}; ${job.cpus} CPU / ${job.gpu_count} GPU`;
}

function deltaText(value: number) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function event(id: string, at: string, tone: ActivityTone, title: string, detail: string): ActivityEvent {
  return { id: `${id}-${at}`, at, tone, title, detail };
}
