import { Clock3, User } from "lucide-react";
import type { HistoryResponse, QueueResponse, StorageResponse } from "../types";
import { ActiveBurnMeter } from "./ActiveBurnMeter";
import { AllocationWasteLedger } from "./AllocationWasteLedger";
import { CheckpointSentinelPanel } from "./CheckpointSentinelPanel";
import { CudaTelemetryPanel } from "./CudaTelemetryPanel";
import { EfficiencyPanel } from "./EfficiencyPanel";
import { ExperimentContinuityPanel } from "./ExperimentContinuityPanel";
import { ExperimentRunwayPanel } from "./ExperimentRunwayPanel";
import { ExitCodeForensics } from "./ExitCodeForensics";
import { FailureDiagnosticsPanel } from "./FailureDiagnostics";
import { FailurePatternRadar } from "./FailurePatternRadar";
import { FairshareBurnPanel } from "./FairshareBurnPanel";
import { FairshareImpactPanel } from "./FairshareImpactPanel";
import { HistoryIntelligencePanel } from "./HistoryIntelligence";
import { InteractiveSessionSentinel } from "./InteractiveSessionSentinel";
import { JobCommandCenter } from "./JobCommandCenter";
import { JobLifecycleReplay } from "./JobLifecycleReplay";
import { JobRunbookPanel } from "./JobRunbookPanel";
import { HistoryBox, HistoryTable, JobList, JobRuntimePanel } from "./Jobs";
import { IoBottleneckRadar } from "./IoBottleneckRadar";
import { RightSizeAdvisor } from "./RightSizeAdvisor";
import { RunEndgamePanel } from "./RunEndgamePanel";
import { SectionTitle } from "./common";
import { SupportPacketBuilder } from "./SupportPacketBuilder";

export function JobsSection({
  currentUser,
  myJobs,
  history,
  storage,
  alias,
  onCopy
}: {
  currentUser: string;
  myJobs: QueueResponse | null;
  history: HistoryResponse | null;
  storage: StorageResponse | null;
  alias: string;
  onCopy: (text: string, label: string) => void;
}) {
  const jobs = myJobs?.jobs ?? [];
  return (
    <section id="jobs" className="panel two-column">
      <div>
        <SectionTitle icon={<User size={18} />} title={`My Jobs - ${currentUser}`} />
        <JobCommandCenter jobs={jobs} alias={alias} onCopy={onCopy} />
        <ExperimentContinuityPanel jobs={jobs} history={history} alias={alias} onCopy={onCopy} />
        <InteractiveSessionSentinel jobs={jobs} alias={alias} onCopy={onCopy} />
        <ExperimentRunwayPanel jobs={jobs} />
        <RunEndgamePanel jobs={jobs} history={history} storage={storage} alias={alias} onCopy={onCopy} />
        <ActiveBurnMeter jobs={jobs} alias={alias} onCopy={onCopy} />
        <CheckpointSentinelPanel jobs={jobs} alias={alias} onCopy={onCopy} />
        <JobRunbookPanel jobs={jobs} alias={alias} onCopy={onCopy} />
        <JobRuntimePanel jobs={jobs} />
        <JobList jobs={jobs} onCopy={onCopy} alias={alias} />
      </div>
      <div>
        <SectionTitle icon={<Clock3 size={18} />} title="Recent History" />
        <HistoryBox history={history} />
        <HistoryIntelligencePanel history={history} />
        <JobLifecycleReplay history={history} alias={alias} onCopy={onCopy} />
        <FairshareBurnPanel history={history} />
        <FairshareImpactPanel history={history} myJobs={myJobs} alias={alias} onCopy={onCopy} />
        <EfficiencyPanel history={history} />
        <AllocationWasteLedger history={history} alias={alias} onCopy={onCopy} />
        <IoBottleneckRadar history={history} />
        <CudaTelemetryPanel history={history} alias={alias} onCopy={onCopy} />
        <RightSizeAdvisor history={history} onCopy={onCopy} />
        <ExitCodeForensics history={history} alias={alias} onCopy={onCopy} />
        <FailureDiagnosticsPanel history={history} alias={alias} onCopy={onCopy} />
        <SupportPacketBuilder history={history} alias={alias} onCopy={onCopy} />
        <FailurePatternRadar history={history} alias={alias} onCopy={onCopy} />
        <HistoryTable history={history} />
      </div>
    </section>
  );
}
