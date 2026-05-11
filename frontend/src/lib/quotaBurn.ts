import type { HistoryJob, HistoryResponse, StorageResponse, StorageVolume } from "../types";

export type QuotaBurnTone = "clear" | "watch" | "critical";

export type QuotaBurnSignal = {
  id: string;
  label: string;
  tone: QuotaBurnTone;
  value: string;
  detail: string;
};

export type QuotaBurnForecast = {
  tone: QuotaBurnTone;
  label: string;
  headline: string;
  signals: QuotaBurnSignal[];
  command: string;
};

type Footprint = {
  job: HistoryJob;
  gb: number;
};

export function buildQuotaBurnForecast({
  storage,
  history,
  alias
}: {
  storage: StorageResponse | null;
  history: HistoryResponse | null;
  alias: string;
}): QuotaBurnForecast {
  const volumes = storage?.volumes ?? [];
  const scratch = findVolume(volumes, "scratch") ?? volumes.slice().sort(bySeverity)[0];
  const home = findVolume(volumes, "home");
  const footprint = peakFootprint(history?.jobs ?? []);
  const free = freeGb(scratch);
  const repeatRuns = free !== null && footprint ? Math.floor(free / Math.max(footprint.gb, 1)) : null;
  const signals = [
    scratchSignal(scratch, free, footprint, repeatRuns),
    footprintSignal(footprint),
    fileSignal(home),
    cleanupSignal(scratch, repeatRuns)
  ];
  const tone = overall(signals);
  return {
    tone,
    label: labelFor(repeatRuns, free),
    headline: headlineFor(scratch, free, footprint, repeatRuns),
    signals,
    command: cleanupCommand(alias, scratch?.path ?? "/scratch/$USER")
  };
}

function scratchSignal(
  volume: StorageVolume | undefined,
  free: number | null,
  footprint: Footprint | null,
  repeatRuns: number | null
): QuotaBurnSignal {
  if (!volume) {
    return {
      id: "scratch",
      label: "scratch runway",
      tone: "watch",
      value: "unknown",
      detail: "Quota output is missing, so large writes should wait for acct-chk."
    };
  }
  const blocked = repeatRuns !== null && repeatRuns < 1 && Boolean(footprint);
  return {
    id: "scratch",
    label: "scratch runway",
    tone: volume.severity === "critical" || blocked ? "critical" : volume.severity === "warning" ? "watch" : "clear",
    value: free === null ? `${volume.percent_used ?? "n/a"}% used` : `${formatGb(free)} free`,
    detail: blocked
      ? `${volume.name} cannot absorb another peak recent filesystem burst.`
      : `${volume.name} is ${volume.percent_used ?? "n/a"}% used; keep cleanup ahead of checkpoint waves.`
  };
}

function footprintSignal(footprint: Footprint | null): QuotaBurnSignal {
  if (!footprint) {
    return {
      id: "footprint",
      label: "recent burst",
      tone: "watch",
      value: "no counters",
      detail: "Recent accounting did not expose filesystem counters; use a conservative staging plan."
    };
  }
  return {
    id: "footprint",
    label: "recent burst",
    tone: footprint.gb >= 1024 ? "watch" : "clear",
    value: formatGb(footprint.gb),
    detail: `${footprint.job.name ?? footprint.job.job_id} is the largest recent filesystem footprint.`
  };
}

function fileSignal(home: StorageVolume | undefined): QuotaBurnSignal {
  const files = home?.file_percent_used ?? null;
  return {
    id: "files",
    label: "home file runway",
    tone: files !== null && files >= 95 ? "critical" : files !== null && files >= 85 ? "watch" : "clear",
    value: files === null ? "unknown" : `${files}% files`,
    detail: files !== null && files >= 85
      ? "Move caches, virtualenvs, logs, and shard-heavy datasets out of home."
      : "Home file count is not the leading burn risk."
  };
}

function cleanupSignal(volume: StorageVolume | undefined, repeatRuns: number | null): QuotaBurnSignal {
  const tone: QuotaBurnTone = repeatRuns !== null && repeatRuns < 1 ? "critical" : repeatRuns !== null && repeatRuns < 2 ? "watch" : "clear";
  return {
    id: "cleanup",
    label: "cleanup priority",
    tone,
    value: repeatRuns === null ? "probe" : repeatRuns < 1 ? "before next run" : `${repeatRuns} repeat${repeatRuns === 1 ? "" : "s"}`,
    detail: volume ? `Rank ${volume.name} directories before staging, checkpointing, or launching arrays.` : "Run quota and directory probes before launching."
  };
}

function headlineFor(
  scratch: StorageVolume | undefined,
  free: number | null,
  footprint: Footprint | null,
  repeatRuns: number | null
): string {
  if (!scratch) return "Quota burn cannot be forecast until storage output is parsed.";
  if (free !== null && footprint && repeatRuns !== null && repeatRuns < 1) {
    return `${scratch.name} has ${formatGb(free)} free against a ${formatGb(footprint.gb)} recent filesystem burst; one repeat can fill quota.`;
  }
  if (repeatRuns !== null && footprint) {
    return `${scratch.name} can absorb about ${repeatRuns} repeat burst${repeatRuns === 1 ? "" : "s"} at the recent ${formatGb(footprint.gb)} peak.`;
  }
  return `${scratch.name} burn rate needs richer filesystem accounting before forecasting repeat runs.`;
}

function peakFootprint(jobs: HistoryJob[]): Footprint | null {
  const rows = jobs
    .map((job) => ({ job, gb: ioGb(job) }))
    .filter((item): item is Footprint => item.gb !== null)
    .sort((left, right) => right.gb - left.gb);
  return rows[0] ?? null;
}

function ioGb(job: HistoryJob): number | null {
  const values = Object.entries({ ...job.tres_usage_in_ave, ...job.tres_usage_in_max })
    .filter(([key]) => /fs|disk|lustre|gpfs|read|write|io/i.test(key))
    .map(([, value]) => parseBytes(value))
    .filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) / 1024 ** 3 : null;
}

function parseBytes(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*([KMGTPE]?)(?:I?B)?/i.exec(value);
  if (!match) return null;
  const factors: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5, E: 1024 ** 6 };
  return Number(match[1]) * factors[match[2].toUpperCase()];
}

function findVolume(volumes: StorageVolume[], needle: string): StorageVolume | undefined {
  return volumes.find((volume) => `${volume.name} ${volume.path ?? ""}`.toLowerCase().includes(needle));
}

function freeGb(volume: StorageVolume | undefined): number | null {
  if (!volume || volume.used_gb === null || volume.quota_gb === null) return null;
  return Math.max(0, volume.quota_gb - volume.used_gb);
}

function overall(signals: QuotaBurnSignal[]): QuotaBurnTone {
  if (signals.some((signal) => signal.tone === "critical")) return "critical";
  if (signals.some((signal) => signal.tone === "watch")) return "watch";
  return "clear";
}

function labelFor(repeatRuns: number | null, free: number | null): string {
  const runs = repeatRuns === null ? "unknown" : `${repeatRuns} repeat${repeatRuns === 1 ? "" : "s"}`;
  return `${runs} / ${free === null ? "n/a" : `${formatGb(free)} free`}`;
}

function bySeverity(left: StorageVolume, right: StorageVolume): number {
  return severityRank(right.severity) - severityRank(left.severity);
}

function severityRank(severity: StorageVolume["severity"]): number {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

function formatGb(value: number): string {
  if (value >= 1024) return `${(Math.round((value / 1024) * 10) / 10).toFixed(1)} TB`;
  if (value >= 100) return `${Math.round(value)} GB`;
  return `${Math.round(value * 10) / 10} GB`;
}

function cleanupCommand(alias: string, path: string): string {
  const target = safePath(path);
  return `ssh ${alias} 'acct-chk "$USER"; printf "\\nLargest directories:\\n"; du -h --max-depth=1 ${target} 2>/dev/null | sort -h | tail -30; printf "\\nLarge checkpoint/model files:\\n"; find ${target} \\( -name "*ckpt*" -o -name "*.pt" -o -name "*.pth" -o -name "*.safetensors" \\) -type f -printf "%s %p\\n" 2>/dev/null | sort -n | tail -30'`;
}

function safePath(path: string): string {
  if (/^[A-Za-z0-9_./$"-]+$/.test(path)) return path;
  return `'${path.replace(/'/g, "'\\''")}'`;
}
