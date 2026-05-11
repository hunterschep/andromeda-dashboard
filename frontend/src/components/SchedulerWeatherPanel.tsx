import { Copy, Gauge } from "lucide-react";
import { buildSchedulerWeather } from "../lib/schedulerWeather";
import type { SchedulerHealth } from "../types";
import { SectionTitle } from "./common";

export function SchedulerWeatherPanel({
  scheduler,
  pendingJobs,
  alias,
  onCopy
}: {
  scheduler: SchedulerHealth | null;
  pendingJobs: number;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const weather = buildSchedulerWeather(scheduler, pendingJobs, alias);
  return (
    <article className={`scheduler-weather-panel tone-${weather.tone}`}>
      <div className="scheduler-weather-head">
        <SectionTitle icon={<Gauge size={18} />} title="Scheduler Weather" />
        <span>{weather.label}</span>
      </div>
      <p>{weather.summary}</p>
      <dl className="scheduler-weather-grid">
        {weather.signals.map((signal) => (
          <div key={signal.label}>
            <dt>{signal.label}</dt>
            <dd>{signal.value}</dd>
            <span>{signal.detail}</span>
          </div>
        ))}
      </dl>
      <div className="scheduler-weather-action">
        <span>{weather.action}</span>
        <button type="button" className="copy-button" onClick={() => onCopy(weather.command, "scheduler weather")}>
          <Copy size={15} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
