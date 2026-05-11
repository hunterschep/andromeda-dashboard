import { Scale } from "lucide-react";
import type { PriorityJob, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

const FACTORS = [
  ["age", "age"],
  ["fairshare", "fairshare"],
  ["job_size", "size"],
  ["partition", "partition"],
  ["qos", "qos"],
  ["tres", "tres"]
] as const;

export function PriorityFactorsPanel({
  jobs,
  priorityJobs
}: {
  jobs: QueueJob[];
  priorityJobs: PriorityJob[];
}) {
  const pending = new Map(jobs.filter((job) => job.state === "PENDING").map((job) => [job.job_id, job]));
  const rows = priorityJobs
    .filter((item) => pending.has(item.job_id))
    .sort((left, right) => right.priority - left.priority || left.job_id.localeCompare(right.job_id))
    .slice(0, 5);

  return (
    <section className="priority-factors" aria-label="Priority factor breakdown">
      <div className="priority-factors-head">
        <SectionTitle icon={<Scale size={18} />} title="Priority Anatomy" />
        <span>{rows.length ? `${rows.length} pending jobs decoded` : "sprio factors unavailable"}</span>
      </div>
      {rows.length ? (
        <div className="priority-factor-list">
          {rows.map((item) => (
            <PriorityFactorRow key={item.job_id} item={item} job={pending.get(item.job_id)} />
          ))}
        </div>
      ) : (
        <EmptyState text="Priority factors appear when Slurm returns sprio rows for visible pending jobs." />
      )}
    </section>
  );
}

function PriorityFactorRow({ item, job }: { item: PriorityJob; job: QueueJob | undefined }) {
  const max = Math.max(...FACTORS.map(([key]) => item[key]), 1);
  return (
    <article className={`priority-factor-row dominant-${item.dominant_factor ?? "none"}`}>
      <div className="priority-factor-title">
        <div>
          <strong>{job?.name ?? item.job_id}</strong>
          <span className="mono">{item.job_id} / {job?.partition ?? "n/a"}</span>
        </div>
        <em>{formatScore(item.priority)}</em>
      </div>
      <div className="priority-factor-bars">
        {FACTORS.map(([key, label]) => (
          <div key={`${item.job_id}-${key}`}>
            <span>{label}</span>
            <i>
              <b style={{ width: `${Math.max(3, Math.round((item[key] / max) * 100))}%` }} />
            </i>
            <strong>{formatScore(item[key])}</strong>
          </div>
        ))}
      </div>
      <p>{factorMessage(item.dominant_factor, job)}</p>
    </article>
  );
}

function formatScore(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 10) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function factorMessage(factor: string | null, job: QueueJob | undefined): string {
  const shape = `${job?.cpus ?? 0} CPU / ${job?.gpu_count ?? 0} GPU`;
  if (factor === "fairshare") return `Fairshare is the largest visible contribution; recent account usage is shaping this ${shape} request.`;
  if (factor === "age") return "Age is doing most of the work; cancelling and resubmitting would reset that queue advantage.";
  if (factor === "tres") return `TRES weighting is prominent, so the requested CPU/GPU/memory shape matters for this ${shape} job.`;
  if (factor === "qos") return "QOS dominates the score; account policy is more important here than raw node availability.";
  if (factor === "partition") return "Partition weighting is driving priority; compare eligible partitions before changing the script.";
  if (factor === "job_size") return "Job size is a major contributor; smaller probes and arrays may backfill differently.";
  return "Slurm returned a composite priority, but no single factor is visibly dominant.";
}
