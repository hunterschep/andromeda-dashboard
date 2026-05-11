import { ShieldAlert } from "lucide-react";
import { useMemo } from "react";
import { evaluatePolicyGuardrails } from "../lib/policyGuardrails";
import type { PlannerInput } from "../lib/requestPlanner";
import type { AccountLimits, PartitionSummary, QueueJob } from "../types";
import { SectionTitle } from "./common";

export function PolicyGuardrailsPanel({
  input,
  accountLimits,
  partitions,
  partition,
  jobs
}: {
  input: PlannerInput;
  accountLimits: AccountLimits | null;
  partitions: PartitionSummary[];
  partition: string | null;
  jobs: QueueJob[];
}) {
  const policy = useMemo(
    () => evaluatePolicyGuardrails({ input, accountLimits, partitions, partition, jobs }),
    [input, accountLimits, partitions, partition, jobs]
  );

  return (
    <div className={`policy-panel policy-${policy.summary.status}`}>
      <div className="policy-head">
        <SectionTitle icon={<ShieldAlert size={18} />} title="Policy Guardrails" />
        <span>{policy.summary.label}</span>
      </div>
      <p>{policy.summary.message}</p>
      {policy.rows.length ? (
        <div className="policy-grid">
          {policy.rows.slice(0, 3).map((row) => (
            <article className={`policy-row policy-${row.status}`} key={row.qos}>
              <div>
                <strong className="mono">{row.qos}</strong>
                <span>{scopeLabel(row.scope)}</span>
              </div>
              <p>{row.message}</p>
              <div className="policy-checks">
                {row.checks.slice(0, 4).map((check) => (
                  <div className={`policy-check policy-${check.status}`} key={check.id}>
                    <span>{check.label}</span>
                    <strong>{check.used} / {check.limit}</strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function scopeLabel(scope: "selected" | "default" | "visible"): string {
  if (scope === "selected") return "selected path";
  if (scope === "default") return "default QOS";
  return "visible QOS";
}
