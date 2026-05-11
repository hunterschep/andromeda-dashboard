import { Copy, HardDrive, ListChecks } from "lucide-react";
import { buildStorageTriage } from "../lib/storageTriage";
import type { StorageResponse } from "../types";
import { SectionTitle } from "./common";

export function StorageTriagePanel({
  storage,
  alias,
  onCopy
}: {
  storage: StorageResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const triage = buildStorageTriage(storage, alias);

  return (
    <div className={`storage-triage storage-triage-${triage.level}`}>
      <div className="storage-triage-head">
        <SectionTitle icon={<HardDrive size={18} />} title="Storage Triage" />
        <div>
          <span>{triage.label}</span>
          <button
            type="button"
            className="copy-button"
            onClick={() => onCopy(triage.quotaCommand, "quota probe")}
            title="Copy quota probe"
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p>{triage.summary}</p>
      {!storage?.volumes.length ? (
        <div className="storage-clear-line">
          <ListChecks size={16} aria-hidden="true" />
          <span>Copy the quota probe to refresh home, scratch, and file-count visibility.</span>
        </div>
      ) : triage.signals.length ? (
        <div className="storage-triage-grid">
          {triage.signals.slice(0, 4).map((signal) => (
            <article className={`storage-signal severity-${signal.severity}`} key={signal.id}>
              <div className="storage-signal-title">
                <div>
                  <strong>{signal.title}</strong>
                  <span className="mono">{signal.path}</span>
                </div>
                <b>{signal.value}</b>
              </div>
              <p>{signal.impact}</p>
              <div className="storage-action-line">
                <ListChecks size={15} aria-hidden="true" />
                <span>{signal.nextStep}</span>
              </div>
              <button
                type="button"
                className="storage-triage-copy"
                onClick={() => onCopy(signal.command, `${signal.volume} ${signal.kind} triage`)}
                title={`Copy ${signal.volume} ${signal.kind} triage command`}
              >
                <Copy size={14} aria-hidden="true" />
                <span>Copy triage</span>
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="storage-clear-line">
          <ListChecks size={16} aria-hidden="true" />
          <span>No quota edge is visible; keep large datasets in scratch or project storage and out of home.</span>
        </div>
      )}
    </div>
  );
}
