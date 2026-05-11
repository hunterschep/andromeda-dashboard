import { Activity } from "lucide-react";
import { shortTime } from "../api";
import type { ActivityEvent } from "../lib/activity";
import { EmptyState, SectionTitle } from "./common";

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <article className="activity-panel">
      <div className="activity-head">
        <SectionTitle icon={<Activity size={18} />} title="Live Activity" />
        <span>{events.length ? shortTime(events[0].at) : "waiting"}</span>
      </div>
      {events.length ? (
        <div className="activity-list">
          {events.slice(0, 8).map((event) => (
            <div key={event.id} className={`activity-row tone-${event.tone}`}>
              <time>{shortTime(event.at)}</time>
              <div>
                <strong>{event.title}</strong>
                <span>{event.detail}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="Activity feed will populate after the first snapshot." />
      )}
    </article>
  );
}
