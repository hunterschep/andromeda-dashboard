import { GitCompareArrows } from "lucide-react";
import { buildReplayDelta } from "../lib/replayDelta";
import type { TelemetryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function ReplayDeltaPanel({ telemetry }: { telemetry: TelemetryResponse | null }) {
  const replay = buildReplayDelta(telemetry?.samples ?? []);
  return (
    <article className="replay-delta-panel">
      <div className="replay-delta-head">
        <SectionTitle icon={<GitCompareArrows size={18} />} title="Replay Delta" />
        <span>{replay.label}</span>
      </div>
      {replay.moves.length ? (
        <>
          <p>{replay.headline}</p>
          <div className="replay-delta-grid">
            {replay.moves.map((move) => (
              <section className={`replay-delta-card tone-${move.tone}`} key={move.label}>
                <div>
                  <strong>{move.label}</strong>
                  <span>{move.value}</span>
                </div>
                <p>{move.detail}</p>
              </section>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text={replay.headline} />
      )}
    </article>
  );
}
