import { UsersRound } from "lucide-react";
import { buildLabFootprint } from "../lib/labFootprint";
import type { QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function LabFootprintPanel({ jobs }: { jobs: QueueJob[] }) {
  const footprint = buildLabFootprint(jobs);
  if (!footprint.users.length) return <EmptyState text="No active user footprint in this queue scope." />;
  return (
    <div className="lab-footprint-panel">
      <div className="lab-footprint-head">
        <SectionTitle icon={<UsersRound size={18} />} title="Lab Footprint" />
        <span>{footprint.totalUsers} users / top {footprint.concentration}%</span>
      </div>
      <p>{footprint.headline}</p>
      <dl className="lab-footprint-summary">
        <div>
          <dt>CPU</dt>
          <dd>{footprint.totalCpus}</dd>
        </div>
        <div>
          <dt>GPU</dt>
          <dd>{footprint.totalGpus}</dd>
        </div>
        <div>
          <dt>users</dt>
          <dd>{footprint.totalUsers}</dd>
        </div>
      </dl>
      <div className="lab-footprint-users">
        {footprint.users.slice(0, 5).map((user) => (
          <article key={user.user} className={`tone-${user.tone}`}>
            <div>
              <strong>{user.user}</strong>
              <span>{user.share}%</span>
            </div>
            <div className="footprint-track" aria-label={`${user.user} visible footprint`}>
              <span style={{ width: `${user.share}%` }} />
            </div>
            <p>{user.running} run / {user.pending} pend / {user.cpus} CPU / {user.gpus} GPU</p>
            <em>{user.message}</em>
          </article>
        ))}
      </div>
    </div>
  );
}
