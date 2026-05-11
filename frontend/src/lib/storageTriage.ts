import type { StorageResponse, StorageVolume } from "../types";

export type StorageTriageLevel = "clear" | "watch" | "critical" | "unknown";

export type StorageSignal = {
  id: string;
  volume: string;
  path: string;
  kind: "space" | "files";
  severity: "warning" | "critical";
  title: string;
  value: string;
  impact: string;
  nextStep: string;
  command: string;
};

export type StorageTriage = {
  level: StorageTriageLevel;
  label: string;
  summary: string;
  signals: StorageSignal[];
  quotaCommand: string;
};

export function buildStorageTriage(storage: StorageResponse | null, alias: string): StorageTriage {
  const volumes = storage?.volumes ?? [];
  if (!volumes.length) {
    return {
      level: "unknown",
      label: "quota unavailable",
      summary: "Storage quota output has not been parsed yet; run a quota probe before staging new datasets.",
      signals: [],
      quotaCommand: ssh(alias, 'acct-chk "$USER"')
    };
  }

  const signals = volumes.flatMap((volume) => signalsForVolume(volume, alias)).sort(compareSignals);
  const level = triageLevel(signals);
  return {
    level,
    label: labelFor(level, signals.length),
    summary: summaryFor(level, signals, volumes),
    signals,
    quotaCommand: ssh(alias, 'acct-chk "$USER"')
  };
}

function signalsForVolume(volume: StorageVolume, alias: string): StorageSignal[] {
  const path = volume.path ?? fallbackPath(volume.name);
  const signals: StorageSignal[] = [];
  const spaceSeverity = severityFor(volume.percent_used, volume.severity);
  const fileSeverity = severityFor(volume.file_percent_used, volume.file_percent_used !== null && volume.file_percent_used >= 95 ? "critical" : "info");

  if (spaceSeverity) {
    signals.push({
      id: `${volume.name}-space`,
      volume: volume.name,
      path,
      kind: "space",
      severity: spaceSeverity,
      title: `${volume.name} space is ${spaceSeverity}`,
      value: percent(volume.percent_used),
      impact: impactFor(volume.name, "space", spaceSeverity),
      nextStep: "Find the largest first-level directories before launching checkpoint-heavy or data-staging jobs.",
      command: ssh(alias, `du -h --max-depth=1 ${pathToken(path)} 2>/dev/null | sort -h | tail -20`)
    });
  }

  if (fileSeverity) {
    signals.push({
      id: `${volume.name}-files`,
      volume: volume.name,
      path,
      kind: "files",
      severity: fileSeverity,
      title: `${volume.name} file count is ${fileSeverity === "critical" ? "critical" : "high"}`,
      value: percent(volume.file_percent_used),
      impact: impactFor(volume.name, "files", fileSeverity),
      nextStep: "Inspect shallow small-file hotspots from caches, environments, logs, and experiment shards.",
      command: ssh(
        alias,
        `find ${pathToken(path)} -xdev -maxdepth 3 -type f -print0 2>/dev/null | xargs -0 -r dirname | sort | uniq -c | sort -nr | head -20`
      )
    });
  }

  return signals;
}

function severityFor(percentUsed: number | null, sourceSeverity: StorageVolume["severity"]): StorageSignal["severity"] | null {
  const percent = Number.isFinite(percentUsed) ? Number(percentUsed) : null;
  if (sourceSeverity === "critical" || (percent !== null && percent >= 95)) return "critical";
  if (sourceSeverity === "warning" || (percent !== null && percent >= 85)) return "warning";
  return null;
}

function triageLevel(signals: StorageSignal[]): StorageTriageLevel {
  if (signals.some((signal) => signal.severity === "critical")) return "critical";
  if (signals.length) return "watch";
  return "clear";
}

function labelFor(level: StorageTriageLevel, count: number): string {
  if (level === "critical") return `${count} quota edge${count === 1 ? "" : "s"}`;
  if (level === "watch") return `${count} watch item${count === 1 ? "" : "s"}`;
  if (level === "clear") return "quota clear";
  return "needs probe";
}

function summaryFor(level: StorageTriageLevel, signals: StorageSignal[], volumes: StorageVolume[]): string {
  if (level === "critical") {
    const names = namesFor(signals.filter((signal) => signal.severity === "critical"));
    return `${names} can fail writes, checkpoints, or environment creation before Slurm reports a scheduler problem.`;
  }
  if (level === "watch") {
    const names = namesFor(signals);
    return `${names} ${signalsSubject(signals)} close enough to quota that cleanup should happen before large staging or array runs.`;
  }
  return `${volumes.length} storage volume${volumes.length === 1 ? "" : "s"} parsed with no visible quota pressure.`;
}

function impactFor(volume: string, kind: StorageSignal["kind"], severity: StorageSignal["severity"]): string {
  const weight = severity === "critical" ? "can" : "may";
  if (kind === "files") {
    return `${volume} ${weight} reject new virtualenv files, logs, tensor shards, or package caches even when byte quota remains.`;
  }
  if (volume.toLowerCase().includes("scratch")) {
    return `${volume} ${weight} break checkpoints, dataloader staging, and multi-GPU runs that need burst write room.`;
  }
  return `${volume} ${weight} block notebooks, shell startup, package installs, and job logs.`;
}

function compareSignals(left: StorageSignal, right: StorageSignal): number {
  return severityRank(right.severity) - severityRank(left.severity) || kindRank(left.kind) - kindRank(right.kind) || left.volume.localeCompare(right.volume);
}

function severityRank(severity: StorageSignal["severity"]): number {
  return severity === "critical" ? 2 : 1;
}

function kindRank(kind: StorageSignal["kind"]): number {
  return kind === "space" ? 0 : 1;
}

function namesFor(signals: StorageSignal[]): string {
  const names = Array.from(new Set(signals.map((signal) => signal.volume)));
  if (!names.length) return "Storage";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function signalsSubject(signals: StorageSignal[]): string {
  return new Set(signals.map((signal) => signal.volume)).size === 1 ? "is" : "are";
}

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "n/a" : `${Math.round(value)}%`;
}

function fallbackPath(name: string): string {
  return name.toLowerCase().includes("scratch") ? "/scratch/$USER" : "$HOME";
}

function pathToken(path: string): string {
  if (/^[A-Za-z0-9_./$-]+$/.test(path)) return path;
  return shellQuote(path);
}

function ssh(alias: string, remoteCommand: string): string {
  return `ssh ${alias} ${shellQuote(remoteCommand)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
