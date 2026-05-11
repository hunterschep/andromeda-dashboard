import { RadioTower } from "lucide-react";
import type { TelemetryResponse, TelemetrySample } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function TelemetryPanel({ telemetry }: { telemetry: TelemetryResponse | null }) {
  return (
    <article className="telemetry-panel">
      <div className="telemetry-head">
        <SectionTitle icon={<RadioTower size={18} />} title="Trend Memory" />
        <span>{telemetry?.summary.count ?? 0} samples</span>
      </div>
      {telemetry?.samples.length ? (
        <>
          <dl className="telemetry-summary">
            <div>
              <dt>peak pending</dt>
              <dd>{telemetry.summary.peak_pending}</dd>
            </div>
            <div>
              <dt>low GPU</dt>
              <dd>{telemetry.summary.lowest_gpu_free}</dd>
            </div>
            <div>
              <dt>pressure</dt>
              <dd>{telemetry.summary.latest_pressure}%</dd>
            </div>
            <div>
              <dt>quiet hour</dt>
              <dd>{hourText(telemetry.summary.quietest_hour)}</dd>
            </div>
          </dl>
          <div className="telemetry-spark" aria-label="Pending queue telemetry">
            {telemetry.samples.slice(-32).map((sample) => (
              <span
                key={sample.captured_at}
                style={{ height: `${sparkHeight(sample.pending, telemetry.summary.peak_pending)}%` }}
                title={`${sample.pending} pending / ${sample.gpu_free} GPU free`}
              />
            ))}
          </div>
          <div className="pressure-replay">
            <div>
              <strong>Pressure Replay</strong>
              <span>{replaySummary(telemetry.samples)}</span>
            </div>
            <div className="replay-cells" aria-label="Historical pressure replay">
              {telemetry.samples.slice(-18).map((sample) => (
                <i
                  key={`replay-${sample.captured_at}`}
                  className={`tone-${pressureTone(sample)}`}
                  title={`${timeText(sample.captured_at)}: ${sample.pending} pending, ${sample.gpu_free}/${sample.gpu_total} GPU free`}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <EmptyState text="Trend memory starts after snapshots are recorded." />
      )}
    </article>
  );
}

function sparkHeight(value: number, max: number): number {
  if (max <= 0) return 14;
  return Math.max(14, Math.round((value / max) * 100));
}

function hourText(hour: number | null): string {
  if (hour === null) return "n/a";
  return `${String(hour).padStart(2, "0")}:00`;
}

function pressureTone(sample: TelemetrySample): "low" | "medium" | "high" {
  const gpuPressure = sample.gpu_total ? 1 - sample.gpu_free / sample.gpu_total : 0;
  const cpuPressure = sample.cpus_total ? 1 - sample.cpus_idle / sample.cpus_total : 0;
  const queuePressure = Math.min(1, sample.pending / 16);
  const pressure = Math.max(gpuPressure, cpuPressure, queuePressure);
  if (pressure >= 0.75) return "high";
  if (pressure >= 0.45) return "medium";
  return "low";
}

function replaySummary(samples: TelemetrySample[]): string {
  const latest = samples[samples.length - 1];
  if (!latest) return "waiting for samples";
  return `${latest.pending} pending, ${latest.gpu_free}/${latest.gpu_total} GPU free at ${timeText(latest.captured_at)}`;
}

function timeText(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
