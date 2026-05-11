import { Copy, FileText } from "lucide-react";
import { buildSupportPackets } from "../lib/supportPacket";
import type { HistoryResponse } from "../types";
import { EmptyState, SectionTitle } from "./common";

export function SupportPacketBuilder({
  history,
  alias,
  onCopy
}: {
  history: HistoryResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const support = buildSupportPackets(history?.jobs ?? [], alias);
  return (
    <div className="support-packet-panel">
      <div className="support-packet-head">
        <SectionTitle icon={<FileText size={18} />} title="Support Packet Builder" />
        <span>{support.label}</span>
      </div>
      <p>{support.message}</p>
      {support.packets.length ? (
        <div className="support-packet-list">
          {support.packets.map((packet) => (
            <article className={`support-packet-row tone-${packet.tone}`} key={packet.jobId}>
              <div className="support-packet-title">
                <div>
                  <strong>{packet.title}</strong>
                  <span className="mono">{packet.jobId}</span>
                </div>
                <button
                  type="button"
                  className="runbook-command"
                  onClick={() => onCopy(packet.command, `support packet ${packet.jobId}`)}
                >
                  <Copy size={14} aria-hidden="true" />
                  Copy support packet
                </button>
              </div>
              <p>{packet.detail}</p>
              <dl>
                {packet.facts.map((fact) => (
                  <div key={`${packet.jobId}-${fact.label}`}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState text="No failed jobs need support packets in this history window." />
      )}
    </div>
  );
}
