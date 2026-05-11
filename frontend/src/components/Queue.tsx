import { Gauge, MessageSquareText, Users } from "lucide-react";
import { formatMemory, formatNumber, shortTime } from "../api";
import { decodePendingReasons } from "../lib/reasonDecoder";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

type QueuePressure = {
  running: number;
  pending: number;
  pendingCpus: number;
  pendingGpus: number;
  reasons: [string, number][];
  partitions: [string, number][];
  gpus: [string, number][];
};

type UserWorkload = {
  user: string;
  running: number;
  pending: number;
  cpus: number;
  gpus: number;
};

export function QueueTable({ jobs }: { jobs: QueueJob[] }) {
  if (!jobs.length) return <EmptyState text="No jobs match the current filters." />;
  return (
    <div className="table-wrap queue-table">
      <table aria-label="Queue jobs">
        <thead>
          <tr>
            <th>Job</th>
            <th>User</th>
            <th>Partition</th>
            <th>State</th>
            <th>Request</th>
            <th>Reason</th>
            <th>Estimate</th>
            <th>Nodes</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job_id}>
              <td>
                <strong className="mono">{job.job_id}</strong>
                <span>{job.name ?? (job.anonymized ? "anonymized" : "unnamed")}</span>
              </td>
              <td>{job.user}</td>
              <td>{job.partition ?? "n/a"}</td>
              <td>{job.state}</td>
              <td>
                {job.cpus} CPU, {formatMemory(job.memory_mb)}, {job.gpu_count || 0} GPU
              </td>
              <td>{job.reason_label ?? job.state_reason ?? "n/a"}</td>
              <td>{shortTime(job.estimated_start_time)}</td>
              <td>{job.nodes.join(", ") || "pending"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QueuePressurePanel({ summary }: { summary: QueuePressure }) {
  return (
    <div className="intel-panel">
      <div className="intel-heading">
        <SectionTitle icon={<Gauge size={18} />} title="Queue Pressure" />
      </div>
      <dl className="compact-dl four-up">
        <div>
          <dt>Running</dt>
          <dd>{summary.running}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{summary.pending}</dd>
        </div>
        <div>
          <dt>Pending CPU</dt>
          <dd>{formatNumber(summary.pendingCpus)}</dd>
        </div>
        <div>
          <dt>Pending GPU</dt>
          <dd>{summary.pendingGpus}</dd>
        </div>
      </dl>
      <div className="intel-columns">
        <MiniRank title="Reasons" rows={summary.reasons} empty="none" />
        <MiniRank title="Partitions" rows={summary.partitions} empty="none" />
        <MiniRank title="GPU asks" rows={summary.gpus} empty="none" />
      </div>
    </div>
  );
}

export function ReasonDecoderPanel({ jobs }: { jobs: QueueJob[] }) {
  const reasons = decodePendingReasons(jobs);
  return (
    <div className="reason-decoder">
      <div className="intel-heading">
        <SectionTitle icon={<MessageSquareText size={18} />} title="Reason Decoder" />
      </div>
      {reasons.length ? (
        <div className="reason-list">
          {reasons.slice(0, 4).map((item) => (
            <article className={`reason-row severity-${item.severity}`} key={item.reason}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.count} job{item.count === 1 ? "" : "s"}</span>
              </div>
              <dl>
                <div>
                  <dt>reason</dt>
                  <dd>{item.reason}</dd>
                </div>
                <div>
                  <dt>demand</dt>
                  <dd>{item.demand}</dd>
                </div>
              </dl>
              <p>{item.explanation}</p>
              <em>{item.action}</em>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No pending reasons to decode in the current filters." />
      )}
    </div>
  );
}

export function UserWorkloadPanel({ users }: { users: UserWorkload[] }) {
  return (
    <div className="intel-panel">
      <div className="intel-heading">
        <SectionTitle icon={<Users size={18} />} title="Visible Users" />
      </div>
      {users.length ? (
        <div className="user-workload">
          {users.slice(0, 8).map((user) => (
            <div key={user.user}>
              <strong>{user.user}</strong>
              <span>
                {user.running} run / {user.pending} pend
              </span>
              <em>
                {formatNumber(user.cpus)} CPU / {user.gpus} GPU
              </em>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No visible users in this scope." />
      )}
    </div>
  );
}

function MiniRank({ title, rows, empty }: { title: string; rows: [string, number][]; empty: string }) {
  return (
    <div className="mini-rank">
      <strong>{title}</strong>
      {rows.length ? (
        rows.slice(0, 5).map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <em>{count}</em>
          </div>
        ))
      ) : (
        <div>
          <span>{empty}</span>
          <em>0</em>
        </div>
      )}
    </div>
  );
}
