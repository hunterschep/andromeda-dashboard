import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const resources = {
  nodes: [],
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
  pending: 2,
  cache: [],
  jobs: [
    {
      job_id: "101",
      name: "train-a100",
      user: "hunterschep",
      account: "lab",
      partition: "short",
      state: "RUNNING",
      state_reason: "None",
      state_description: null,
      reason_label: null,
      cpus: 8,
      memory_mb: 65536,
      gpus: [{ type: "a100", count: 1 }],
      gpu_count: 1,
      submit_time: null,
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
      state: "PENDING",
      state_reason: "Resources",
      state_description: null,
      reason_label: "Waiting for requested CPUs, memory, GPUs, or nodes to free up",
      cpus: 44,
      memory_mb: 184320,
      gpus: [],
      gpu_count: 0,
      submit_time: null,
      start_time: null,
      estimated_start_time: "2026-05-06T05:00:00+00:00",
      end_time: null,
      time_limit_seconds: null,
      elapsed_seconds: null,
      priority: 900,
      dependency: null,
      nodes: [],
      anonymized: false
    }
  ]
};

const history = {
  days: 7,
  jobs: [],
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
  scheduler: null,
  cache: []
};

function mockFetch(overrides: Record<string, unknown> = {}) {
  const payloads: Record<string, unknown> = {
    "/api/config/status": {
      config_path: "/tmp/config.toml",
      config_exists: true,
      ssh_alias: "andromeda",
      host: "127.0.0.1",
      port: 8765,
      default_scope: "mine",
      lab_users: 1,
      cache_path: "/tmp/cache.sqlite3",
      debug: false
    },
    "/api/resources": resources,
    "/api/queue?scope=mine": queue,
    "/api/queue?scope=lab": queue,
    "/api/queue?scope=cluster": queue,
    "/api/jobs/mine": { ...queue, jobs: [queue.jobs[0]] },
    "/api/history?days=7": history,
    "/api/insights": insights,
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

    expect(await screen.findByText("Compute Dashboard")).toBeInTheDocument();
    expect(screen.getByText(/Showing cached data for nodes/)).toBeInTheDocument();
    expect(screen.getAllByText("a100").length).toBeGreaterThan(0);
    expect(screen.getByText("Waiting for requested CPUs, memory, GPUs, or nodes to free up")).toBeInTheDocument();
  });

  it("filters jobs by partition and state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("train-a100");

    await user.selectOptions(screen.getByLabelText("Partition"), "medium");
    expect(screen.queryByText("train-a100")).not.toBeInTheDocument();
    expect(screen.getByText("cpu-grid")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("State"), "RUNNING");
    expect(screen.getByText("No jobs match the current filters.")).toBeInTheDocument();
  });

  it("renders empty states when no data is available", async () => {
    mockFetch({
      "/api/resources": { ...resources, gpu_pools: [], partitions: [], cache: [] },
      "/api/queue?scope=mine": { ...queue, jobs: [], running: 0, pending: 0 },
      "/api/jobs/mine": { ...queue, jobs: [], running: 0, pending: 0 },
      "/api/insights": { ...insights, insights: [] }
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
