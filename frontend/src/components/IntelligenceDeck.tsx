import { Activity, Clock3, Cpu, Database, Gauge, RadioTower, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { AndromedaIntelligence, GpuScarcity, PartitionIntel, TurnoverEvent } from "../lib/intelligence";
import type { SchedulerHealth } from "../types";
import { EmptyState } from "./common";

export function CommandDeck({
  intelligence,
  scheduler,
  children
}: {
  intelligence: AndromedaIntelligence;
  scheduler: SchedulerHealth | null;
  children?: ReactNode;
}) {
  return (
    <section id="intelligence" className="operations-deck" aria-label="Operations intelligence">
      <ClusterPulse intelligence={intelligence} scheduler={scheduler} />
      <GpuScarcityTape scarcity={intelligence.gpuScarcity} />
      <PartitionPressureBoard partitions={intelligence.partitions} />
      <TurnoverPanel turnover={intelligence.cluster.turnover} />
      {children ? (
        <details className="ops-detail-drawer">
          <summary>
            <span>Live diagnostics</span>
            <em>activity, freshness, forecasts, runlists</em>
          </summary>
          <div className="ops-detail-grid">{children}</div>
        </details>
      ) : null}
    </section>
  );
}

function ClusterPulse({
  intelligence,
  scheduler
}: {
  intelligence: AndromedaIntelligence;
  scheduler: SchedulerHealth | null;
}) {
  return (
    <article className={`pulse-panel tone-${intelligence.cluster.pressureTone}`}>
      <div className="pulse-copy">
        <div className="section-title inline-title">
          <Activity size={18} aria-hidden="true" />
          <h2>Cluster Pulse</h2>
        </div>
        <strong>{intelligence.cluster.headline}</strong>
        <p>{intelligence.cluster.detail}</p>
      </div>
      <div className="pulse-graph" aria-label={`Cluster pressure ${intelligence.cluster.pressureScore} percent`}>
        {pulseBars(intelligence.cluster.pressureScore).map((height, index) => (
          <span key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
      <dl className="signal-grid">
        {intelligence.cluster.signals.map((signal) => (
          <div key={signal.label} className={`tone-${signal.tone}`}>
            <dt>{signal.label}</dt>
            <dd>{signal.value}</dd>
            <span>{signal.detail}</span>
          </div>
        ))}
      </dl>
      <div className="scheduler-strip">
        <span>
          <RadioTower size={15} aria-hidden="true" />
          backfill {scheduler?.backfill_last_depth ?? "n/a"}
        </span>
        <span>
          <Clock3 size={15} aria-hidden="true" />
          cycle {scheduler?.mean_cycle_seconds ? `${scheduler.mean_cycle_seconds.toFixed(1)}s` : "n/a"}
        </span>
        <span>
          <Gauge size={15} aria-hidden="true" />
          pressure {intelligence.cluster.pressureScore}
        </span>
      </div>
    </article>
  );
}

function GpuScarcityTape({ scarcity }: { scarcity: GpuScarcity[] }) {
  return (
    <article className="scarcity-panel">
      <div className="section-title inline-title">
        <Database size={18} aria-hidden="true" />
        <h2>GPU Scarcity Tape</h2>
      </div>
      {scarcity.length ? (
        <div className="scarcity-list">
          {scarcity.map((pool) => (
            <div key={pool.type} className={`scarcity-row tone-${pool.tone}`}>
              <div>
                <strong className="mono">{pool.type}</strong>
                <span>{pool.label}</span>
              </div>
              <GpuCells pool={pool} />
              <dl>
                <div>
                  <dt>usable</dt>
                  <dd>{pool.usable}</dd>
                </div>
                <div>
                  <dt>pending</dt>
                  <dd>{pool.pending}</dd>
                </div>
                <div>
                  <dt>nodes</dt>
                  <dd>{pool.nodesAvailable}/{pool.nodesTotal}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No GPU pools are visible in this snapshot." />
      )}
    </article>
  );
}

function GpuCells({ pool }: { pool: GpuScarcity }) {
  const visible = Math.min(pool.total, 28);
  const scale = pool.total > visible ? pool.total / visible : 1;
  return (
    <div className="gpu-cells" aria-label={`${pool.type} ${pool.used} used ${pool.free} free`}>
      {Array.from({ length: Math.max(visible, 1) }, (_item, index) => {
        const used = Math.floor(index * scale) < pool.used;
        return <span key={index} className={used ? "used" : "free"} />;
      })}
      {pool.total > visible ? <em>+{pool.total - visible}</em> : null}
    </div>
  );
}

function PartitionPressureBoard({ partitions }: { partitions: PartitionIntel[] }) {
  return (
    <article className="partition-pressure-panel">
      <div className="section-title inline-title">
        <Cpu size={18} aria-hidden="true" />
        <h2>Partition Pressure</h2>
      </div>
      {partitions.length ? (
        <div className="partition-pressure-list">
          {partitions.slice(0, 6).map((partition) => (
            <div key={partition.name} className={`partition-pressure-row tone-${partition.tone}`}>
              <div className="partition-pressure-main">
                <strong className="mono">{partition.name}</strong>
                <span>{partition.constrainedBy}</span>
              </div>
              <div className="pressure-track" aria-label={`${partition.name} pressure ${partition.pressureScore}`}>
                <span style={{ width: `${partition.pressureScore}%` }} />
              </div>
              <dl>
                <div>
                  <dt>pend</dt>
                  <dd>{partition.pending}</dd>
                </div>
                <div>
                  <dt>gpu</dt>
                  <dd>{partition.freeGpu}/{partition.totalGpu}</dd>
                </div>
                <div>
                  <dt>wait</dt>
                  <dd>{partition.waitBand}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No partition pressure data available." />
      )}
    </article>
  );
}

function TurnoverPanel({ turnover }: { turnover: TurnoverEvent[] }) {
  return (
    <article className="turnover-panel">
      <div className="section-title inline-title">
        <Zap size={18} aria-hidden="true" />
        <h2>Expected Turnover</h2>
      </div>
      {turnover.length ? (
        <div className="turnover-list">
          {turnover.map((job) => (
            <div key={job.jobId}>
              <strong className="mono">{job.label}</strong>
              <span>{job.jobName}</span>
              <em>{job.gpus} GPU / {job.cpus} CPU / {job.partition}</em>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No visible running jobs have enough timing data for turnover." />
      )}
    </article>
  );
}

function pulseBars(score: number) {
  return Array.from({ length: 36 }, (_item, index) => {
    const wave = Math.sin(index * 0.82) * 16 + Math.sin(index * 0.27) * 9;
    return Math.max(18, Math.min(96, 26 + score * 0.5 + wave));
  });
}
