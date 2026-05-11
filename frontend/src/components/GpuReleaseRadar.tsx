import { TimerReset } from "lucide-react";
import { buildGpuReleaseRadar } from "../lib/gpuRelease";
import type { GpuPool, QueueJob } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function GpuReleaseRadar({ pools, jobs }: { pools: GpuPool[]; jobs: QueueJob[] }) {
  const rows = buildGpuReleaseRadar(pools, jobs);
  const soon = rows.reduce((total, row) => total + row.releasingSoon, 0);
  return (
    <section className="gpu-release-panel" aria-label="GPU release radar">
      <div className="gpu-release-head">
        <SectionTitle icon={<TimerReset size={18} />} title="GPU Release Radar" />
        <span>{soon} GPUs returning inside 2h</span>
      </div>
      {rows.length ? (
        <div className="gpu-release-grid">
          {rows.slice(0, 6).map((row) => (
            <article key={row.type} className={`gpu-release-row tone-${row.tone}`}>
              <div className="gpu-release-title">
                <strong className="mono">{row.type}</strong>
                <span>{row.pending} pending / {row.usable} usable</span>
              </div>
              <div className="release-buckets">
                {row.releases.map((bucket) => (
                  <div key={`${row.type}-${bucket.label}`} className={bucket.count ? "active" : ""}>
                    <span>{bucket.label}</span>
                    <strong>{bucket.count}</strong>
                  </div>
                ))}
              </div>
              <dl>
                <div>
                  <dt>next</dt>
                  <dd>{row.nextRelease}</dd>
                </div>
                <div>
                  <dt>job</dt>
                  <dd>{row.nextJob ?? "n/a"}</dd>
                </div>
                <div>
                  <dt>undated</dt>
                  <dd>{row.undated}</dd>
                </div>
              </dl>
              <p>{row.message}</p>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No GPU jobs or GPU pools are visible in this snapshot." />
      )}
    </section>
  );
}
