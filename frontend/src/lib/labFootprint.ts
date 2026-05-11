import type { QueueJob } from "../types";

export type FootprintUser = {
  user: string;
  running: number;
  pending: number;
  cpus: number;
  gpus: number;
  pendingGpus: number;
  share: number;
  tone: "calm" | "busy" | "hot";
  message: string;
};

export type LabFootprint = {
  totalUsers: number;
  totalCpus: number;
  totalGpus: number;
  concentration: number;
  headline: string;
  users: FootprintUser[];
};

type UserAccumulator = Omit<FootprintUser, "share" | "tone" | "message"> & { score: number };

export function buildLabFootprint(jobs: QueueJob[]): LabFootprint {
  const active = jobs.filter((job) => job.state === "RUNNING" || job.state === "PENDING");
  const groups = new Map<string, UserAccumulator>();
  for (const job of active) {
    const current = groups.get(job.user) ?? {
      user: job.user,
      running: 0,
      pending: 0,
      cpus: 0,
      gpus: 0,
      pendingGpus: 0,
      score: 0
    };
    current.running += job.state === "RUNNING" ? 1 : 0;
    current.pending += job.state === "PENDING" ? 1 : 0;
    current.cpus += job.cpus;
    current.gpus += job.gpu_count;
    current.pendingGpus += job.state === "PENDING" ? job.gpu_count : 0;
    current.score += footprintScore(job);
    groups.set(job.user, current);
  }
  const scoreTotal = Array.from(groups.values()).reduce((sum, user) => sum + user.score, 0);
  const users = Array.from(groups.values()).map((user) => userRow(user, scoreTotal)).sort(compareUsers);
  const concentration = users[0]?.share ?? 0;
  return {
    totalUsers: users.length,
    totalCpus: active.reduce((sum, job) => sum + job.cpus, 0),
    totalGpus: active.reduce((sum, job) => sum + job.gpu_count, 0),
    concentration,
    headline: headline(users[0], users.length),
    users
  };
}

function userRow(user: UserAccumulator, total: number): FootprintUser {
  const share = total ? Math.round((user.score / total) * 100) : 0;
  const tone = share >= 60 || user.pendingGpus >= 4 ? "hot" : share >= 30 || user.pendingGpus > 0 ? "busy" : "calm";
  return {
    ...user,
    share,
    tone,
    message: user.pendingGpus > 0 ? `${user.pendingGpus} GPU(s) waiting on the scheduler.` : `${user.running} running job(s) are consuming visible resources.`
  };
}

function headline(top: FootprintUser | undefined, users: number): string {
  if (!top) return "No active user footprint is visible in this queue scope.";
  if (top.share >= 60) return `Visible pressure is concentrated around ${top.user}.`;
  if (users >= 4) return "Visible pressure is distributed across several users.";
  return "Visible pressure is shared by a small number of users.";
}

function footprintScore(job: QueueJob): number {
  const stateBias = job.state === "PENDING" ? 3 : 1.5;
  return job.gpu_count * 12 + job.cpus / 12 + stateBias;
}

function compareUsers(left: FootprintUser, right: FootprintUser): number {
  return right.share - left.share || right.pendingGpus - left.pendingGpus || right.gpus - left.gpus || left.user.localeCompare(right.user);
}
