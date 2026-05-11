import { Activity, Copy } from "lucide-react";
import { buildCudaTelemetry } from "../lib/cudaTelemetry";
import type { HistoryResponse } from "../types";
import { SectionTitle } from "./common";

export function CudaTelemetryPanel({
  history,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const telemetry = buildCudaTelemetry(history?.jobs ?? [], alias);
  return (
    <div className="cuda-panel">
      <div className="cuda-head">
        <SectionTitle icon={<Activity size={18} />} title="CUDA Telemetry" />
        <span>{telemetry.label}</span>
      </div>
      <dl className="cuda-summary">
        <div>
          <dt>GPU jobs</dt>
          <dd>{telemetry.gpuJobs}</dd>
        </div>
        <div>
          <dt>median util</dt>
          <dd>{telemetry.medianUtil === null ? "n/a" : `${telemetry.medianUtil}%`}</dd>
        </div>
        <div>
          <dt>max VRAM</dt>
          <dd>{telemetry.maxMemoryMb === null ? "n/a" : `${Math.round(telemetry.maxMemoryMb / 1024)}GB`}</dd>
        </div>
      </dl>
      <p>{telemetry.summary}</p>
      {telemetry.jobs.length ? (
        <div className="cuda-list">
          {telemetry.jobs.slice(0, 5).map((job) => (
            <article className={`cuda-row tone-${job.tone}`} key={job.jobId}>
              <div className="cuda-title">
                <div>
                  <strong>{job.title}</strong>
                  <span className="mono">{job.jobId} / {job.name}</span>
                </div>
                <button
                  type="button"
                  className="copy-button"
                  onClick={() => onCopy(job.command, `${job.jobId} cuda telemetry`)}
                  title={`Copy CUDA accounting probe for ${job.jobId}`}
                >
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="cuda-bars">
                <div>
                  <span>util</span>
                  <i><b style={{ width: `${job.gpuUtil ?? 0}%` }} /></i>
                  <strong>{job.gpuUtil === null ? "n/a" : `${job.gpuUtil}%`}</strong>
                </div>
                <div>
                  <span>VRAM</span>
                  <i><b style={{ width: `${memoryWidth(job.gpuMemoryMb)}%` }} /></i>
                  <strong>{job.gpuMemoryMb === null ? "n/a" : `${Math.round(job.gpuMemoryMb / 1024)}GB`}</strong>
                </div>
              </div>
              <p>{job.detail}</p>
              <em>{job.action}</em>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function memoryWidth(value: number | null): number {
  if (value === null) return 0;
  return Math.min(100, Math.round((value / (80 * 1024)) * 100));
}
