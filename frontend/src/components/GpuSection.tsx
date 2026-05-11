import { Database } from "lucide-react";
import type { GpuScarcity } from "../lib/intelligence";
import type { GpuPool, NodeResource, QueueJob } from "../types";
import { AcceleratorHourLedger } from "./AcceleratorHourLedger";
import { AcceleratorWindowPlanner } from "./AcceleratorWindowPlanner";
import { GpuFlowPanel } from "./GpuFlowPanel";
import { GpuFragmentationLens } from "./GpuFragmentationLens";
import { GpuHuntPanel } from "./GpuHuntPanel";
import { GpuLeaseBookPanel } from "./GpuLeaseBookPanel";
import { GpuMarketTape } from "./GpuMarketTape";
import { GpuOccupancyMatrix } from "./GpuOccupancyMatrix";
import { GpuReleaseRadar } from "./GpuReleaseRadar";
import { GpuShapeSwitchboard } from "./GpuShapeSwitchboard";
import { GpuTopologyPanel } from "./Intelligence";
import { GpuTurnoverLadder } from "./GpuTurnoverLadder";
import { GpuTable } from "./Resources";
import { SectionTitle } from "./common";

export function GpuSection({
  nodes,
  pools,
  jobs,
  scarcity,
  loading,
  alias,
  onCopy
}: {
  nodes: NodeResource[];
  pools: GpuPool[];
  jobs: QueueJob[];
  scarcity: GpuScarcity[];
  loading: boolean;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <section id="gpus" className="panel">
      <SectionTitle icon={<Database size={18} />} title="GPU Availability" />
      <GpuMarketTape nodes={nodes} pools={pools} jobs={jobs} alias={alias} onCopy={onCopy} />
      <AcceleratorWindowPlanner nodes={nodes} pools={pools} jobs={jobs} alias={alias} onCopy={onCopy} />
      <AcceleratorHourLedger pools={pools} jobs={jobs} alias={alias} onCopy={onCopy} />
      <GpuLeaseBookPanel nodes={nodes} jobs={jobs} alias={alias} onCopy={onCopy} />
      <GpuShapeSwitchboard nodes={nodes} jobs={jobs} onCopy={onCopy} />
      <GpuFlowPanel nodes={nodes} pools={pools} jobs={jobs} alias={alias} onCopy={onCopy} />
      <GpuOccupancyMatrix nodes={nodes} jobs={jobs} alias={alias} onCopy={onCopy} />
      <GpuTurnoverLadder pools={pools} jobs={jobs} alias={alias} onCopy={onCopy} />
      <GpuFragmentationLens nodes={nodes} pools={pools} jobs={jobs} />
      <GpuHuntPanel nodes={nodes} pools={pools} />
      <GpuReleaseRadar pools={pools} jobs={jobs} />
      <GpuTopologyPanel nodes={nodes} jobs={jobs} scarcity={scarcity} />
      <GpuTable pools={pools} loading={loading} />
    </section>
  );
}
