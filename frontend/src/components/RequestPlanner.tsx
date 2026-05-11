import { Copy, FlaskConical, Route, SquareTerminal } from "lucide-react";
import { useMemo, useState } from "react";
import { defaultPlannerInput, jupyterForRequest, planRequest, sbatchForRequest, sweepForRequest, type PlannerInput } from "../lib/requestPlanner";
import type { AccountLimits, GpuPool, HistoryResponse, PartitionSummary, QueueJob, StorageResponse } from "../types";
import { NextLaunchImpact } from "./NextLaunchImpact";
import { SectionTitle } from "./common";
import { PolicyGuardrailsPanel } from "./PolicyGuardrails";

export function RequestPlannerPanel({
  partitions,
  gpuPools,
  jobs,
  history,
  storage,
  accountLimits,
  alias,
  onCopy
}: {
  partitions: PartitionSummary[];
  gpuPools: GpuPool[];
  jobs: QueueJob[];
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  accountLimits: AccountLimits | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const defaults = useMemo(() => defaultPlannerInput(gpuPools, partitions), [gpuPools, partitions]);
  const [input, setInput] = useState<PlannerInput>(defaults);
  const results = useMemo(() => planRequest({ input, partitions, jobs, history }), [input, partitions, jobs, history]);
  const best = results[0] ?? null;
  const jupyter = useMemo(() => jupyterForRequest(input, best, alias), [input, best, alias]);
  const sweep = useMemo(() => sweepForRequest(input, best), [input, best]);

  function update<K extends keyof PlannerInput>(key: K, value: PlannerInput[K]) {
    setInput((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="planner-panel">
      <div className="planner-head">
        <SectionTitle icon={<Route size={18} />} title="Request Planner" />
        <button
          type="button"
          className="icon-button"
          onClick={() => onCopy(sbatchForRequest(input, best), "request plan")}
          title="Copy sbatch scaffold"
        >
          <Copy size={16} aria-hidden="true" />
          <span>Copy sbatch</span>
        </button>
      </div>
      <PlannerControls input={input} partitions={partitions} gpuPools={gpuPools} update={update} />
      <PolicyGuardrailsPanel
        input={input}
        accountLimits={accountLimits}
        partitions={partitions}
        partition={best?.partition ?? (input.partition === "auto" ? null : input.partition)}
        jobs={jobs}
      />
      <NextLaunchImpact
        input={input}
        best={best}
        gpuPools={gpuPools}
        jobs={jobs}
        history={history}
        storage={storage}
        accountLimits={accountLimits}
        alias={alias}
        onCopy={onCopy}
      />
      <JupyterLauncher
        jupyter={jupyter}
        partition={best?.partition ?? (input.partition === "auto" ? "interactive" : input.partition)}
        onCopy={onCopy}
      />
      <SweepLauncher sweep={sweep} onCopy={onCopy} />
      <div className="planner-results">
        {results.slice(0, 4).map((result) => (
          <article key={result.partition} className={`planner-result status-${result.status}`}>
            <div>
              <strong className="mono">{result.partition}</strong>
              <span>{result.constraint}</span>
            </div>
            <div className="planner-score" aria-label={`${result.partition} score ${result.score}`}>
              <span style={{ width: `${result.score}%` }} />
            </div>
            <dl>
              <div>
                <dt>fit</dt>
                <dd>{result.status}</dd>
              </div>
              <div>
                <dt>wait</dt>
                <dd>{result.waitBand}</dd>
              </div>
            </dl>
            <p>{result.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function SweepLauncher({
  sweep,
  onCopy
}: {
  sweep: ReturnType<typeof sweepForRequest>;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="sweep-launcher">
      <div>
        <SectionTitle icon={<FlaskConical size={18} />} title="Sweep Launcher" />
        <span>{sweep.shape}</span>
      </div>
      <div className="sweep-actions">
        <button type="button" className="icon-button" onClick={() => onCopy(sweep.script, "sweep job")}>
          <Copy size={16} aria-hidden="true" />
          <span>Copy sweep job</span>
        </button>
        <button type="button" className="icon-button" onClick={() => onCopy(sweep.submitCommand, "sweep submit")}>
          <Copy size={16} aria-hidden="true" />
          <span>Copy submit</span>
        </button>
      </div>
      <code>#SBATCH --array=0-31%8</code>
    </div>
  );
}

function JupyterLauncher({
  jupyter,
  partition,
  onCopy
}: {
  jupyter: ReturnType<typeof jupyterForRequest>;
  partition: string;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <div className="jupyter-launcher">
      <div>
        <SectionTitle icon={<SquareTerminal size={18} />} title="Jupyter Launcher" />
        <span>{partition} / compute-node session</span>
      </div>
      <div className="jupyter-actions">
        <button type="button" className="icon-button" onClick={() => onCopy(jupyter.script, "notebook job")}>
          <Copy size={16} aria-hidden="true" />
          <span>Copy notebook job</span>
        </button>
        <button type="button" className="icon-button" onClick={() => onCopy(jupyter.nodeCommand, "notebook node")}>
          <Copy size={16} aria-hidden="true" />
          <span>Copy node probe</span>
        </button>
        <button type="button" className="icon-button" onClick={() => onCopy(jupyter.tunnelCommand, "notebook tunnel")}>
          <Copy size={16} aria-hidden="true" />
          <span>Copy tunnel</span>
        </button>
      </div>
      <code>{jupyter.openUrl}</code>
    </div>
  );
}

function PlannerControls({
  input,
  partitions,
  gpuPools,
  update
}: {
  input: PlannerInput;
  partitions: PartitionSummary[];
  gpuPools: GpuPool[];
  update: <K extends keyof PlannerInput>(key: K, value: PlannerInput[K]) => void;
}) {
  return (
    <div className="planner-controls">
      <PlannerSelect
        label="Partition"
        value={input.partition}
        onChange={(value) => update("partition", value)}
        options={[{ value: "auto", label: "Auto" }, ...partitions.map((partition) => ({ value: partition.name, label: partition.name }))]}
      />
      <PlannerSelect
        label="GPU type"
        value={input.gpuType}
        onChange={(value) => update("gpuType", value)}
        options={[{ value: "any", label: "Any" }, ...gpuPools.map((pool) => ({ value: pool.type, label: pool.type }))]}
      />
      <NumberField label="GPUs" value={input.gpus} min={0} max={16} onChange={(value) => update("gpus", value)} />
      <NumberField label="CPUs" value={input.cpus} min={1} max={256} onChange={(value) => update("cpus", value)} />
      <NumberField label="Memory GB" value={input.memoryGb} min={1} max={2048} onChange={(value) => update("memoryGb", value)} />
      <NumberField label="Hours" value={input.hours} min={1} max={120} onChange={(value) => update("hours", value)} />
    </div>
  );
}

function PlannerSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))}
      />
    </label>
  );
}
