import { Copy, FlaskConical } from "lucide-react";
import { buildBackfillRecipes } from "../lib/backfillRecipes";
import type { GpuPool, PartitionSummary, QueueJob, SchedulerHealth, StorageResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function BackfillRecipeBuilder({
  partitions,
  gpuPools,
  jobs,
  storage,
  scheduler,
  onCopy
}: {
  partitions: PartitionSummary[];
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  storage: StorageResponse | null;
  scheduler: SchedulerHealth | null;
  onCopy: (text: string, label: string) => void;
}) {
  const builder = buildBackfillRecipes({ partitions, gpuPools, jobs, storage, scheduler });
  return (
    <section className="backfill-recipes" aria-label="Backfill recipe builder">
      <div className="backfill-recipes-head">
        <SectionTitle icon={<FlaskConical size={18} />} title="Backfill Recipe Builder" />
        <span>{builder.label}</span>
      </div>
      <p>{builder.headline}</p>
      {builder.recipes.length ? (
        <div className="backfill-recipe-grid">
          {builder.recipes.slice(0, 4).map((recipe) => (
            <article className={`backfill-recipe-row status-${recipe.status}`} key={recipe.id}>
              <div className="backfill-recipe-title">
                <div>
                  <strong>{recipe.title}</strong>
                  <span>{recipe.signal}</span>
                </div>
                <button type="button" className="copy-button" onClick={() => onCopy(recipe.snippet, `${recipe.title} recipe`)}>
                  <Copy size={15} aria-hidden="true" />
                </button>
              </div>
              <p>{recipe.detail}</p>
              <code>{recipe.snippet}</code>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No backfill recipes can be built from this snapshot." />
      )}
    </section>
  );
}
