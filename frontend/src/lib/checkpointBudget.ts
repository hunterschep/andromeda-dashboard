import type { QueueJob, StorageResponse, StorageVolume } from "../types";

export type CheckpointBudgetLevel = "clear" | "watch" | "critical";

export type CheckpointBudgetSignal = {
  id: string;
  label: string;
  value: string;
  detail: string;
  severity: CheckpointBudgetLevel;
};

export type CheckpointBudget = {
  level: CheckpointBudgetLevel;
  label: string;
  headline: string;
  command: string;
  signals: CheckpointBudgetSignal[];
};

export function buildCheckpointBudget(storage: StorageResponse | null, jobs: QueueJob[], alias: string): CheckpointBudget {
  const volumes = storage?.volumes ?? [];
  const scratch = findVolume(volumes, "scratch") ?? volumes.slice().sort(bySeverity)[0];
  const home = findVolume(volumes, "home");
  const activeGpuJobs = jobs.filter((job) => ["RUNNING", "CONFIGURING"].includes(job.state) && job.gpu_count > 0);
  const urgentJobs = activeGpuJobs.filter((job) => remainingSeconds(job) !== null && remainingSeconds(job)! <= 3600);
  const waveGb = checkpointWaveGb(activeGpuJobs);
  const scratchFreeGb = freeGb(scratch);
  const slots = scratchFreeGb === null ? null : Math.floor(scratchFreeGb / waveGb);
  const level = budgetLevel(scratch, home, slots, urgentJobs.length);

  return {
    level,
    label: labelFor(level),
    headline: headlineFor(scratch, activeGpuJobs.length, scratchFreeGb, slots, waveGb),
    command: checkpointCommand(alias),
    signals: [
      scratchSignal(scratch, scratchFreeGb),
      waveSignal(activeGpuJobs.length, slots, waveGb),
      walltimeSignal(activeGpuJobs, urgentJobs),
      homeSignal(home)
    ]
  };
}

function findVolume(volumes: StorageVolume[], needle: string): StorageVolume | undefined {
  return volumes.find((volume) => `${volume.name} ${volume.path ?? ""}`.toLowerCase().includes(needle));
}

function bySeverity(left: StorageVolume, right: StorageVolume): number {
  return severityRank(right.severity) - severityRank(left.severity);
}

function freeGb(volume: StorageVolume | undefined): number | null {
  if (!volume || volume.used_gb === null || volume.quota_gb === null) return null;
  return Math.max(0, volume.quota_gb - volume.used_gb);
}

function checkpointWaveGb(jobs: QueueJob[]): number {
  const estimate = jobs.reduce((sum, job) => sum + Math.max(40, job.gpu_count * 40), 0);
  return estimate || 40;
}

function budgetLevel(
  scratch: StorageVolume | undefined,
  home: StorageVolume | undefined,
  slots: number | null,
  urgentJobs: number
): CheckpointBudgetLevel {
  if (scratch?.severity === "critical" || (slots !== null && slots < 3)) return "critical";
  if (urgentJobs && slots !== null && slots < 8) return "critical";
  if (scratch?.severity === "warning" || (home?.file_percent_used ?? 0) >= 85 || (slots !== null && slots < 10)) return "watch";
  return "clear";
}

function labelFor(level: CheckpointBudgetLevel): string {
  if (level === "critical") return "checkpoint risk";
  if (level === "watch") return "budget tight";
  return "checkpoint headroom";
}

function headlineFor(
  scratch: StorageVolume | undefined,
  activeGpuJobs: number,
  scratchFreeGb: number | null,
  slots: number | null,
  waveGb: number
): string {
  if (!scratch) return "Quota data is unavailable; verify scratch before long training launches write checkpoints.";
  if (scratch.severity === "critical" && scratchFreeGb !== null) {
    return `${scratch.name} has ${formatGb(scratchFreeGb)} free but is ${scratch.percent_used ?? "n/a"}% used; trim checkpoints before scaling GPU runs.`;
  }
  if (!activeGpuJobs) {
    return `${scratch.name} is the active checkpoint target; no visible GPU training job is writing against it right now.`;
  }
  if (slots !== null) {
    return `${scratch.name} can absorb about ${slots} ${formatGb(waveGb)} checkpoint wave(s) for visible GPU jobs.`;
  }
  return `${scratch.name} quota is visible but remaining capacity could not be calculated from the current probe.`;
}

function scratchSignal(volume: StorageVolume | undefined, free: number | null): CheckpointBudgetSignal {
  if (!volume) {
    return {
      id: "scratch",
      label: "scratch headroom",
      value: "unknown",
      detail: "Run the quota probe before checkpoint-heavy work starts.",
      severity: "watch"
    };
  }
  return {
    id: "scratch",
    label: "scratch headroom",
    value: free === null ? `${volume.percent_used ?? "n/a"}% used` : `${formatGb(free)} free`,
    detail: `${volume.name} is ${volume.percent_used ?? "n/a"}% used; reserve space for logs, caches, datasets, and checkpoints.`,
    severity: volume.severity === "critical" ? "critical" : volume.severity === "warning" ? "watch" : "clear"
  };
}

function waveSignal(activeGpuJobs: number, slots: number | null, waveGb: number): CheckpointBudgetSignal {
  return {
    id: "waves",
    label: "checkpoint waves",
    value: slots === null ? "unknown" : `${slots} x ${formatGb(waveGb)}`,
    detail: activeGpuJobs
      ? `Estimated from ${activeGpuJobs} active GPU job(s) at ${formatGb(waveGb)} per checkpoint wave.`
      : `Uses a ${formatGb(waveGb)} planning estimate until a GPU job is active.`,
    severity: slots !== null && slots < 3 ? "critical" : slots !== null && slots < 10 ? "watch" : "clear"
  };
}

function walltimeSignal(activeGpuJobs: QueueJob[], urgentJobs: QueueJob[]): CheckpointBudgetSignal {
  if (!activeGpuJobs.length) {
    return {
      id: "walltime",
      label: "final checkpoint",
      value: "no GPU run",
      detail: "No visible GPU job needs a final checkpoint warning right now.",
      severity: "clear"
    };
  }
  const urgent = urgentJobs[0];
  if (urgent) {
    return {
      id: "walltime",
      label: "final checkpoint",
      value: `${urgentJobs.length} urgent`,
      detail: `${urgent.name ?? urgent.job_id} has ${formatDuration(remainingSeconds(urgent)!)} left; verify final checkpoint target now.`,
      severity: "critical"
    };
  }
  return {
    id: "walltime",
    label: "final checkpoint",
    value: `${activeGpuJobs.length} active GPU`,
    detail: "Visible GPU jobs still have more than an hour before walltime based on Slurm fields.",
    severity: "clear"
  };
}

function homeSignal(home: StorageVolume | undefined): CheckpointBudgetSignal {
  const filePercent = home?.file_percent_used ?? null;
  return {
    id: "home",
    label: "home cache pressure",
    value: filePercent === null ? "unknown" : `${filePercent}% files`,
    detail:
      filePercent !== null && filePercent >= 85
        ? "Move pip, conda, Hugging Face, and model caches out of home before more runs."
        : "Home file-count pressure is not the leading checkpoint risk.",
    severity: filePercent !== null && filePercent >= 95 ? "critical" : filePercent !== null && filePercent >= 85 ? "watch" : "clear"
  };
}

function remainingSeconds(job: QueueJob): number | null {
  if (job.time_limit_seconds === null || job.elapsed_seconds === null) return null;
  return Math.max(0, job.time_limit_seconds - job.elapsed_seconds);
}

function severityRank(severity: StorageVolume["severity"]): number {
  return severity === "critical" ? 2 : severity === "warning" ? 1 : 0;
}

function formatGb(value: number): string {
  if (value >= 100) return `${Math.round(value)} GB`;
  return `${Math.round(value * 10) / 10} GB`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function checkpointCommand(alias: string): string {
  return `ssh ${alias} 'acct-chk "$USER"; printf "\\nLargest scratch directories:\\n"; du -h -d 1 /scratch/"$USER" 2>/dev/null | sort -h | tail -20; printf "\\nCheckpoint-like files:\\n"; find /scratch/"$USER" \\( -name "*ckpt*" -o -name "*.pt" -o -name "*.pth" \\) -type f -printf "%s %p\\n" 2>/dev/null | sort -n | tail -20'`;
}
