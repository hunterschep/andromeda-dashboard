export type PressureTone = "calm" | "busy" | "hot" | "critical";

export type IntelSignal = {
  label: string;
  value: string;
  detail: string;
  tone: PressureTone;
};

export type TurnoverEvent = {
  jobId: string;
  jobName: string;
  user: string;
  partition: string;
  endTime: string | null;
  gpus: number;
  cpus: number;
  label: string;
};

export type ClusterIntelligence = {
  pressureScore: number;
  pressureTone: PressureTone;
  headline: string;
  detail: string;
  signals: IntelSignal[];
  turnover: TurnoverEvent[];
};

export type GpuScarcity = {
  type: string;
  total: number;
  used: number;
  free: number;
  usable: number;
  pending: number;
  nodesAvailable: number;
  nodesTotal: number;
  unhealthyNodes: string[];
  pressureScore: number;
  tone: PressureTone;
  label: string;
};

export type PartitionIntel = {
  name: string;
  running: number;
  pending: number;
  pendingCpu: number;
  pendingGpu: number;
  freeGpu: number;
  totalGpu: number;
  idleCpu: number;
  totalCpu: number;
  pressureScore: number;
  tone: PressureTone;
  constrainedBy: string;
  waitBand: string;
  maxTime: string | null;
};

export type ForecastBand = {
  label: string;
  count: number;
  tone: PressureTone;
};

export type QueueExplanation = {
  jobId: string;
  jobName: string;
  user: string;
  partition: string;
  request: string;
  reason: string;
  waitBand: string;
  confidence: "low" | "medium" | "high";
  explanation: string;
  recommendation: string;
  tone: PressureTone;
};

export type PriorityLensItem = {
  jobId: string;
  jobName: string;
  user: string;
  partition: string;
  priority: number;
  rank: number;
  percentile: number;
  detail: string;
  tone: PressureTone;
};

export type QueueForecast = {
  pending: number;
  withEstimate: number;
  noEstimate: number;
  earliestStart: string | null;
  medianWaitSeconds: number | null;
  bands: ForecastBand[];
  priorityWeight: string | null;
  priorityLens: PriorityLensItem[];
  explanations: QueueExplanation[];
};

export type AndromedaIntelligence = {
  cluster: ClusterIntelligence;
  gpuScarcity: GpuScarcity[];
  partitions: PartitionIntel[];
  queue: QueueForecast;
};
