export type CacheMeta = {
  key: string;
  captured_at: string | null;
  ttl_seconds: number;
  is_stale: boolean;
  errors: string[];
};

export type NodeGpuInventory = {
  type: string;
  total: number;
  used: number;
  free: number;
};

export type NodeResource = {
  name: string;
  state: string;
  state_flags: string[];
  partitions: string[];
  features: string[];
  cpus_total: number;
  cpus_allocated: number;
  cpus_idle: number;
  memory_total_mb: number;
  memory_free_mb: number | null;
  gres: NodeGpuInventory[];
  gpu_total: number;
  gpu_used: number;
  gpu_free: number;
  gpu_types: string[];
  reason: string | null;
  is_available: boolean;
};

export type GpuPool = {
  type: string;
  total: number;
  used: number;
  free: number;
  usable: number;
  nodes_total: number;
  nodes_available: number;
  unhealthy_nodes: string[];
};

export type PartitionSummary = {
  name: string;
  total_nodes: number;
  idle_nodes: number;
  mixed_nodes: number;
  down_nodes: number;
  cpus_total: number;
  cpus_idle: number;
  memory_free_mb: number;
  gpu_total: number;
  gpu_free: number;
  max_time: string | null;
  default_time: string | null;
  qos: string[];
  node_sets: string[];
  configured_tres: Record<string, string>;
  node_classes: string[];
};

export type ClusterSummary = {
  nodes_total: number;
  nodes_available: number;
  nodes_down: number;
  cpus_total: number;
  cpus_idle: number;
  memory_free_mb: number;
  gpu_total: number;
  gpu_free: number;
  running_jobs: number;
  pending_jobs: number;
};

export type ResourceResponse = {
  nodes: NodeResource[];
  gpu_pools: GpuPool[];
  partitions: PartitionSummary[];
  cluster: ClusterSummary;
  cache: CacheMeta[];
};

export type QueueGpuRequest = {
  type: string;
  count: number;
};

export type QueueJob = {
  job_id: string;
  name: string | null;
  user: string;
  account: string | null;
  partition: string | null;
  state: string;
  state_reason: string | null;
  state_description: string | null;
  reason_label: string | null;
  cpus: number;
  memory_mb: number | null;
  gpus: QueueGpuRequest[];
  gpu_count: number;
  submit_time: string | null;
  start_time: string | null;
  estimated_start_time: string | null;
  end_time: string | null;
  time_limit_seconds: number | null;
  elapsed_seconds: number | null;
  priority: number | null;
  dependency: string | null;
  nodes: string[];
  anonymized: boolean;
};

export type QueueResponse = {
  scope: "mine" | "lab" | "cluster";
  jobs: QueueJob[];
  running: number;
  pending: number;
  cache: CacheMeta[];
};

export type HistoryJob = {
  job_id: string;
  name: string | null;
  user: string | null;
  partition: string | null;
  state: string;
  wait_seconds: number | null;
  runtime_seconds: number | null;
};

export type HistoryResponse = {
  days: number;
  jobs: HistoryJob[];
  median_wait_seconds: number | null;
  median_runtime_seconds: number | null;
  cache: CacheMeta[];
};

export type Insight = {
  id: string;
  title: string;
  severity: "info" | "warning" | "critical";
  confidence: "low" | "medium" | "high";
  message: string;
  details: string[];
};

export type SchedulerHealth = {
  last_cycle_seconds: number | null;
  mean_cycle_seconds: number | null;
  backfill_last_depth: number | null;
  backfill_last_cycle_seconds: number | null;
  queue_depth: number | null;
  priority_weights: Record<string, number>;
  raw: Record<string, string>;
};

export type QosLimit = {
  name: string;
  max_jobs_per_user: number | null;
  max_submit_per_user: number | null;
  max_tres_per_user: Record<string, string>;
};

export type AccountLimits = {
  user: string | null;
  account: string | null;
  qos: QosLimit[];
  raw_rows: Record<string, string>[];
};

export type InsightsResponse = {
  insights: Insight[];
  scheduler: SchedulerHealth | null;
  account_limits: AccountLimits | null;
  cache: CacheMeta[];
};

export type ConfigStatus = {
  config_path: string;
  config_exists: boolean;
  ssh_alias: string;
  current_user: string;
  host: string;
  port: number;
  default_scope: string;
  lab_users: number;
  cache_path: string;
  debug: boolean;
};

export type DashboardSnapshot = {
  config: ConfigStatus;
  resources: ResourceResponse;
  queue: QueueResponse;
  my_jobs: QueueResponse;
  history: HistoryResponse;
  insights: InsightsResponse;
  cache: CacheMeta[];
};
