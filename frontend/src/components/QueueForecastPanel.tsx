import { AlertTriangle } from "lucide-react";
import { formatDuration, shortTime } from "../api";
import type { QueueForecast } from "../lib/intelligence";
import { EmptyState, SectionTitle } from "./common";

export function QueueForecastPanel({ forecast }: { forecast: QueueForecast }) {
  return (
    <div className="queue-forecast-panel">
      <div className="queue-forecast-head">
        <SectionTitle icon={<AlertTriangle size={18} />} title="Scheduler Interpreter" />
        <div>
          <span>{forecast.withEstimate}/{forecast.pending} with start estimates</span>
          <span>median wait {formatDuration(forecast.medianWaitSeconds)}</span>
        </div>
      </div>
      <div className="forecast-bands">
        {forecast.bands.map((band) => (
          <div key={band.label} className={`forecast-band tone-${band.tone}`}>
            <span>{band.label}</span>
            <strong>{band.count}</strong>
          </div>
        ))}
      </div>
      {forecast.earliestStart ? (
        <p className="forecast-earliest">Earliest visible start: {shortTime(forecast.earliestStart)}</p>
      ) : null}
      <PriorityLens forecast={forecast} />
      <QueueExplanations forecast={forecast} />
    </div>
  );
}

function PriorityLens({ forecast }: { forecast: QueueForecast }) {
  if (!forecast.priorityLens.length) return null;
  return (
    <div className="priority-lens">
      <div>
        <strong>Priority Lens</strong>
        <span>{forecast.priorityWeight ? `${forecast.priorityWeight} weight visible` : "weights unavailable"}</span>
      </div>
      <div className="priority-list">
        {forecast.priorityLens.map((item) => (
          <article key={item.jobId} className={`priority-item tone-${item.tone}`}>
            <div>
              <strong className="mono">#{item.rank}</strong>
              <span>{item.jobName}</span>
              <em>{item.priority.toLocaleString()}</em>
            </div>
            <div className="priority-meter" aria-label={`${item.jobId} priority`}>
              <i style={{ width: `${item.percentile}%` }} />
            </div>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function QueueExplanations({ forecast }: { forecast: QueueForecast }) {
  if (!forecast.explanations.length) {
    return <EmptyState text="No pending jobs need interpretation in this scope." />;
  }
  return (
    <div className="queue-explanations">
      {forecast.explanations.map((item) => (
        <article key={item.jobId} className={`queue-explanation tone-${item.tone}`}>
          <div className="queue-explanation-title">
            <strong className="mono">{item.jobId}</strong>
            <span>{item.jobName}</span>
            <em>{item.waitBand}</em>
          </div>
          <dl>
            <div>
              <dt>user</dt>
              <dd>{item.user}</dd>
            </div>
            <div>
              <dt>partition</dt>
              <dd>{item.partition}</dd>
            </div>
            <div>
              <dt>request</dt>
              <dd>{item.request}</dd>
            </div>
            <div>
              <dt>confidence</dt>
              <dd>{item.confidence}</dd>
            </div>
          </dl>
          <p>{item.explanation}</p>
          <span>{item.recommendation}</span>
        </article>
      ))}
    </div>
  );
}
