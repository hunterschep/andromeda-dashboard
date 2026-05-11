import { shortTime } from "../api";
import type { QueueJob } from "../types";

export type TrafficLaneId = "running" | "dated" | "gated" | "dark";

export type TrafficLane = {
  id: TrafficLaneId;
  label: string;
  count: number;
  cpus: number;
  gpus: number;
  share: number;
  tone: "live" | "moving" | "blocked" | "unknown";
  detail: string;
};

export type TrafficTicket = {
  jobId: string;
  name: string;
  lane: TrafficLaneId;
  signal: string;
  request: string;
};

export type QueueTrafficFlow = {
  label: string;
  headline: string;
  action: string;
  lanes: TrafficLane[];
  tickets: TrafficTicket[];
  command: string;
};

export function buildQueueTrafficFlow(jobs: QueueJob[], alias: string): QueueTrafficFlow {
  const lanes = laneSpecs().map((spec) => laneFor(spec, jobs));
  const running = lane(lanes, "running");
  const dated = lane(lanes, "dated");
  const gated = lane(lanes, "gated");
  const dark = lane(lanes, "dark");
  return {
    label: `${running.count} live / ${dated.count} dated / ${gated.count} gated`,
    headline: headlineFor(running, dated, gated, dark),
    action: actionFor(dated, gated, dark),
    lanes,
    tickets: jobs.map(ticketFor).sort(compareTickets).slice(0, 5),
    command: `ssh ${alias} 'squeue -o "%i|%j|%T|%P|%C|%b|%R|%S" -S S'`
  };
}

function laneSpecs(): Array<{ id: TrafficLaneId; label: string; tone: TrafficLane["tone"] }> {
  return [
    { id: "running", label: "running load", tone: "live" },
    { id: "dated", label: "dated starts", tone: "moving" },
    { id: "gated", label: "scheduler gates", tone: "blocked" },
    { id: "dark", label: "blind waits", tone: "unknown" }
  ];
}

function laneFor(spec: ReturnType<typeof laneSpecs>[number], jobs: QueueJob[]): TrafficLane {
  const rows = jobs.filter((job) => laneId(job) === spec.id);
  const total = Math.max(1, jobs.length);
  const cpus = sum(rows, (job) => job.cpus);
  const gpus = sum(rows, (job) => job.gpu_count);
  return {
    ...spec,
    count: rows.length,
    cpus,
    gpus,
    share: Math.max(rows.length ? 8 : 3, Math.round((rows.length / total) * 100)),
    detail: detailFor(spec.id, rows.length, cpus, gpus)
  };
}

function ticketFor(job: QueueJob): TrafficTicket {
  const lane = laneId(job);
  return {
    jobId: job.job_id,
    name: job.name ?? "unnamed",
    lane,
    signal: signalFor(job, lane),
    request: `${job.cpus} CPU / ${job.gpu_count} GPU`
  };
}

function laneId(job: QueueJob): TrafficLaneId {
  if (job.state === "RUNNING" || job.state === "COMPLETING" || job.state === "CONFIGURING") return "running";
  if (isGated(job)) return "gated";
  if (job.estimated_start_time) return "dated";
  return "dark";
}

function isGated(job: QueueJob): boolean {
  const reason = `${job.state_reason ?? ""} ${job.reason_label ?? ""}`.toLowerCase();
  return Boolean(job.dependency) || /depend|hold|begin/.test(reason);
}

function detailFor(id: TrafficLaneId, count: number, cpus: number, gpus: number): string {
  if (id === "running") return count ? `${count} job${plural(count)} burning ${gpus} GPU / ${cpus} CPU now.` : "No visible job is consuming allocation time.";
  if (id === "dated") return count ? `${count} pending job${plural(count)} ${verb(count, "has", "have")} a public Slurm start estimate.` : "No pending job has a public start estimate.";
  if (id === "gated") return count ? `${count} pending job${plural(count)} ${verb(count, "is", "are")} blocked before resources, priority, or backfill can move it.` : "No dependency, hold, or begin-time gate is visible.";
  return count ? `${count} pending job${plural(count)} lack both a gate and a start estimate.` : "No pending job is waiting without a start estimate or gate.";
}

function headlineFor(running: TrafficLane, dated: TrafficLane, gated: TrafficLane, dark: TrafficLane): string {
  if (gated.gpus > 0) return `${gated.gpus} GPU${plural(gated.gpus)} ${verb(gated.gpus, "is", "are")} locked behind scheduler gates; clear dependencies before treating this as raw scarcity.`;
  if (dark.count) return `${dark.count} pending job${plural(dark.count)} are in the least legible lane: no gate, no dated start.`;
  if (dated.count) return `${dated.count} pending job${plural(dated.count)} have dated starts while ${running.count} allocation${plural(running.count)} run.`;
  if (running.count) return `${running.count} visible allocation${plural(running.count)} are running and no pending traffic is exposed.`;
  return "No visible queue traffic is moving through this filtered view.";
}

function actionFor(dated: TrafficLane, gated: TrafficLane, dark: TrafficLane): string {
  if (gated.count) return "Resolve gates first; reshaping gated jobs will not create scheduler motion.";
  if (dark.count) return "Probe priority and resources before waiting blindly.";
  if (dated.count) return "Protect dated starts and avoid churn unless estimates slip.";
  return "Use this lane view after jobs enter the queue.";
}

function signalFor(job: QueueJob, lane: TrafficLaneId): string {
  if (lane === "running") return job.nodes.length ? `running on ${job.nodes.join(", ")}` : "running";
  if (lane === "gated") return job.dependency ?? job.state_reason ?? "scheduler gate";
  if (lane === "dated") return `start ${shortTime(job.estimated_start_time)}`;
  return job.state_reason ?? "no public motion";
}

function lane(lanes: TrafficLane[], id: TrafficLaneId): TrafficLane {
  return lanes.find((item) => item.id === id)!;
}

function compareTickets(left: TrafficTicket, right: TrafficTicket): number {
  return laneRank(right.lane) - laneRank(left.lane) || left.jobId.localeCompare(right.jobId);
}

function laneRank(id: TrafficLaneId): number {
  return { running: 0, dated: 1, dark: 2, gated: 3 }[id];
}

function sum(jobs: QueueJob[], pick: (job: QueueJob) => number): number {
  return jobs.reduce((total, job) => total + pick(job), 0);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function verb(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}
