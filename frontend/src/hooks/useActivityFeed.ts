import { useEffect, useRef, useState } from "react";
import { buildActivityEvents, type ActivityEvent, type ActivitySnapshot } from "../lib/activity";
import type { QueueResponse, ResourceResponse } from "../types";

export function useActivityFeed({
  resources,
  queue,
  loadedAt
}: {
  resources: ResourceResponse | null;
  queue: QueueResponse | null;
  loadedAt: string | null;
}) {
  const previous = useRef<ActivitySnapshot | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    if (!resources || !queue || !loadedAt) return;
    const current = { resources, queue };
    const nextEvents = buildActivityEvents(previous.current, current, loadedAt);
    setEvents((existing) => [...nextEvents, ...existing].slice(0, 18));
    previous.current = current;
  }, [resources, queue, loadedAt]);

  return events;
}
