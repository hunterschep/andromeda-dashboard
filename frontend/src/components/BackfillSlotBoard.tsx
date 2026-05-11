import { Copy, TimerReset } from "lucide-react";
import { buildBackfillSlotBoard } from "../lib/backfillSlotBoard";
import type { NodeResource, PartitionSummary, SchedulerHealth } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function BackfillSlotBoard({
  nodes,
  partitions,
  scheduler,
  alias,
  onCopy
}: {
  nodes: NodeResource[];
  partitions: PartitionSummary[];
  scheduler: SchedulerHealth | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const board = buildBackfillSlotBoard({ nodes, partitions, scheduler, alias });
  return (
    <section className="backfill-slot-board" aria-label="Backfill slot board">
      <div className="backfill-slot-head">
        <SectionTitle icon={<TimerReset size={18} />} title="Backfill Slot Board" />
        <span>{board.label}</span>
      </div>
      {board.slots.length ? (
        <>
          <p>{board.headline}</p>
          <p>{board.schedulerLine}</p>
          <div className="backfill-slot-grid">
            {board.slots.slice(0, 5).map((slot) => (
              <article className={`backfill-slot-row tone-${slot.tone}`} key={slot.id}>
                <div className="backfill-slot-title">
                  <div>
                    <strong>{slot.label}</strong>
                    <span>{slot.request}</span>
                  </div>
                  <button
                    type="button"
                    className="copy-button"
                    title={`Copy ${slot.label} backfill probe`}
                    aria-label={`Copy ${slot.label} backfill probe`}
                    onClick={() => onCopy(slot.command, `${slot.label} backfill`)}
                  >
                    <Copy size={15} aria-hidden="true" />
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>partition</dt>
                    <dd>{slot.partition}</dd>
                  </div>
                  <div>
                    <dt>window</dt>
                    <dd>{slot.window}</dd>
                  </div>
                  <div>
                    <dt>fits</dt>
                    <dd>{slot.fitNodes}</dd>
                  </div>
                  <div>
                    <dt>best node</dt>
                    <dd>{slot.bestNode}</dd>
                  </div>
                </dl>
                <p>{slot.detail}</p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <EmptyState text="Backfill slot board needs visible partition and node inventory." />
      )}
    </section>
  );
}
