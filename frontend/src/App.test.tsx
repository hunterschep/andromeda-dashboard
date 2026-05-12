import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const cache = [{ key: "nodes", captured_at: null, ttl_seconds: 30, is_stale: true, errors: ["timeout"] }];

const resources = {
  nodes: [
    {
      name: "cpu001",
      state: "IDLE",
      state_flags: [],
      partitions: ["short", "medium"],
      features: ["rome"],
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
    }
  ],
  gpu_pools: [{ type: "a100", total: 4, used: 2, free: 2, usable: 2, nodes_total: 1, nodes_available: 1, unhealthy_nodes: [] }],
  partitions: [
    {
      name: "short",
      total_nodes: 2,
      idle_nodes: 1,
      mixed_nodes: 1,
      down_nodes: 0,
      cpus_total: 108,
      cpus_idle: 76,
      memory_free_mb: 434320,
      gpu_total: 4,
      gpu_free: 2,
      max_time: "12:00:00",
      default_time: "01:00:00",
      qos: ["normal"],
      node_sets: ["cpu001", "gpu001"],
      configured_tres: {},
      node_classes: ["a100"]
    }
  ],
  cluster: {
    nodes_total: 2,
    nodes_available: 2,
    nodes_down: 0,
    cpus_total: 108,
    cpus_idle: 76,
    memory_free_mb: 434320,
    gpu_total: 4,
    gpu_free: 2,
    running_jobs: 1,
    pending_jobs: 1
  },
  cache
};

const queue = {
  scope: "mine",
  running: 1,
  pending: 1,
  cache: [],
  jobs: [
    {
      job_id: "101",
      name: "train-a100",
      user: "scheppat",
      account: "lab",
      partition: "short",
      qos: "normal",
      state: "RUNNING",
      state_reason: "None",
      state_description: null,
      reason_label: null,
      constraints: [],
      required_nodes: [],
      excluded_nodes: [],
      reservation: null,
      licenses: [],
      cpus: 8,
      memory_mb: 65536,
      gpus: [{ type: "a100", count: 1 }],
      gpu_count: 1,
      submit_time: "2026-05-06T01:00:00+00:00",
      start_time: "2026-05-06T01:10:00+00:00",
      estimated_start_time: null,
      end_time: null,
      time_limit_seconds: 43200,
      elapsed_seconds: 1800,
      priority: 1000,
      dependency: null,
      nodes: ["gpu001"],
      anonymized: false
    },
    {
      job_id: "102",
      name: "cpu-post",
      user: "labmate",
      account: "lab",
      partition: "short",
      qos: "normal",
      state: "PENDING",
      state_reason: "Resources",
      state_description: null,
      reason_label: "Resources",
      constraints: [],
      required_nodes: [],
      excluded_nodes: [],
      reservation: null,
      licenses: [],
      cpus: 16,
      memory_mb: 32768,
      gpus: [],
      gpu_count: 0,
      submit_time: "2026-05-06T02:00:00+00:00",
      start_time: null,
      estimated_start_time: "2026-05-06T03:00:00+00:00",
      end_time: null,
      time_limit_seconds: 3600,
      elapsed_seconds: null,
      priority: 500,
      dependency: null,
      nodes: [],
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
      submit_time: null,
      start_time: null,
      end_time: null,
      wait_seconds: 900,
      runtime_seconds: 2700,
      max_rss_mb: null,
      total_cpu_seconds: null,
      requested_tres: {},
      allocated_tres: {},
      tres_usage_in_ave: {},
      tres_usage_in_max: {}
    }
  ],
  median_wait_seconds: 900,
  median_runtime_seconds: 2700,
  cache: []
};

const insights = {
  insights: [],
  scheduler: {
    last_cycle_seconds: 1,
    mean_cycle_seconds: 1.5,
    backfill_last_depth: 120,
    backfill_last_cycle_seconds: 4,
    queue_depth: 2,
    priority_weights: { fairshare: 1000 },
    raw: {}
  },
  account_limits: {
    user: "scheppat",
    account: "lab",
    qos: [{ name: "normal", max_jobs_per_user: 10, max_submit_per_user: 20, max_tres_per_user: { cpu: "128" } }],
    raw_rows: []
  },
  priority_jobs: [],
  cache: []
};

const config = {
  config_path: "/tmp/config.toml",
  config_exists: true,
  ssh_alias: "andromeda",
  current_user: "scheppat",
  host: "localhost",
  port: 8765,
  default_scope: "mine",
  lab_users: 1,
  cache_path: "/tmp/cache",
  debug: false
};

const storage = {
  volumes: [{ name: "scratch", path: "/scratch/scheppat", used_gb: 100, quota_gb: 1000, percent_used: 10, files_used: 10, files_quota: 100, file_percent_used: 10, severity: "info" }],
  raw: "",
  cache: []
};

function snapshot() {
  return { config, resources, queue, my_jobs: { ...queue, jobs: [queue.jobs[0]], pending: 0 }, history, insights, cache };
}

function mockFetch() {
  const routes: Record<string, unknown> = {
    "/api/snapshot?scope=mine&days=7": snapshot(),
    "/api/snapshot?scope=lab&days=7": { ...snapshot(), queue: { ...queue, scope: "lab" } },
    "/api/snapshot?scope=cluster&days=7": { ...snapshot(), queue: { ...queue, scope: "cluster" } },
    "/api/storage": storage
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const key = `${url.pathname}${url.search}`;
      const body = routes[key];
      if (!body) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
}

describe("App", () => {
  beforeEach(() => mockFetch());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a factual dashboard without narrative panels", async () => {
    render(<App />);

    expect(await screen.findByText("Andromeda Compute")).toBeInTheDocument();
    expect(screen.getByText(/Showing cached data for nodes/)).toBeInTheDocument();
    expect(screen.getAllByText("1 / 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GPU Pools").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Partitions").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Queue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Diagnostics").length).toBeGreaterThan(0);
    expect(screen.queryByText("Cluster Pulse")).not.toBeInTheDocument();
    expect(screen.queryByText("Queue Storyline")).not.toBeInTheDocument();
    expect(screen.queryByText("Slurm Wait Doctor")).not.toBeInTheDocument();
  });

  it("shows live inventory, queue, history, and diagnostics facts", async () => {
    render(<App />);

    const queueTable = await screen.findByRole("table", { name: "Queue jobs" });
    expect(within(queueTable).getByText("101")).toBeInTheDocument();
    expect(within(queueTable).getByText("102")).toBeInTheDocument();
    expect(screen.getByText("cpu001")).toBeInTheDocument();
    expect(screen.getAllByText("a100").length).toBeGreaterThan(0);
    expect(screen.getByText("Scheduler")).toBeInTheDocument();
    expect(screen.getByText("Account Limits")).toBeInTheDocument();
    expect(await screen.findByText("Storage Quotas")).toBeInTheDocument();
    expect(screen.getByText("Cache Diagnostics")).toBeInTheDocument();
    expect(screen.queryByText("finished")).not.toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
  });
});
