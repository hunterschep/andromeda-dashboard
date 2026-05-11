import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const resources = {
  nodes: [
    {
      name: "cpu001",
      state: "IDLE",
      state_flags: [],
      partitions: ["short", "medium"],
      features: ["rome", "large-mem"],
      cpus_total: 44,
      cpus_allocated: 0,
      cpus_idle: 44,
      memory_total_mb: 184320,
      memory_free_mb: 184320,
      gres: [],
      gpu_total: 0,
      gpu_used: 0,
      gpu_free: 0,
      gpu_types: [],
      reason: null,
      is_available: true
    },
    {
      name: "gpu001",
      state: "MIXED",
      state_flags: [],
      partitions: ["short"],
      features: ["a100"],
      cpus_total: 64,
      cpus_allocated: 32,
      cpus_idle: 32,
      memory_total_mb: 512000,
      memory_free_mb: 250000,
      gres: [{ type: "a100", total: 4, used: 2, free: 2 }],
      gpu_total: 4,
      gpu_used: 2,
      gpu_free: 2,
      gpu_types: ["a100"],
      reason: null,
      is_available: true
    },
    {
      name: "gpu002",
      state: "IDLE",
      state_flags: ["DRAIN"],
      partitions: ["short"],
      features: ["a100"],
      cpus_total: 64,
      cpus_allocated: 0,
      cpus_idle: 64,
      memory_total_mb: 512000,
      memory_free_mb: 512000,
      gres: [{ type: "a100", total: 4, used: 4, free: 0 }],
      gpu_total: 4,
      gpu_used: 4,
      gpu_free: 0,
      gpu_types: ["a100"],
      reason: "GPU ECC maintenance",
      is_available: false
    }
  ],
  gpu_pools: [
    {
      type: "a100",
      total: 4,
      used: 2,
      free: 2,
      usable: 2,
      nodes_total: 1,
      nodes_available: 1,
      unhealthy_nodes: []
    }
  ],
  partitions: [
    {
      name: "short",
      total_nodes: 3,
      idle_nodes: 1,
      mixed_nodes: 1,
      down_nodes: 0,
      cpus_total: 156,
      cpus_idle: 124,
      memory_free_mb: 690000,
      gpu_total: 6,
      gpu_free: 4,
      max_time: "12:00:00",
      default_time: "04:00:00",
      qos: ["normal"],
      node_sets: [],
      configured_tres: {},
      node_classes: ["CPU, 44 core, 180GB"]
    },
    {
      name: "medium",
      total_nodes: 1,
      idle_nodes: 1,
      mixed_nodes: 0,
      down_nodes: 0,
      cpus_total: 44,
      cpus_idle: 44,
      memory_free_mb: 184320,
      gpu_total: 0,
      gpu_free: 0,
      max_time: "2-00:00:00",
      default_time: "12:00:00",
      qos: ["normal"],
      node_sets: [],
      configured_tres: {},
      node_classes: ["CPU, 44 core, 180GB"]
    }
  ],
  cluster: {
    nodes_total: 4,
    nodes_available: 3,
    nodes_down: 1,
    cpus_total: 284,
    cpus_idle: 168,
    memory_free_mb: 950000,
    gpu_total: 12,
    gpu_free: 8,
    running_jobs: 1,
    pending_jobs: 2
  },
  cache: [{ key: "nodes", captured_at: null, ttl_seconds: 30, is_stale: true, errors: ["timeout"] }]
};

const queue = {
  scope: "cluster",
  running: 1,
  pending: 3,
  cache: [],
  jobs: [
    {
      job_id: "101",
      name: "train-a100",
      user: "hunterschep",
      account: "lab",
      partition: "short",
      qos: "normal",
      state: "RUNNING",
      state_reason: "None",
      state_description: null,
      reason_label: null,
      constraints: ["a100"],
      required_nodes: [],
      excluded_nodes: [],
      reservation: null,
      licenses: [],
      cpus: 8,
      memory_mb: 65536,
      gpus: [{ type: "a100", count: 1 }],
      gpu_count: 1,
      submit_time: "2026-05-06T01:00:00+00:00",
      start_time: null,
      estimated_start_time: null,
      end_time: null,
      time_limit_seconds: 43200,
      elapsed_seconds: 3600,
      priority: 1200,
      dependency: null,
      nodes: ["gpu001"],
      anonymized: false
    },
    {
      job_id: "102",
      name: "cpu-grid",
      user: "labmate",
      account: "lab",
      partition: "medium",
      qos: "normal",
      state: "PENDING",
      state_reason: "Resources",
      state_description: null,
      reason_label: "Waiting for requested CPUs, memory, GPUs, or nodes to free up",
      constraints: ["rome", "large-mem"],
      required_nodes: [],
      excluded_nodes: [],
      reservation: null,
      licenses: [],
      cpus: 44,
      memory_mb: 184320,
      gpus: [],
      gpu_count: 0,
      submit_time: "2026-05-06T00:30:00+00:00",
      start_time: null,
      estimated_start_time: "2026-05-06T05:00:00+00:00",
      end_time: null,
      time_limit_seconds: 172800,
      elapsed_seconds: null,
      priority: 900,
      dependency: null,
      nodes: [],
      anonymized: false
    },
    {
      job_id: "103",
      name: "wide-gpu",
      user: "labmate",
      account: "lab",
      partition: "short",
      qos: "int",
      state: "PENDING",
      state_reason: "Dependency",
      state_description: null,
      reason_label: "Waiting for upstream job dependency",
      constraints: ["a100"],
      required_nodes: ["gpu002"],
      excluded_nodes: [],
      reservation: null,
      licenses: [],
      cpus: 16,
      memory_mb: 131072,
      gpus: [{ type: "a100", count: 3 }],
      gpu_count: 3,
      submit_time: "2026-05-06T02:00:00+00:00",
      start_time: null,
      estimated_start_time: null,
      end_time: null,
      time_limit_seconds: null,
      elapsed_seconds: null,
      priority: 850,
      dependency: "afterok:90",
      nodes: [],
      anonymized: false
    }
  ]
};

const myJobs = {
  ...queue,
  scope: "mine",
  running: 2,
  pending: 0,
  jobs: [
    { ...queue.jobs[0], elapsed_seconds: 41400 },
    {
      job_id: "104",
      name: "jupyter-lab",
      user: "scheppat",
      account: "lab",
      partition: "interactive",
      qos: "int",
      state: "RUNNING",
      state_reason: "None",
      state_description: null,
      reason_label: null,
      constraints: [],
      required_nodes: [],
      excluded_nodes: [],
      reservation: null,
      licenses: [],
      cpus: 4,
      memory_mb: 32768,
      gpus: [],
      gpu_count: 0,
      submit_time: "2026-05-06T04:00:00+00:00",
      start_time: "2026-05-06T04:05:00+00:00",
      estimated_start_time: null,
      end_time: null,
      time_limit_seconds: 43200,
      elapsed_seconds: 7200,
      priority: 1400,
      dependency: null,
      nodes: ["cpu001"],
      anonymized: false
    }
  ]
};

const history = {
  days: 7,
  jobs: [
    {
      job_id: "90",
      name: "finished",
      user: "scheppat",
      account: "lab",
      partition: "short",
      state: "COMPLETED",
      exit_code: "0:0",
      submit_time: "2026-05-06T01:00:00+00:00",
      start_time: "2026-05-06T01:15:00+00:00",
      end_time: "2026-05-06T02:00:00+00:00",
      wait_seconds: 900,
      runtime_seconds: 2700,
      max_rss_mb: 3072,
      total_cpu_seconds: 7200,
      requested_tres: { cpu: "4", mem: "16G" },
      allocated_tres: { cpu: "4", mem: "16G" },
      tres_usage_in_ave: {},
      tres_usage_in_max: { "fs/disk": "2048G" }
    },
    {
      job_id: "91",
      name: "failed-gpu",
      user: "scheppat",
      account: "lab",
      partition: "short",
      state: "FAILED",
      exit_code: "1:0",
      submit_time: "2026-05-06T03:00:00+00:00",
      start_time: "2026-05-06T03:10:00+00:00",
      end_time: "2026-05-06T03:40:00+00:00",
      wait_seconds: 600,
      runtime_seconds: 1800,
      max_rss_mb: 7168,
      total_cpu_seconds: 480,
      requested_tres: { cpu: "8", mem: "64G", "gres/gpu": "1" },
      allocated_tres: { cpu: "8", mem: "64G", "gres/gpu": "1" },
      tres_usage_in_ave: { "gres/gpuutil": "6", "gres/gpumem": "1024M" },
      tres_usage_in_max: { "gres/gpuutil": "11", "gres/gpumem": "2048M" }
    }
  ],
  median_wait_seconds: 900,
  median_runtime_seconds: 2700,
  cache: []
};

const insights = {
  insights: [
    {
      id: "gpu-availability",
      title: "GPU availability",
      severity: "info",
      confidence: "high",
      message: "2 usable a100 GPU(s) are visible right now.",
      details: ["a100: 2 usable of 4"]
    }
  ],
  scheduler: {
    last_cycle_seconds: 0.25,
    mean_cycle_seconds: 1.5,
    backfill_last_depth: 120,
    backfill_last_cycle_seconds: 4,
    queue_depth: 55,
    priority_weights: { fairshare: 10000, qos: 10000, tres: 5000 },
    raw: {}
  },
  account_limits: {
    user: "hunterschep",
    account: "lab",
    qos: [
      {
        name: "normal",
        max_jobs_per_user: 2000,
        max_submit_per_user: 3000,
        max_tres_per_user: { cpu: "3600" }
      },
      {
        name: "int",
        max_jobs_per_user: 2,
        max_submit_per_user: null,
        max_tres_per_user: { cpu: "16", "gres/gpu": "1", mem: "64G" }
      }
    ],
    raw_rows: []
  },
  priority_jobs: [
    {
      job_id: "102",
      priority: 900,
      age: 130,
      fairshare: 420,
      job_size: 25,
      partition: 90,
      qos: 0,
      tres: 235,
      dominant_factor: "fairshare"
    },
    {
      job_id: "103",
      priority: 100,
      age: 15,
      fairshare: 8,
      job_size: 10,
      partition: 20,
      qos: 0,
      tres: 60,
      dominant_factor: "tres"
    }
  ],
  cache: [{ key: "scheduler", captured_at: null, ttl_seconds: 60, is_stale: false, errors: [] }]
};

const config = {
  config_path: "/tmp/config.toml",
  config_exists: true,
  ssh_alias: "andromeda",
  current_user: "scheppat",
  host: "127.0.0.1",
  port: 8765,
  default_scope: "mine",
  lab_users: 1,
  cache_path: "/tmp/cache.sqlite3",
  debug: false
};

const telemetry = {
  scope: "mine",
  hours: 168,
  samples: [
    {
      captured_at: 1778040000,
      scope: "mine",
      running: 1,
      pending: 0,
      gpu_free: 8,
      gpu_total: 12,
      cpus_idle: 168,
      cpus_total: 284,
      nodes_available: 3,
      nodes_total: 4
    },
    {
      captured_at: 1778054400,
      scope: "mine",
      running: 1,
      pending: 3,
      gpu_free: 4,
      gpu_total: 12,
      cpus_idle: 120,
      cpus_total: 284,
      nodes_available: 3,
      nodes_total: 4
    },
    {
      captured_at: 1778068800,
      scope: "mine",
      running: 2,
      pending: 8,
      gpu_free: 0,
      gpu_total: 12,
      cpus_idle: 48,
      cpus_total: 284,
      nodes_available: 2,
      nodes_total: 4
    },
    {
      captured_at: 1778083200,
      scope: "mine",
      running: 1,
      pending: 1,
      gpu_free: 6,
      gpu_total: 12,
      cpus_idle: 152,
      cpus_total: 284,
      nodes_available: 3,
      nodes_total: 4
    }
  ],
  summary: {
    count: 4,
    peak_pending: 8,
    median_pending: 3,
    lowest_gpu_free: 0,
    latest_pressure: 50,
    quietest_hour: 0
  }
};

const prediction = {
  scope: "mine",
  hours: 24,
  confidence: "low",
  trend: "flat",
  estimated_clear_minutes: null,
  wait_range_minutes: { lower: 0, upper: 15 },
  confidence_reasons: ["4 telemetry sample(s) in window", "no sustained drain rate yet", "pending trend is 0 jobs/hour"],
  wait_band: "now/backfill",
  pending_trend_per_hour: 0,
  recommendation: "Visible queue is clear; short jobs may backfill quickly."
};

const storage = {
  volumes: [
    {
      name: "home",
      path: "/home/hunterschep",
      used_gb: 72,
      quota_gb: 100,
      percent_used: 72,
      files_used: 90000,
      files_quota: 100000,
      file_percent_used: 90,
      severity: "warning"
    },
    {
      name: "scratch",
      path: "/scratch/hunterschep",
      used_gb: 9830.4,
      quota_gb: 10240,
      percent_used: 96,
      files_used: 1200000,
      files_quota: 2000000,
      file_percent_used: 60,
      severity: "critical"
    }
  ],
  raw: "",
  cache: []
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    config,
    resources,
    queue: { ...queue, scope: "mine" },
    my_jobs: myJobs,
    history,
    insights,
    cache: [...resources.cache, ...insights.cache],
    ...overrides
  };
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  const payloads: Record<string, unknown> = {
    "/api/config/status": config,
    "/api/resources": resources,
    "/api/queue?scope=mine": queue,
    "/api/queue?scope=lab": queue,
    "/api/queue?scope=cluster": queue,
    "/api/jobs/mine": myJobs,
    "/api/history?days=7": history,
    "/api/insights": insights,
    "/api/snapshot?scope=mine&days=7": snapshot(),
    "/api/snapshot?scope=lab&days=7": snapshot({ queue: { ...queue, scope: "lab" } }),
    "/api/snapshot?scope=cluster&days=7": snapshot({ queue: { ...queue, scope: "cluster" } }),
    "/api/telemetry?scope=mine&hours=24": telemetry,
    "/api/telemetry?scope=lab&hours=24": { ...telemetry, scope: "lab" },
    "/api/telemetry?scope=cluster&hours=24": { ...telemetry, scope: "cluster" },
    "/api/telemetry?scope=mine&hours=168": telemetry,
    "/api/telemetry?scope=lab&hours=168": { ...telemetry, scope: "lab" },
    "/api/telemetry?scope=cluster&hours=168": { ...telemetry, scope: "cluster" },
    "/api/prediction?scope=mine&hours=24": prediction,
    "/api/prediction?scope=lab&hours=24": { ...prediction, scope: "lab" },
    "/api/prediction?scope=cluster&hours=24": { ...prediction, scope: "cluster" },
    "/api/storage": storage,
    ...overrides
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payloads[path])
      });
    })
  );
}

describe("App", () => {
  beforeEach(() => mockFetch());

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders stale warnings, availability, and pending reason labels", async () => {
    render(<App />);

    expect(await screen.findByText("Andromeda Compute")).toBeInTheDocument();
    expect(screen.getByText(/Showing cached data for nodes/)).toBeInTheDocument();
    expect(screen.getAllByText("a100").length).toBeGreaterThan(0);
    expect(screen.getByText("Live Activity")).toBeInTheDocument();
    expect(screen.getByText("Data Freshness Sentinel")).toBeInTheDocument();
    expect(screen.getByText("1 stale / 2 sources")).toBeInTheDocument();
    expect(screen.getByText("nodes cache is stale; treat affected panels as last-known Slurm state.")).toBeInTheDocument();
    expect(screen.getByText(/nodes cache is stale \(unknown capture, ttl 30s\); timeout/)).toBeInTheDocument();
    expect(screen.getByText("Refresh Health")).toBeInTheDocument();
    expect(await screen.findByText("2/4 live / 2 degraded / manual")).toBeInTheDocument();
    expect(screen.getByText("Snapshot, Storage feeds are degraded; related panels are last-known or partial.")).toBeInTheDocument();
    expect(screen.getAllByText("4 samples").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 volumes").length).toBeGreaterThan(0);
    expect(screen.getByText("Ops Brief")).toBeInTheDocument();
    expect(screen.getByText("3/2 GPU pressure")).toBeInTheDocument();
    expect(screen.getByText("Andromeda is GPU-constrained: 3 pending GPU requests are competing for 2 usable GPUs while 4 GPU are offline.")).toBeInTheDocument();
    expect(screen.getByText("1 running / 2 pending")).toBeInTheDocument();
    expect(screen.getByText("50% clean history")).toBeInTheDocument();
    expect(screen.getByText("1 stale source")).toBeInTheDocument();
    expect(screen.getByText("Action Runlist")).toBeInTheDocument();
    expect(await screen.findByText("Clean scratch before launch")).toBeInTheDocument();
    expect(screen.getByText("3 critical / 1 watch")).toBeInTheDocument();
    expect(screen.getByText("Verify final checkpoint is the first move; 3 other signals follow.")).toBeInTheDocument();
    expect(screen.getByText("Verify final checkpoint")).toBeInTheDocument();
    expect(screen.getByText("Reduce GPU shape or wait")).toBeInTheDocument();
    expect(screen.getByText("Refresh stale Slurm sources")).toBeInTheDocument();
    expect(screen.getByText(/1 source is stale/)).toBeInTheDocument();
    expect(await screen.findByText("Snapshot loaded")).toBeInTheDocument();
    expect(await screen.findByText("Trend Memory")).toBeInTheDocument();
    expect(screen.getByText("Pressure Replay")).toBeInTheDocument();
    expect(screen.getAllByText("low GPU").length).toBeGreaterThan(0);
    expect(screen.getByText("Replay Delta")).toBeInTheDocument();
    expect(screen.getByText("3 transitions")).toBeInTheDocument();
    expect(screen.getByText("Latest sample recovered 50 pressure points while GPU free moved +6.")).toBeInTheDocument();
    expect(screen.getByText("steepest climb")).toBeInTheDocument();
    expect(screen.getByText("+34")).toBeInTheDocument();
    expect(screen.getByText("strongest relief")).toBeInTheDocument();
    expect(screen.getByText("-50")).toBeInTheDocument();
    expect(screen.getByText("GPU return")).toBeInTheDocument();
    expect(screen.getByText("Pressure Calendar")).toBeInTheDocument();
    expect(screen.getAllByText("Wed 00-04").length).toBeGreaterThan(0);
    expect(screen.getByText(/lightest sampled window/)).toBeInTheDocument();
    expect(screen.getByText("Submit Window Advisor")).toBeInTheDocument();
    expect(screen.getByText("split or target Wed 00-04")).toBeInTheDocument();
    expect(screen.getByText("3 pending GPU demand is above 2 usable now; split wide work or target Wed 00-04.")).toBeInTheDocument();
    expect(screen.getByText("2 pending / 3 GPU waiting")).toBeInTheDocument();
    expect(screen.getByText("avoid if flexible")).toBeInTheDocument();
    expect(screen.getAllByText("Wed 08-12").length).toBeGreaterThan(0);
    expect(screen.getByText("Pressure Anomalies")).toBeInTheDocument();
    expect(screen.getByText("GPU famine")).toBeInTheDocument();
    expect(screen.getByText("Pending surge")).toBeInTheDocument();
    expect(screen.getByText("0/12 GPU free")).toBeInTheDocument();
    expect(screen.getByText(/Pending depth peaked at 8/)).toBeInTheDocument();
    expect(await screen.findByText("Queue Prediction")).toBeInTheDocument();
    expect(screen.getAllByText("now/backfill").length).toBeGreaterThan(0);
    expect(screen.getByText("0-15m")).toBeInTheDocument();
    expect(screen.getByText("4 telemetry sample(s) in window")).toBeInTheDocument();
    expect(screen.getByText("no sustained drain rate yet")).toBeInTheDocument();
    expect(screen.getByText("Scheduler Weather")).toBeInTheDocument();
    expect(screen.getByText("scheduler responsive")).toBeInTheDocument();
    expect(screen.getByText(/Scheduler cycles are quick/)).toBeInTheDocument();
    expect(screen.getByText("fairshare + qos")).toBeInTheDocument();
    expect(screen.getByText("Compute Commitment")).toBeInTheDocument();
    expect(screen.getByText("1 active request(s) are missing walltime, weakening turnover forecasts.")).toBeInTheDocument();
    expect(await screen.findByText("Node Explorer")).toBeInTheDocument();
    expect(screen.getByText("Fleet Map")).toBeInTheDocument();
    expect(screen.getByText("Allocation Constellation")).toBeInTheDocument();
    expect(screen.getByText("1 active / 1 hidden signal")).toBeInTheDocument();
    expect(screen.getByText("1 node has allocation counters beyond visible jobs; expect filtered users, cache skew, or hidden Slurm rows before assuming idle headroom.")).toBeInTheDocument();
    expect(screen.getByText("gpu001 shows 32 allocated CPU / 2 GPU used; visible queue rows explain 8 CPU / 1 GPU.")).toBeInTheDocument();
    expect(screen.getByText("train-a100 on gpu001")).toBeInTheDocument();
    expect(screen.getByText("Node Neighborhood Map")).toBeInTheDocument();
    expect(screen.getByText("2 neighborhoods / 1 degraded")).toBeInTheDocument();
    expect(screen.getByText("gpu is the hottest neighborhood: 1 unavailable node, 4 blocked GPU, 2 free GPU.")).toBeInTheDocument();
    expect(screen.getByText("gpu has 1 unavailable node removing 4 GPU / 64 CPU while 3 pending GPU request(s) match this neighborhood.")).toBeInTheDocument();
    expect(screen.getByText("Node Class Atlas")).toBeInTheDocument();
    expect(screen.getByText("4x a100 / 64 CPU / 500 GB")).toBeInTheDocument();
    expect(screen.getByText("large-model training")).toBeInTheDocument();
    expect(screen.getByText("1/2 node(s) in this class are drained, down, or otherwise unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Infrastructure Incidents")).toBeInTheDocument();
    expect(screen.getByText("1 active groups")).toBeInTheDocument();
    expect(screen.getAllByText("GPU ECC maintenance").length).toBeGreaterThan(0);
    expect(screen.getByText("Capacity Loss Ledger")).toBeInTheDocument();
    expect(screen.getByText("4 GPU / 64 CPU offline")).toBeInTheDocument();
    expect(screen.getByText("1 node removes 64 CPU and 4 GPU from visible capacity.")).toBeInTheDocument();
    expect(screen.getByText(/50% visible GPU capacity removed across short/)).toBeInTheDocument();
    expect(screen.getByText(/3 pending GPU demand maps to this lost class/)).toBeInTheDocument();
    expect(await screen.findByText("GPU Market Tape")).toBeInTheDocument();
    expect(screen.getAllByText("1 hot family").length).toBeGreaterThan(0);
    expect(screen.getAllByText("a100 has the tightest tape: 1 GPU short after visible supply and near-term returns.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("short 1 GPU").length).toBeGreaterThan(0);
    expect(screen.getAllByText("150%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("a100 scarcity is active: 3 pending GPU request(s) against 2 usable now; 4 GPU are blocked by unavailable nodes.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Plan around scarcity: split wide requests, watch return times, or use a smaller validation run.").length).toBeGreaterThan(0);
    expect(screen.getByText("Accelerator Window Planner")).toBeInTheDocument();
    expect(screen.getByText("1 constrained / 1 family")).toBeInTheDocument();
    expect(screen.getByText("a100 demand is scheduler-gated; capacity changes will not matter until that gate clears.")).toBeInTheDocument();
    expect(screen.getByText("clear gates")).toBeInTheDocument();
    expect(screen.getByText("3 a100 GPU requests are gated before capacity can matter.")).toBeInTheDocument();
    expect(screen.getByText("Resolve dependency, hold, or begin-time fields before changing GPU width.")).toBeInTheDocument();
    expect(screen.getByText("Accelerator Hour Ledger")).toBeInTheDocument();
    expect(screen.getByText("1 hot / 11.0 locked GPU-h")).toBeInTheDocument();
    expect(screen.getByText("3 queued or running GPU requests lack walltime, making accelerator turnover harder to trust.")).toBeInTheDocument();
    expect(screen.getAllByText("11.0 GPU-h").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3 GPU").length).toBeGreaterThan(0);
    expect(screen.getByText("a100 has 11.0 locked GPU-h plus 3 GPU requests without walltime.")).toBeInTheDocument();
    expect(screen.getByText("Declare realistic walltime before trusting release forecasts or launching dependent GPU work.")).toBeInTheDocument();
    expect(screen.getByText("GPU Lease Book")).toBeInTheDocument();
    expect(screen.getByText("1 visible lease")).toBeInTheDocument();
    expect(screen.getByText("1 GPU held by running jobs; 3 same-family GPU requests are waiting behind them.")).toBeInTheDocument();
    expect(screen.getByText("a100 / 1 GPU")).toBeInTheDocument();
    expect(screen.getByText("11h 0m left")).toBeInTheDocument();
    expect(screen.getByText("3 queued / 3 gated")).toBeInTheDocument();
    expect(screen.getByText("train-a100 holds 1 a100 GPU on gpu001 for another 11h 0m; 3 a100 GPU requests are queued behind it, including 3 gated before capacity.")).toBeInTheDocument();
    expect(screen.getByText("Clear dependency or hold gates before treating this lease as the main bottleneck.")).toBeInTheDocument();
    expect(screen.getByText("GPU Shape Switchboard")).toBeInTheDocument();
    expect(screen.getByText("1 GPU request / 1 gated")).toBeInTheDocument();
    expect(screen.getByText("Gate first, then split width")).toBeInTheDocument();
    expect(screen.getByText("wide-gpu is gated by afterok:90, and the current 3x a100 shape exceeds the largest visible 2x fit.")).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes("#SBATCH --gres=gpu:a100:2") && text.includes("#SBATCH --array=0-2%2"))).toBeInTheDocument();
    expect(screen.getByText("Clear dependency, hold, or begin-time first; keep the split patch ready if the job remains wide afterward.")).toBeInTheDocument();
    expect(await screen.findByText("GPU Flow Map")).toBeInTheDocument();
    expect(screen.getByText("3 demand / 2 usable")).toBeInTheDocument();
    expect(screen.getByText("dependency-gated demand")).toBeInTheDocument();
    expect(screen.getByText(/3 a100 GPU\(s\) are gated by dependencies/)).toBeInTheDocument();
    expect(screen.getByText("GPU Occupancy Matrix")).toBeInTheDocument();
    expect(screen.getByText("2 free / 8 visible")).toBeInTheDocument();
    expect(screen.getByText("3 pending GPU requests are competing for 2 schedulable GPUs; 4 GPUs are tied to unavailable nodes.")).toBeInTheDocument();
    expect(screen.getByText("a100: 2 used / 2 free")).toBeInTheDocument();
    expect(screen.getByText("a100: 4 blocked by DRAIN")).toBeInTheDocument();
    expect(screen.getByText("train-a100 / 1 GPU; 2 GPUs free on this node.")).toBeInTheDocument();
    expect(screen.getByText("GPU Turnover Ladder")).toBeInTheDocument();
    expect(screen.getByText("2 now / 1 returning / 3 waiting")).toBeInTheDocument();
    expect(screen.getByText("a100 demand is gated: 3 GPUs are blocked before release timing can help.")).toBeInTheDocument();
    expect(screen.getByText("1 running a100 GPU exposes a walltime-derived release.")).toBeInTheDocument();
    expect(screen.getByText("3 a100 GPUs are waiting behind dependency, hold, or begin-time gates.")).toBeInTheDocument();
    expect(screen.getByText("GPU Fragmentation Lens")).toBeInTheDocument();
    expect(screen.getByText("0 fragmented / 1 gated")).toBeInTheDocument();
    expect(screen.getByText("Wide GPU fit is currently hidden behind scheduler gates.")).toBeInTheDocument();
    expect(screen.getByText(/a100 widest pending request is gated before placement/)).toBeInTheDocument();
    expect(screen.getByText("GPU Hunt Board")).toBeInTheDocument();
    expect(screen.getByText(/largest visible node fit is 2/)).toBeInTheDocument();
    expect(screen.getByText("GPU Release Radar")).toBeInTheDocument();
    expect(screen.getByText("0 GPUs returning inside 2h")).toBeInTheDocument();
    expect(await screen.findByText("Partition Fit Radar")).toBeInTheDocument();
    expect(screen.getByText("2 open / 0 tight")).toBeInTheDocument();
    expect(screen.getByText("GPU capacity is visible, but scheduler gates still shape access.")).toBeInTheDocument();
    expect(screen.getByText(/short keeps 4 GPU free, but 3 GPU demand is gated/)).toBeInTheDocument();
    expect(screen.getByText(/medium is sized for long CPU work/)).toBeInTheDocument();
    expect(screen.getByText("Partition Saturation Map")).toBeInTheDocument();
    expect(screen.getByText("1 hot / 1 watch")).toBeInTheDocument();
    expect(screen.getByText("short has free GPU on paper while gated demand waits to re-enter the lane.")).toBeInTheDocument();
    expect(screen.getByText("medium has enough idle CPU for one full-width pending wave, then it is saturated.")).toBeInTheDocument();
    expect(screen.getByText("short shows 4 free GPU, but 3 GPU are hidden behind scheduler gates.")).toBeInTheDocument();
    expect(await screen.findByText("Queue Pressure")).toBeInTheDocument();
    expect(screen.getByText("Visible Users")).toBeInTheDocument();
    expect(screen.getByText("Lab Footprint")).toBeInTheDocument();
    expect(screen.getByText("Visible pressure is concentrated around labmate.")).toBeInTheDocument();
    expect(screen.getByText("Queue Shape Mix")).toBeInTheDocument();
    expect(screen.getByText("2 pending shapes")).toBeInTheDocument();
    expect(screen.getByText("Dependency-gated")).toBeInTheDocument();
    expect(screen.getByText("Full-node CPU")).toBeInTheDocument();
    expect(screen.getByText(/cpu-grid gives the queue a wide CPU shape/)).toBeInTheDocument();
    expect(screen.getByText("Queue Traffic Flow")).toBeInTheDocument();
    expect(screen.getByText("1 live / 1 dated / 1 gated")).toBeInTheDocument();
    expect(screen.getByText("3 GPUs are locked behind scheduler gates; clear dependencies before treating this as raw scarcity.")).toBeInTheDocument();
    expect(screen.getByText("1 pending job has a public Slurm start estimate.")).toBeInTheDocument();
    expect(screen.getByText("1 pending job is blocked before resources, priority, or backfill can move it.")).toBeInTheDocument();
    expect(screen.getByText("Resolve gates first; reshaping gated jobs will not create scheduler motion.")).toBeInTheDocument();
    expect(screen.getByText("Queue Confidence Ledger")).toBeInTheDocument();
    expect(screen.getByText("85% confidence / 0 blind waits")).toBeInTheDocument();
    expect(screen.getByText("Queue estimates are defensible: 1 dated start, 2 priority rows, and 1 gated wait explain the visible queue.")).toBeInTheDocument();
    expect(screen.getByText("Every visible pending job has decoded sprio factors.")).toBeInTheDocument();
    expect(screen.getByText("Gated jobs are explainable, but capacity-based wait estimates should ignore them until the gate clears.")).toBeInTheDocument();
    expect(screen.getByText("Queue Storyline")).toBeInTheDocument();
    expect(screen.getByText("1 gate / 1 dated")).toBeInTheDocument();
    expect(screen.getByText("2 pending jobs can be explained from visible scheduler evidence.")).toBeInTheDocument();
    expect(screen.getByText("wide-gpu is waiting on afterok:90 before resources matter.")).toBeInTheDocument();
    expect(screen.getByText("Resolve dependency first; reshaping CPU, GPU, or memory will not move this job yet.")).toBeInTheDocument();
    expect(screen.getByText("cpu-grid has a dated start estimate while asking for 44 CPU / 180 GB / 0 GPU.")).toBeInTheDocument();
    expect(screen.getByText("Watch the estimate and avoid churn unless it slips or the run can safely shorten walltime.")).toBeInTheDocument();
    expect(screen.getByText("Historical Wait Budget")).toBeInTheDocument();
    expect(screen.getByText("1 overdue / 1 gated")).toBeInTheDocument();
    expect(screen.getByText("1 pending job has outwaited recent accounting baselines.")).toBeInTheDocument();
    expect(screen.getByText(/cpu-grid has waited .*beyond the recent 12m global baseline/)).toBeInTheDocument();
    expect(screen.getByText("wide-gpu is gated before wait budget matters; dependency, hold, or begin-time evidence comes first.")).toBeInTheDocument();
    expect(screen.getByText("Start Path Decoder")).toBeInTheDocument();
    expect(screen.getByText("1 blocked / 1 dated / 1 fit")).toBeInTheDocument();
    expect(screen.getByText("1 pending job is blocked before normal backfill math.")).toBeInTheDocument();
    expect(screen.getByText("wide-gpu is held by afterok:90; resource edits cannot move it until the gate clears.")).toBeInTheDocument();
    expect(screen.getByText("largest GPU fit 2/3")).toBeInTheDocument();
    expect(screen.getByText("cpu-grid has a dated start estimate; the main lever is walltime only if the estimate slips.")).toBeInTheDocument();
    expect(screen.getByText("Shorten walltime if the run can checkpoint cleanly.")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Copy start path probe").length).toBeGreaterThan(0);
    expect(screen.getByText("Slurm Wait Doctor")).toBeInTheDocument();
    expect(screen.getByText("1 blocked / 1 watch")).toBeInTheDocument();
    expect(screen.getByText("Workflow gate, not capacity")).toBeInTheDocument();
    expect(screen.getByText("Slurm exposed a start estimate")).toBeInTheDocument();
    expect(screen.getAllByText(/Resolve dependency, hold, or begin-time fields/).length).toBeGreaterThan(0);
    expect(screen.getByText("Request Surgery")).toBeInTheDocument();
    expect(screen.getByText("1 rewrite / 1 gate")).toBeInTheDocument();
    expect(screen.getByText("1 pending job has a safe shape change; 1 is blocked before resources matter.")).toBeInTheDocument();
    expect(screen.getByText("Shorten walltime for backfill")).toBeInTheDocument();
    expect(screen.getByText("#SBATCH --time=12:00:00")).toBeInTheDocument();
    expect(screen.getByText("Resolve scheduler gate first")).toBeInTheDocument();
    expect(screen.getByText(/cpu-grid asks for 2d 0h on 44 CPU/)).toBeInTheDocument();
    expect(screen.getByText("Constraint & Policy Decoder")).toBeInTheDocument();
    expect(screen.getByText("1 blocked / 0 watch / 1 clear")).toBeInTheDocument();
    expect(screen.getByText("1 pending job has policy or constraint evidence that can block placement before priority helps.")).toBeInTheDocument();
    expect(screen.getByText("Pinned node unavailable")).toBeInTheDocument();
    expect(screen.getByText("wide-gpu requires gpu002, but the visible node is IDLE+DRAIN.")).toBeInTheDocument();
    expect(screen.getByText("Remove --nodelist or target a healthy a100 node class before waiting on priority.")).toBeInTheDocument();
    expect(screen.getByText("Constraint has visible landing zone")).toBeInTheDocument();
    expect(screen.getByText("cpu-grid exposes constraints rome, large-mem with 1 visible matching node.")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Copy policy and constraint probe").length).toBeGreaterThan(0);
    expect(screen.getByText("Reason Decoder")).toBeInTheDocument();
    expect(screen.getByText("Resource fit")).toBeInTheDocument();
    expect(screen.getByText("Dependency Radar")).toBeInTheDocument();
    expect(screen.getAllByText("dependency gate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("afterok:90").length).toBeGreaterThan(0);
    expect(screen.getByText(/wide-gpu waits on afterok:90/)).toBeInTheDocument();
    expect(screen.getByText("Dependency Chain Auditor")).toBeInTheDocument();
    expect(screen.getByText("1 audited / 1 satisfied upstream")).toBeInTheDocument();
    expect(screen.getByText("1 dependency gate has recent accounting evidence; verify stale dependency state before changing resources.")).toBeInTheDocument();
    expect(screen.getByText("wide-gpu depends on afterok:90, and recent accounting shows upstream job 90 completed.")).toBeInTheDocument();
    expect(screen.getByText("Verify the dependency field with scontrol; if it is gone, resources or priority are now the real blocker.")).toBeInTheDocument();
    expect(screen.getByText("Queue Motion")).toBeInTheDocument();
    expect(screen.getByText("1/2 dated starts")).toBeInTheDocument();
    expect(screen.getByText("Dated start estimate")).toBeInTheDocument();
    expect(screen.getByText("Scheduler gate")).toBeInTheDocument();
    expect(screen.getByText(/wide-gpu is gated before resources can matter/)).toBeInTheDocument();
    expect(screen.getByText("Backfill Slot Board")).toBeInTheDocument();
    expect(screen.getByText("5 live slots / depth 120")).toBeInTheDocument();
    expect(screen.getByText("CPU flash on short is the cleanest visible backfill move.")).toBeInTheDocument();
    expect(screen.getByText("Scheduler is checking 120 jobs per backfill cycle; last backfill cycle 4s.")).toBeInTheDocument();
    expect(screen.getByText("CPU flash has 2 live backfill slot(s); short, narrow work should start fastest.")).toBeInTheDocument();
    expect(screen.getByText("GPU smoke has one live short slot; keep walltime at 2h or less.")).toBeInTheDocument();
    expect(screen.getByText("Backfill Radar")).toBeInTheDocument();
    expect(screen.getByText("CPU probe can backfill on 2 node(s) right now.")).toBeInTheDocument();
    expect(screen.getByText("Partition Strategy")).toBeInTheDocument();
    expect(screen.getByText("Current partition looks plausible for cpu-grid; queue order or turnover is likely the larger issue.")).toBeInTheDocument();
    expect(screen.getByText("Walltime Leverage")).toBeInTheDocument();
    expect(screen.getByText("Long walltime can block backfill even when CPUs or GPUs are technically free.")).toBeInTheDocument();
    expect(screen.getByText("Priority Anatomy")).toBeInTheDocument();
    expect(screen.getByText("2 pending jobs decoded")).toBeInTheDocument();
    expect(screen.getByText(/Fairshare is the largest visible contribution/)).toBeInTheDocument();
    expect(screen.getByText("Priority Order Book")).toBeInTheDocument();
    expect(screen.getByText("2 ranked / 800 spread")).toBeInTheDocument();
    expect(screen.getByText("cpu-grid is first in the visible priority book with a 800 point spread across decoded pending jobs.")).toBeInTheDocument();
    expect(screen.getByText("cpu-grid leads 103 by 800 priority points; fairshare is the largest visible separator.")).toBeInTheDocument();
    expect(screen.getByText("wide-gpu trails 102 by 800 points; fairshare is the biggest visible gap.")).toBeInTheDocument();
    expect(screen.getByText("Fairshare is the hard part; a smaller TRES shape may help more than resubmitting.")).toBeInTheDocument();
    expect(screen.getByText("Scheduler Weight Compass")).toBeInTheDocument();
    expect(screen.getByText("fairshare + qos top weight")).toBeInTheDocument();
    expect(screen.getByText("fairshare is the most visible priority force across 2 decoded pending jobs.")).toBeInTheDocument();
    expect(screen.getByText("fairshare dominates 1 decoded pending job with 428 visible points.")).toBeInTheDocument();
    expect(screen.getByText("tres dominates 1 decoded pending job with 295 visible points.")).toBeInTheDocument();
    expect(screen.getByText("Avoid churn; smaller validation jobs help more than cancelling and resubmitting large work.")).toBeInTheDocument();
    expect(screen.getByText("Bottleneck Map")).toBeInTheDocument();
    expect(screen.getByText(/GPU fragmentation:/)).toBeInTheDocument();
    expect(screen.getByText("Priority Lens")).toBeInTheDocument();
    expect(screen.getByText("fairshare weight visible")).toBeInTheDocument();
    expect(screen.getByText("Queue Runway")).toBeInTheDocument();
    expect(screen.getByText("1/2 pending jobs sequenced")).toBeInTheDocument();
    expect(screen.getAllByText("gpu001").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Waiting for requested CPUs, memory, GPUs, or nodes to free up").length
    ).toBeGreaterThan(0);
    expect((await screen.findAllByText("COMPLETED")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Experiment Monitor")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint pressure")).toBeInTheDocument();
    expect(screen.getByText("Experiment Continuity")).toBeInTheDocument();
    expect(screen.getByText("2 active / 50% clean / 1 failed")).toBeInTheDocument();
    expect(screen.getByText("1 recent GPU failure should inform active experiment monitoring.")).toBeInTheDocument();
    expect(screen.getByText("train-a100 is establishing a fresh baseline; recent history is 50% clean with 1 GPU failure.")).toBeInTheDocument();
    expect(screen.getByText("Confirm checkpoints and capture GPU telemetry before this run becomes the reference.")).toBeInTheDocument();
    expect(screen.getByText("jupyter-lab is an interactive session; protect the tunnel and output path before walltime closes.")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy continuity probe")).toBeInTheDocument();
    expect(screen.getByText("Interactive Session Sentinel")).toBeInTheDocument();
    expect(screen.getByText("1 live session")).toBeInTheDocument();
    expect(screen.getByText("Notebook tunnel is live")).toBeInTheDocument();
    expect(screen.getByText(/jupyter-lab is attached to cpu001/)).toBeInTheDocument();
    expect(screen.getByText("8888 -> cpu001:8888")).toBeInTheDocument();
    expect(screen.getByText("Experiment Runway")).toBeInTheDocument();
    expect(screen.getByText("1 urgent runway")).toBeInTheDocument();
    expect(screen.getByText(/96% walltime burned/)).toBeInTheDocument();
    expect(screen.getByText(/Verify checkpoint, output path, and stderr/)).toBeInTheDocument();
    expect(screen.getByText("Run Endgame Board")).toBeInTheDocument();
    expect(screen.getByText("1 urgent / 1 watch")).toBeInTheDocument();
    expect(screen.getByText("1 allocation needs final checkpoint/log capture before walltime closes.")).toBeInTheDocument();
    expect(screen.getByText("train-a100 is inside final 30m with scratch at 96% and 1 recent GPU failure signal.")).toBeInTheDocument();
    expect(screen.getByText("Capture checkpoint, logs, accounting, and GPU telemetry before the allocation expires.")).toBeInTheDocument();
    expect(screen.getByText("jupyter-lab has 10h 0m left; storage pressure can still break notebooks, logs, or environment writes.")).toBeInTheDocument();
    expect(screen.getByText("Compute Burn Meter")).toBeInTheDocument();
    expect(screen.getByText("11.5 GPU-h burned")).toBeInTheDocument();
    expect(screen.getByText("1 running GPU job still expose 0.50 GPU-h before walltime closes.")).toBeInTheDocument();
    expect(screen.getByText("train-a100 has burned 11.5 GPU-h and 92.0 CPU-h; 30m of walltime remains.")).toBeInTheDocument();
    expect(screen.getByText("Verify checkpoint before the last 0.50 GPU-h expires.")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint Sentinel")).toBeInTheDocument();
    expect(screen.getByText("1 urgent deadline")).toBeInTheDocument();
    expect(screen.getByText(/train-a100 is 96% through walltime with 30m left/)).toBeInTheDocument();
    expect(screen.getByText("Experiment Runbook")).toBeInTheDocument();
    expect(screen.getAllByText("tail output").length).toBeGreaterThan(0);
    expect(screen.getByText("GPU probe")).toBeInTheDocument();
    expect(screen.getByText("History Intelligence")).toBeInTheDocument();
    expect(screen.getByText("quiet window")).toBeInTheDocument();
    expect(screen.getByText("Submit Strategy")).toBeInTheDocument();
    expect(screen.getByText(/recent GPU starts/)).toBeInTheDocument();
    expect(screen.getByText("Job Lifecycle Replay")).toBeInTheDocument();
    expect(screen.getByText("2 recent lifecycles")).toBeInTheDocument();
    expect(screen.getByText("failed-gpu spent 10m waiting, 30m running, then FAILED.")).toBeInTheDocument();
    expect(screen.getByText("GPU failure happened after allocation; inspect CUDA, modules, and input data before resubmitting.")).toBeInTheDocument();
    expect(screen.getByText("finished spent 15m waiting, 45m running, then COMPLETED.")).toBeInTheDocument();
    expect(screen.getByText("Fairshare Burn")).toBeInTheDocument();
    expect(screen.getByText(/Recent usage is light/)).toBeInTheDocument();
    expect(screen.getByText("Fairshare Impact Forecast")).toBeInTheDocument();
    expect(screen.getByText("medium projected")).toBeInTheDocument();
    expect(screen.getByText(/Current jobs add 12.0 GPU-h/)).toBeInTheDocument();
    expect(screen.getByText("Prefer smaller validation jobs before launching another wide GPU allocation.")).toBeInTheDocument();
    expect(screen.getByText("Allocation Efficiency")).toBeInTheDocument();
    expect(screen.getByText("Low CPU efficiency evidence")).toBeInTheDocument();
    expect(screen.getByText("Low GPU utilization evidence")).toBeInTheDocument();
    expect(screen.getAllByText("Memory over-request evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("Allocation Waste Ledger")).toBeInTheDocument();
    expect(screen.getByText("88% memory over / 4.87 CPU-h unused / 0.47 GPU-h cold")).toBeInTheDocument();
    expect(screen.getByText("Recent jobs requested 80 GB memory and peaked at 10 GB; 88% of requested memory sat cold.")).toBeInTheDocument();
    expect(screen.getByText("failed-gpu left 28.5 GB-h of requested memory unused.")).toBeInTheDocument();
    expect(screen.getByText("failed-gpu burned 0.47 GPU-h without useful GPU activity at 6% average utilization.")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy waste accounting probe")).toBeInTheDocument();
    expect(screen.getByText("I/O Bottleneck Radar")).toBeInTheDocument();
    expect(screen.getByText("1 data-heavy run")).toBeInTheDocument();
    expect(screen.getByText("1 recent job shows heavy filesystem movement.")).toBeInTheDocument();
    expect(screen.getByText(/finished moved 2.0 TB through filesystem counters/)).toBeInTheDocument();
    expect(screen.getByText("CUDA Telemetry")).toBeInTheDocument();
    expect(screen.getByText("starvation visible")).toBeInTheDocument();
    expect(screen.getByText("GPU starvation pattern")).toBeInTheDocument();
    expect(screen.getByText(/failed-gpu averaged 6% GPU util/)).toBeInTheDocument();
    expect(screen.getByText("Right-size Advisor")).toBeInTheDocument();
    expect(screen.getByText("Memory is the clearest right-size opportunity.")).toBeInTheDocument();
    expect(screen.getByText("Copy sbatch deltas")).toBeInTheDocument();
    expect(screen.getByText("Exit Code Forensics")).toBeInTheDocument();
    expect(screen.getByText("1 decoded failure")).toBeInTheDocument();
    expect(screen.getByText("Application exited after allocation")).toBeInTheDocument();
    expect(screen.getByText("At least one job received resources before failing; logs matter more than queue shape.")).toBeInTheDocument();
    expect(screen.getByText("failed-gpu exited with code 1:0 after 30m; Slurm allocated 8 CPU / 64G / 1 GPU, so start with stderr, CUDA imports, module loads, and input paths.")).toBeInTheDocument();
    expect(screen.getByText("GPU allocation failed")).toBeInTheDocument();
    expect(screen.getByText("Failure Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("GPU job exited non-zero")).toBeInTheDocument();
    expect(screen.getByText("CUDA context")).toBeInTheDocument();
    expect(screen.getAllByText("logs").length).toBeGreaterThan(0);
    expect(screen.getByText("Support Packet Builder")).toBeInTheDocument();
    expect(screen.getByText("1 packet ready")).toBeInTheDocument();
    expect(screen.getByText("GPU failure support packet")).toBeInTheDocument();
    expect(screen.getByText(/Adds module \+ CUDA context/)).toBeInTheDocument();
    expect(screen.getByText("Copy support packet")).toBeInTheDocument();
    expect(screen.getByText("Failure Pattern Radar")).toBeInTheDocument();
    expect(screen.getByText("GPU/application failure pattern")).toBeInTheDocument();
    expect(screen.getByText("1 job / 1 GPU")).toBeInTheDocument();
    expect(screen.getByText(/small CUDA\/module\/data-path validation/)).toBeInTheDocument();
    expect(await screen.findByText("Power Tools")).toBeInTheDocument();
    expect(screen.getByText("Request Planner")).toBeInTheDocument();
    expect(screen.getByText("Policy Guardrails")).toBeInTheDocument();
    expect(screen.getByText("normal allows this request.")).toBeInTheDocument();
    expect(screen.getByText("Next Launch Impact")).toBeInTheDocument();
    expect(screen.getByText("blocked impact")).toBeInTheDocument();
    expect(screen.getByText("storage blocks the next serious launch before Slurm placement matters.")).toBeInTheDocument();
    expect(screen.getByText("4.00 GPU-h")).toBeInTheDocument();
    expect(screen.getByText("3 -> 4 GPU waiting")).toBeInTheDocument();
    expect(screen.getByText("visible GPU demand would exceed usable supply by 2.")).toBeInTheDocument();
    expect(screen.getByText("scratch is critical; clean it before adding a checkpoint-heavy GPU run.")).toBeInTheDocument();
    expect(screen.getByText("normal QOS remains clear at 2/2000.")).toBeInTheDocument();
    expect(screen.getByText("Copy sbatch")).toBeInTheDocument();
    expect(screen.getByText("Run Shape Recommender")).toBeInTheDocument();
    expect(screen.getByText("1 reusable shape")).toBeInTheDocument();
    expect(screen.getByText("CPU repeat shape")).toBeInTheDocument();
    expect(screen.getByText("GPU validation first")).toBeInTheDocument();
    expect(screen.getByText(/Submit a short smoke test/)).toBeInTheDocument();
    expect(screen.getByText("Sweep Governor")).toBeInTheDocument();
    expect(screen.getAllByText("%2").length).toBeGreaterThan(0);
    expect(screen.getByText("Throttle sweeps before scaling; recent clean rate is 50%.")).toBeInTheDocument();
    expect(screen.getByText("#SBATCH --array=0-31%2")).toBeInTheDocument();
    expect(screen.getByText("Limit Headroom Board")).toBeInTheDocument();
    expect(screen.getByText("0 blocked / 1 tight QOS")).toBeInTheDocument();
    expect(screen.getByText("int is near a visible account ceiling for hunterschep.")).toBeInTheDocument();
    expect(screen.getAllByText("1 active or queued job").length).toBeGreaterThan(0);
    expect(screen.getAllByText("64 GB / 64G").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0 left").length).toBeGreaterThan(0);
    expect(screen.getByText("int is close to memory, GPU limit(s); one more submission may hit policy before placement.")).toBeInTheDocument();
    expect(screen.getByText("Keep the next request narrow and verify QOS choice before launching arrays or notebooks.")).toBeInTheDocument();
    expect(screen.getByText("Environment Preflight")).toBeInTheDocument();
    expect(screen.getByText("fix environment")).toBeInTheDocument();
    expect(screen.getByText("Env writes must be fixed before a serious launch.")).toBeInTheDocument();
    expect(screen.getByText("Storage can break virtualenvs, caches, logs, or checkpoints before Slurm explains the failure.")).toBeInTheDocument();
    expect(screen.getAllByText("1 GPU failure").length).toBeGreaterThan(0);
    expect(screen.getByText("Run Stamp Injector")).toBeInTheDocument();
    expect(screen.getByText("fix stamp")).toBeInTheDocument();
    expect(screen.getByText("Recent GPU failure plus scratch 96% storage pressure make in-job environment capture mandatory.")).toBeInTheDocument();
    expect(screen.getByText("CUDA + modules")).toBeInTheDocument();
    expect(screen.getByText("Stamp module list, CUDA visibility, nvidia-smi, and GPU accounting before training.")).toBeInTheDocument();
    expect(screen.getByText("Storage + quota")).toBeInTheDocument();
    expect(screen.getByText("Quota pressure can turn environment writes, logs, or checkpoints into misleading job failures.")).toBeInTheDocument();
    expect(screen.getByText("Copy run stamp")).toBeInTheDocument();
    expect(screen.getByText("Jupyter Launcher")).toBeInTheDocument();
    expect(screen.getByText("Copy notebook job")).toBeInTheDocument();
    expect(screen.getByText("Sweep Launcher")).toBeInTheDocument();
    expect(screen.getByText("Copy sweep job")).toBeInTheDocument();
    expect(await screen.findByText("Launch Readiness")).toBeInTheDocument();
    expect(await screen.findByText("fix before launch")).toBeInTheDocument();
    expect(screen.getByText("Storage needs attention before the next serious run.")).toBeInTheDocument();
    expect(screen.getByText("scratch is critical; clean storage before launching checkpoint-heavy work.")).toBeInTheDocument();
    expect(screen.getByText("Recent runs are 50% clean; inspect failures before scaling.")).toBeInTheDocument();
    expect(screen.getByText("Backfill Recipe Builder")).toBeInTheDocument();
    expect(screen.getByText("2 ready / 2 watch")).toBeInTheDocument();
    expect(screen.getByText("Scheduler is checking 120 jobs per backfill cycle; small, dated recipes are the safest way to exploit gaps.")).toBeInTheDocument();
    expect(screen.getAllByText("CPU flash").length).toBeGreaterThan(0);
    expect(screen.getByText("short can absorb a tiny CPU validation job without widening the queue shape.")).toBeInTheDocument();
    expect(screen.getByText((text) => text.includes("#SBATCH --job-name=andromeda-cpu-flash") && text.includes("#SBATCH --time=00:30:00"))).toBeInTheDocument();
    expect(screen.getAllByText("GPU smoke").length).toBeGreaterThan(0);
    expect(screen.getByText("2 a100 GPU(s) usable, but 3 pending GPU request(s) are visible; keep this to a validation run.")).toBeInTheDocument();
    expect(screen.getByText("Gate audit")).toBeInTheDocument();
    expect(screen.getByText("1 gated job blocks 3 GPU before backfill can help.")).toBeInTheDocument();
    expect(screen.getByText("Storage guard")).toBeInTheDocument();
    expect(screen.getByText("Data Staging Planner")).toBeInTheDocument();
    expect(screen.getByText("staging blocked")).toBeInTheDocument();
    expect(screen.getByText("scratch has 410 GB free against a 2.0 TB recent I/O footprint; clean or stage only a subset before the next run.")).toBeInTheDocument();
    expect(screen.getByText("2.0 TB recent")).toBeInTheDocument();
    expect(screen.getByText("1 dated start")).toBeInTheDocument();
    expect(screen.getByText("Stage with rsync")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint Budget")).toBeInTheDocument();
    expect(screen.getAllByText("checkpoint risk").length).toBeGreaterThan(0);
    expect(screen.getByText("scratch has 410 GB free but is 96% used; trim checkpoints before scaling GPU runs.")).toBeInTheDocument();
    expect(screen.getByText("10 x 40 GB")).toBeInTheDocument();
    expect(screen.getByText("1 urgent")).toBeInTheDocument();
    expect(screen.getByText("train-a100 has 30m left; verify final checkpoint target now.")).toBeInTheDocument();
    expect(screen.getAllByText("90% files").length).toBeGreaterThan(0);
    expect(screen.getByText("Quota Burn Forecast")).toBeInTheDocument();
    expect(screen.getByText("0 repeats / 410 GB free")).toBeInTheDocument();
    expect(screen.getByText("scratch has 410 GB free against a 2.0 TB recent filesystem burst; one repeat can fill quota.")).toBeInTheDocument();
    expect(screen.getByText("scratch cannot absorb another peak recent filesystem burst.")).toBeInTheDocument();
    expect(screen.getByText("finished is the largest recent filesystem footprint.")).toBeInTheDocument();
    expect(screen.getByText("before next run")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy quota burn probe")).toBeInTheDocument();
    expect(await screen.findByText("Storage Pressure")).toBeInTheDocument();
    expect(screen.getAllByText("/scratch/hunterschep").length).toBeGreaterThan(0);
    expect(screen.getByText("Storage Triage")).toBeInTheDocument();
    expect(screen.getByText("scratch space is critical")).toBeInTheDocument();
    expect(screen.getByText("home file count is high")).toBeInTheDocument();
    expect(screen.getAllByText("Copy triage").length).toBeGreaterThan(0);
    expect(screen.getByText("Identity Probe")).toBeInTheDocument();
    expect(screen.getByText("Cache Diagnostics")).toBeInTheDocument();
    expect(screen.getAllByText("normal").length).toBeGreaterThan(0);
  }, 10000);

  it("filters jobs by partition and state", async () => {
    const user = userEvent.setup();
    render(<App />);
    const queueTable = await screen.findByRole("table", { name: "Queue jobs" });
    const queueSection = queueTable.closest("section") as HTMLElement;
    expect(within(queueTable).getByText("train-a100")).toBeInTheDocument();

    await user.selectOptions(within(queueSection).getByLabelText("Partition"), "medium");
    expect(within(queueTable).queryByText("train-a100")).not.toBeInTheDocument();
    expect(within(queueTable).getByText("cpu-grid")).toBeInTheDocument();

    await user.selectOptions(within(queueSection).getByLabelText("State"), "RUNNING");
    expect(screen.getByText("No jobs match the current filters.")).toBeInTheDocument();
  });

  it("paginates and sorts the node table", async () => {
    const user = userEvent.setup();
    const manyNodes = Array.from({ length: 25 }, (_item, index) => ({
      ...resources.nodes[0],
      name: `cpu${String(index + 1).padStart(3, "0")}`,
      cpus_idle: index
    }));
    const manyResources = {
      ...resources,
      nodes: manyNodes,
      cluster: { ...resources.cluster, nodes_total: 25, nodes_available: 25 }
    };
    mockFetch({
      "/api/snapshot?scope=mine&days=7": snapshot({ resources: manyResources })
    });

    render(<App />);
    expect(await screen.findByText("1-20 of 25")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("21-25 of 25")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Idle CPU/ }));
    expect(screen.getByText("1-20 of 25")).toBeInTheDocument();
  });

  it("renders empty states when no data is available", async () => {
    const emptyResources = { ...resources, gpu_pools: [], partitions: [], cache: [] };
    const emptyQueue = { ...queue, jobs: [], running: 0, pending: 0, scope: "mine" };
    const emptyHistory = { ...history, jobs: [] };
    const emptyInsights = { ...insights, insights: [], scheduler: null, account_limits: null, priority_jobs: [] };
    mockFetch({
      "/api/resources": emptyResources,
      "/api/queue?scope=mine": emptyQueue,
      "/api/jobs/mine": emptyQueue,
      "/api/history?days=7": emptyHistory,
      "/api/insights": emptyInsights,
      "/api/snapshot?scope=mine&days=7": snapshot({
        resources: emptyResources,
        queue: emptyQueue,
        my_jobs: emptyQueue,
        history: emptyHistory,
        insights: emptyInsights,
        cache: []
      })
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText("No GPU inventory found in the current node snapshot.")).toBeInTheDocument());
    expect(screen.getByText("No partition metadata available.")).toBeInTheDocument();
    expect(screen.getByText("No visible jobs for the configured user.")).toBeInTheDocument();
    expect(screen.getByText("No insights available yet.")).toBeInTheDocument();
  });

  it("keeps navigation available on narrow screens", async () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 390 });
    render(<App />);

    const nav = await screen.findByLabelText("Dashboard sections");
    expect(within(nav).getByText("Queue")).toBeInTheDocument();
    expect(within(nav).getByText("My Jobs")).toBeInTheDocument();
  });
});
