import { Copy, TerminalSquare } from "lucide-react";
import { buildEnvironmentPreflight } from "../lib/environmentPreflight";
import type { GpuPool, HistoryResponse, StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function EnvironmentPreflightPanel({
  history,
  storage,
  gpuPools,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  gpuPools: GpuPool[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const preflight = buildEnvironmentPreflight({ history, storage, gpuPools, alias });
  return (
    <section className={`env-preflight env-${preflight.status}`} aria-label="Environment preflight">
      <div className="env-preflight-head">
        <SectionTitle icon={<TerminalSquare size={18} />} title="Environment Preflight" />
        <div>
          <span>{preflight.label}</span>
          <button type="button" className="copy-button" onClick={() => onCopy(preflight.command, "environment preflight")}>
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{preflight.headline}</p>
      <div className="env-preflight-grid">
        {preflight.checks.map((check) => (
          <article className={`env-check status-${check.status}`} key={check.id}>
            <div>
              <strong>{check.label}</strong>
              <span>{check.value}</span>
            </div>
            <p>{check.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
