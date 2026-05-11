import { Rows3, Server } from "lucide-react";
import type { PartitionSummary, QueueJob } from "../types";
import { PartitionFitRadarPanel } from "./PartitionFitRadarPanel";
import { PartitionSaturationPanel } from "./PartitionSaturationPanel";
import { PartitionMatrix, PartitionTable } from "./Resources";
import { SectionTitle } from "./common";

export function PartitionSection({
  partitions,
  jobs,
  alias,
  onCopy
}: {
  partitions: PartitionSummary[];
  jobs: QueueJob[];
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  return (
    <section id="partitions" className="panel">
      <SectionTitle icon={<Rows3 size={18} />} title="Partition Matrix" />
      <PartitionFitRadarPanel partitions={partitions} jobs={jobs} />
      <PartitionSaturationPanel partitions={partitions} jobs={jobs} alias={alias} onCopy={onCopy} />
      <PartitionMatrix partitions={partitions} />
      <div className="section-subtitle">
        <SectionTitle icon={<Server size={18} />} title="Partition Detail" />
      </div>
      <PartitionTable partitions={partitions} />
    </section>
  );
}
