import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { Client as SshClient } from 'ssh2';
import { createServer as createViteServer } from 'vite';
import {
  ActiveProcessItem,
  ClusterServerSummary,
  ConnectionState,
  CpuMetrics,
  DiskMountMetrics,
  GpuCollectionStatus,
  GpuDeviceMetrics,
  LoadThresholds,
  MemoryMetrics,
  MonitorErrorInfo,
  MonitorSnapshot,
  SandboxScenario,
  ServerLoadVerdict,
  SshConfigUpdateInput,
  SshSafeConfigSummary,
  TrendPoint,
} from './src/types/monitor';
import { generateSandboxSnapshot, buildSandboxHistory } from './src/utils/sandboxGenerator';
import {
  DEFAULT_THRESHOLDS,
  ProcStatSample,
  REMOTE_PROBE_SCRIPT,
  calculateCpuDeltaUsage,
  classifySshError,
  evaluateServerVerdict,
  extractSection,
  mergeGpuAndSystemProcesses,
  parseDfOutput,
  parseLoadAvg,
  parseNvidiaSmiOutput,
  parseProcMeminfo,
  parseProcStatLine,
  validateSshConfigInput,
} from './src/utils/telemetryParser';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCAL_CONFIG_PATH = path.resolve(__dirname, '.ssh-monitor.local.json');

interface InternalSshConfig {
  alias: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'privateKeyPath' | 'agent';
  privateKeyPath: string;
  passphrase: string;
  hostKeyPolicy: 'known_hosts' | 'pinned_fingerprint';
  pinnedFingerprint: string;
  knownHostsPath: string;
}

interface PersistedLocalSettings {
  ssh?: Partial<InternalSshConfig>;
  pollIntervalMs?: number;
  thresholds?: Partial<LoadThresholds>;
  mode?: 'ssh' | 'sandbox';
  sandboxScenario?: SandboxScenario;
}

function expandHomePath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) return '';
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

/**
 * Resolves a host alias from ~/.ssh/config if present.
 */
function resolveSshConfigAlias(hostAlias: string): {
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
} {
  try {
    const sshConfigFile = path.join(os.homedir(), '.ssh', 'config');
    if (!fs.existsSync(sshConfigFile)) return {};
    const content = fs.readFileSync(sshConfigFile, 'utf-8');
    const lines = content.split(/\r?\n/);
    let inMatchingHost = false;
    const result: {
      hostName?: string;
      user?: string;
      port?: number;
      identityFile?: string;
    } = {};

    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const key = parts[0].toLowerCase();
      const val = parts.slice(1).join(' ');

      if (key === 'host') {
        const patterns = parts.slice(1);
        inMatchingHost = patterns.includes(hostAlias);
        continue;
      }

      if (!inMatchingHost) continue;
      if (key === 'hostname' && !result.hostName) result.hostName = val;
      if (key === 'user' && !result.user) result.user = val;
      if (key === 'port' && !result.port) {
        const p = Number(val);
        if (Number.isInteger(p) && p > 0 && p <= 65535) result.port = p;
      }
      if (key === 'identityfile' && !result.identityFile) {
        result.identityFile = val.replace(/^["']|["']$/g, '');
      }
    }
    return result;
  } catch {
    return {};
  }
}

export interface SshConfigProfileItem {
  alias: string;
  hostName: string;
  user: string;
  port: number;
  identityFile: string;
}

function listSshConfigProfiles(): SshConfigProfileItem[] {
  try {
    const sshConfigFile = path.join(os.homedir(), '.ssh', 'config');
    if (!fs.existsSync(sshConfigFile)) return [];
    const content = fs.readFileSync(sshConfigFile, 'utf-8');
    const lines = content.split(/\r?\n/);
    const profiles: SshConfigProfileItem[] = [];
    let current: Partial<SshConfigProfileItem> & { aliases?: string[] } | null = null;

    const flush = () => {
      if (current && current.aliases && current.aliases.length > 0) {
        for (const al of current.aliases) {
          if (al === '*' || al.includes('*') || al.toLowerCase() === 'github.com') continue;
          profiles.push({
            alias: al,
            hostName: current.hostName || al,
            user: current.user || 'ubuntu',
            port: current.port || 22,
            identityFile: current.identityFile || '~/.ssh/id_ed25519',
          });
        }
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const key = parts[0].toLowerCase();
      const val = parts.slice(1).join(' ');

      if (key === 'host') {
        flush();
        current = {
          aliases: parts.slice(1),
        };
        continue;
      }

      if (!current) continue;
      if (key === 'hostname') current.hostName = val;
      if (key === 'user') current.user = val;
      if (key === 'port') {
        const p = Number(val);
        if (Number.isInteger(p) && p > 0 && p <= 65535) current.port = p;
      }
      if (key === 'identityfile') {
        current.identityFile = val.replace(/^["']|["']$/g, '');
      }
    }
    flush();
    return profiles;
  } catch {
    return [];
  }
}

export function getDedupedSshProfiles(): SshConfigProfileItem[] {
  const profiles = listSshConfigProfiles();
  const groupMap = new Map<string, SshConfigProfileItem[]>();
  for (const p of profiles) {
    const match = p.alias.match(/^(LAB\d+)/i);
    const groupKey = match ? match[1].toUpperCase() : p.alias;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, []);
    }
    groupMap.get(groupKey)!.push(p);
  }

  const sortedGroupKeys = Array.from(groupMap.keys()).sort((a, b) => {
    const isLabA = /^LAB\d+/i.test(a);
    const isLabB = /^LAB\d+/i.test(b);
    if (isLabA && isLabB) {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      if (Number.isFinite(numA) && Number.isFinite(numB)) {
        return numA - numB;
      }
    } else if (isLabA) {
      return -1;
    } else if (isLabB) {
      return 1;
    }
    return a.localeCompare(b);
  });

  return sortedGroupKeys.map((key) => {
    const items = groupMap.get(key)!;
    const exact = items.find((it) => it.alias.toUpperCase() === key);
    if (exact) return exact;
    const wuheng = items.find((it) => it.alias.toLowerCase().includes('wuheng') || it.user.toLowerCase() === 'wuheng');
    if (wuheng) return wuheng;
    return items[0];
  });
}

/**
 * Verifies a server's public key buffer against ~/.ssh/known_hosts or pinned SHA256 fingerprint.
 * Never unconditionally trusts unknown or mismatched host keys.
 */
function verifyServerHostKey(params: {
  host: string;
  port: number;
  keyBuffer: Buffer;
  policy: 'known_hosts' | 'pinned_fingerprint';
  pinnedFingerprint: string;
  knownHostsPath: string;
}): { verified: boolean; reason?: string; observedFingerprint: string } {
  const { host, port, keyBuffer, policy, pinnedFingerprint, knownHostsPath } = params;
  const sha256Base64 = crypto
    .createHash('sha256')
    .update(keyBuffer)
    .digest('base64')
    .replace(/=+$/, '');
  const observedFingerprint = `SHA256:${sha256Base64}`;

  const cleanPinned = pinnedFingerprint.trim().replace(/^SHA256:/i, '').replace(/=+$/, '');
  if (cleanPinned) {
    if (cleanPinned === sha256Base64) {
      return { verified: true, observedFingerprint };
    }
    return {
      verified: false,
      reason: `HOST_KEY_MISMATCH: 服务器公钥指纹 (${observedFingerprint}) 与固定指纹 (SHA256:${cleanPinned}) 不匹配`,
      observedFingerprint,
    };
  }

  if (policy === 'pinned_fingerprint') {
    return {
      verified: false,
      reason: `HOST_KEY_UNVERIFIED: 当前采用固定指纹校验策略，但尚未配置信任的 SHA256 指纹（当前服务器指纹：${observedFingerprint}）`,
      observedFingerprint,
    };
  }

  const resolvedKnownHosts = expandHomePath(knownHostsPath || '~/.ssh/known_hosts');
  if (!resolvedKnownHosts || !fs.existsSync(resolvedKnownHosts)) {
    return {
      verified: false,
      reason: `HOST_KEY_UNVERIFIED: 本地未找到 known_hosts 文件 (${resolvedKnownHosts})，无法验证主机 ${host}（服务器指纹：${observedFingerprint}）`,
      observedFingerprint,
    };
  }

  const content = fs.readFileSync(resolvedKnownHosts, 'utf-8');
  const keyBase64 = keyBuffer.toString('base64');
  const candidateTokens = port === 22 ? [host, `[${host}]:22`] : [`[${host}]:${port}`, host];

  let hostFoundInKnownHosts = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('@revoked')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    // Handle optional @cert-authority marker
    const offset = parts[0].startsWith('@') ? 1 : 0;
    const hostsField = parts[offset];
    const lineKeyBase64 = parts[offset + 2];
    if (!hostsField || !lineKeyBase64) continue;

    let matchesHost = false;

    if (hostsField.startsWith('|1|')) {
      // Hashed known_hosts format: |1|base64Salt|base64HmacSha1
      const hashParts = hostsField.split('|');
      if (hashParts.length >= 4) {
        const salt = Buffer.from(hashParts[2], 'base64');
        const expectedHash = hashParts[3];
        for (const token of candidateTokens) {
          const hmac = crypto.createHmac('sha1', salt).update(token).digest('base64');
          if (hmac === expectedHash) {
            matchesHost = true;
            break;
          }
        }
      }
    } else {
      const hostList = hostsField.split(',');
      matchesHost = candidateTokens.some((t) => hostList.includes(t));
    }

    if (matchesHost) {
      hostFoundInKnownHosts = true;
      if (lineKeyBase64 === keyBase64) {
        return { verified: true, observedFingerprint };
      }
    }
  }

  if (hostFoundInKnownHosts) {
    return {
      verified: false,
      reason: `HOST_KEY_MISMATCH: 主机 ${host} 在 known_hosts 中存在记录，但服务器返回的公钥指纹 (${observedFingerprint}) 与已有记录不匹配！`,
      observedFingerprint,
    };
  }

  return {
    verified: false,
    reason: `HOST_KEY_UNVERIFIED: 主机 ${host} 尚未存在于 known_hosts 中（检测到服务器公钥指纹：${observedFingerprint}）`,
    observedFingerprint,
  };
}

class MonitorCollector {
  private sshConfig: InternalSshConfig;
  private pollIntervalMs: number;
  private connectTimeoutMs: number;
  private commandTimeoutMs: number;
  private thresholds: LoadThresholds;
  private mode: 'ssh' | 'sandbox';
  private sandboxScenario: SandboxScenario = 'idle';

  private connectionState: ConnectionState = 'unconfigured';
  private lastUpdatedAt: number | null = null;
  private monitoringStartedAt: number | null = null;
  private uptimeSeconds: number | null = null;
  private hostname: string | null = null;
  private osRelease: string | null = null;
  private gpuStatus: GpuCollectionStatus = 'no_command';
  private gpuStatusMessage: string | null = null;
  private gpus: GpuDeviceMetrics[] = [];
  private cpu: CpuMetrics | null = null;
  private memory: MemoryMetrics | null = null;
  private disks: DiskMountMetrics[] = [];
  private processes: ActiveProcessItem[] = [];
  private trends: TrendPoint[] = [];
  private sandboxTrends: TrendPoint[] = [];
  private clusterSummaries: ClusterServerSummary[] = [];
  private lastClusterPollAt = 0;
  private isPollingCluster = false;
  private lastError: MonitorErrorInfo | null = null;
  private previousVerdict: MonitorSnapshot['verdict'] | undefined = undefined;
  private prevProcStat: ProcStatSample | null = null;
  private consecutiveFailures = 0;

  private sshClient: SshClient | null = null;
  private sshClientConnected = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private isCollecting = false;
  private subscribers = new Set<Response>();

  constructor() {
    const persisted = this.loadPersistedSettings();

    this.sshConfig = {
      alias:
        persisted.ssh?.alias ||
        process.env.SSH_SERVER_ALIAS ||
        'Ubuntu-DL-Node-01',
      host: (persisted.ssh?.host ?? process.env.SSH_HOST ?? '').trim(),
      port: Number(persisted.ssh?.port ?? process.env.SSH_PORT ?? 22) || 22,
      username: (
        persisted.ssh?.username ??
        process.env.SSH_USERNAME ??
        'ubuntu'
      ).trim(),
      authMethod:
        (persisted.ssh?.authMethod ??
          (process.env.SSH_AUTH_METHOD as 'privateKeyPath' | 'agent')) === 'agent'
          ? 'agent'
          : 'privateKeyPath',
      privateKeyPath:
        persisted.ssh?.privateKeyPath ??
        process.env.SSH_PRIVATE_KEY_PATH ??
        '~/.ssh/id_ed25519',
      passphrase:
        persisted.ssh?.passphrase ?? process.env.SSH_PASSPHRASE ?? '',
      hostKeyPolicy:
        (persisted.ssh?.hostKeyPolicy ??
          (process.env.SSH_HOST_KEY_POLICY as 'known_hosts' | 'pinned_fingerprint')) ===
        'pinned_fingerprint'
          ? 'pinned_fingerprint'
          : 'known_hosts',
      pinnedFingerprint:
        persisted.ssh?.pinnedFingerprint ??
        process.env.SSH_HOST_FINGERPRINT ??
        '',
      knownHostsPath:
        persisted.ssh?.knownHostsPath ??
        process.env.SSH_KNOWN_HOSTS_PATH ??
        '~/.ssh/known_hosts',
    };

    this.pollIntervalMs = this.clampPollInterval(
      Number(
        persisted.pollIntervalMs ?? process.env.MONITOR_POLL_INTERVAL_MS ?? 5000
      )
    );
    this.connectTimeoutMs =
      Number(process.env.SSH_CONNECT_TIMEOUT_MS ?? 10000) || 10000;
    this.commandTimeoutMs =
      Number(process.env.SSH_COMMAND_TIMEOUT_MS ?? 8000) || 8000;

    this.thresholds = {
      gpuIdleMaxPercent: Number(
        persisted.thresholds?.gpuIdleMaxPercent ??
          process.env.THRESHOLD_GPU_IDLE_MAX ??
          DEFAULT_THRESHOLDS.gpuIdleMaxPercent
      ),
      gpuBusyMinPercent: Number(
        persisted.thresholds?.gpuBusyMinPercent ??
          process.env.THRESHOLD_GPU_BUSY_MIN ??
          DEFAULT_THRESHOLDS.gpuBusyMinPercent
      ),
      vramBusyMinPercent: Number(
        persisted.thresholds?.vramBusyMinPercent ??
          process.env.THRESHOLD_VRAM_BUSY_MIN ??
          DEFAULT_THRESHOLDS.vramBusyMinPercent
      ),
      cpuIdleMaxPercent: Number(
        persisted.thresholds?.cpuIdleMaxPercent ??
          process.env.THRESHOLD_CPU_IDLE_MAX ??
          DEFAULT_THRESHOLDS.cpuIdleMaxPercent
      ),
      cpuBusyMinPercent: Number(
        persisted.thresholds?.cpuBusyMinPercent ??
          process.env.THRESHOLD_CPU_BUSY_MIN ??
          DEFAULT_THRESHOLDS.cpuBusyMinPercent
      ),
      memBusyMinPercent: Number(
        persisted.thresholds?.memBusyMinPercent ??
          process.env.THRESHOLD_MEM_BUSY_MIN ??
          DEFAULT_THRESHOLDS.memBusyMinPercent
      ),
      smoothingWindowSamples: Number(
        persisted.thresholds?.smoothingWindowSamples ??
          DEFAULT_THRESHOLDS.smoothingWindowSamples
      ),
    };

    this.mode = persisted.mode ?? 'ssh';
    this.sandboxScenario = persisted.sandboxScenario ?? 'idle';
    this.monitoringStartedAt = Date.now();

    if (this.mode === 'sandbox') {
      this.sandboxTrends = buildSandboxHistory(
        this.sandboxScenario,
        this.pollIntervalMs,
        Date.now()
      );
    }

    this.connectionState = this.sshConfig.host ? 'connecting' : 'unconfigured';
  }

  private clampPollInterval(ms: number): number {
    if (!Number.isFinite(ms)) return 5000;
    return Math.min(60000, Math.max(2000, Math.round(ms)));
  }

  private loadPersistedSettings(): PersistedLocalSettings {
    try {
      if (fs.existsSync(LOCAL_CONFIG_PATH)) {
        const raw = fs.readFileSync(LOCAL_CONFIG_PATH, 'utf-8');
        return JSON.parse(raw) as PersistedLocalSettings;
      }
    } catch {
      // Ignore corrupt local file
    }
    return {};
  }

  private savePersistedSettings(): void {
    try {
      // Notice: We never persist passphrase in plaintext to disk; only safe connection paths & settings
      const payload: PersistedLocalSettings = {
        ssh: {
          alias: this.sshConfig.alias,
          host: this.sshConfig.host,
          port: this.sshConfig.port,
          username: this.sshConfig.username,
          authMethod: this.sshConfig.authMethod,
          privateKeyPath: this.sshConfig.privateKeyPath,
          hostKeyPolicy: this.sshConfig.hostKeyPolicy,
          pinnedFingerprint: this.sshConfig.pinnedFingerprint,
          knownHostsPath: this.sshConfig.knownHostsPath,
        },
        pollIntervalMs: this.pollIntervalMs,
        thresholds: this.thresholds,
        mode: this.mode,
        sandboxScenario: this.sandboxScenario,
      };
      fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(payload, null, 2), {
        mode: 0o600,
      });
    } catch {
      // Non-fatal if read-only filesystem
    }
  }

  public getSafeSshConfig(): SshSafeConfigSummary {
    return {
      alias: this.sshConfig.alias || 'Ubuntu-DL-Node-01',
      host: this.sshConfig.host,
      port: this.sshConfig.port,
      username: this.sshConfig.username,
      authMethod: this.sshConfig.authMethod,
      privateKeyPathHint: this.sshConfig.privateKeyPath,
      hasPassphrase: Boolean(this.sshConfig.passphrase),
      hostKeyPolicy: this.sshConfig.hostKeyPolicy,
      pinnedFingerprint: this.sshConfig.pinnedFingerprint,
      knownHostsPath: this.sshConfig.knownHostsPath,
      configured: Boolean(this.sshConfig.host && this.sshConfig.username),
    };
  }

  public start(): void {
    this.scheduleNextTick(100);
  }

  private scheduleNextTick(delayMs?: number): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    let nextDelay = delayMs ?? this.pollIntervalMs;
    if (
      delayMs === undefined &&
      this.mode === 'ssh' &&
      this.consecutiveFailures > 0
    ) {
      // Exponential backoff on consecutive SSH failures (up to 60s)
      nextDelay = Math.min(
        60000,
        Math.round(this.pollIntervalMs * Math.pow(1.75, Math.min(6, this.consecutiveFailures)))
      );
    }

    this.pollTimer = setTimeout(async () => {
      await this.collectOnce();
      this.scheduleNextTick();
    }, nextDelay);
  }

  public addSubscriber(res: Response): void {
    this.subscribers.add(res);
    res.write(`data: ${JSON.stringify(this.getSnapshot())}\n\n`);
  }

  public removeSubscriber(res: Response): void {
    this.subscribers.delete(res);
  }

  private broadcast(): void {
    if (this.subscribers.size === 0) return;
    const payload = `data: ${JSON.stringify(this.getSnapshot())}\n\n`;
    for (const res of this.subscribers) {
      try {
        res.write(payload);
      } catch {
        this.subscribers.delete(res);
      }
    }
  }

  private pollClusterSummariesAsync(): void {
    const now = Date.now();
    // Poll cluster summary every 15 seconds
    if (this.isPollingCluster || (now - this.lastClusterPollAt < 15000 && this.clusterSummaries.length > 0)) {
      return;
    }
    this.isPollingCluster = true;
    this.lastClusterPollAt = now;

    const dedupedProfiles = getDedupedSshProfiles().filter((p) => p.alias.toUpperCase().startsWith('LAB'));
    if (dedupedProfiles.length === 0) {
      this.isPollingCluster = false;
      return;
    }

    const script = 'export LC_ALL=C LANG=C; hostname; nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>&1';
    let remaining = dedupedProfiles.length;
    const tempMap = new Map<string, ClusterServerSummary>();

    for (const p of dedupedProfiles) {
      const match = p.alias.match(/^(LAB\d+)/i);
      const displayKey = match ? match[1].toUpperCase() : p.alias;

      execFile(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4', p.alias, script],
        { timeout: 5000 },
        (err, stdout, stderr) => {
          remaining--;
          const out = (stdout || '').trim();
          if (err || !out) {
            tempMap.set(displayKey, {
              serverId: displayKey,
              serverAlias: displayKey,
              host: p.hostName,
              connectionState: 'error',
              verdict: 'error',
              verdictLabel: '连接异常',
              gpuCount: 0,
              idleGpuCount: 0,
              gpuSummaryText: '连接超时或未响应',
              maxGpuUtil: null,
              maxVramUtil: null,
              lastUpdatedAt: Date.now(),
              error: stderr?.trim() || err?.message || '连接失败',
            });
          } else {
            const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const gpuLines = lines.filter((l) => /^\d+\s*,/.test(l));
            let maxUtil: number | null = null;
            let maxVram: number | null = null;
            let idleGpuCount = 0;

            for (const gl of gpuLines) {
              const cols = gl.split(',').map((c) => c.trim());
              const util = Number(cols[2]);
              const used = Number(cols[3]);
              const total = Number(cols[4]);
              let vramPct = 0;
              if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
                vramPct = Math.round((used / total) * 100);
                maxVram = maxVram === null ? vramPct : Math.max(maxVram, vramPct);
              }
              if (Number.isFinite(util)) {
                maxUtil = maxUtil === null ? util : Math.max(maxUtil, util);
                if (util <= this.thresholds.gpuIdleMaxPercent && vramPct < 35) {
                  idleGpuCount++;
                }
              }
            }

            let verdict: ServerLoadVerdict = 'idle';
            let verdictLabel: '空闲' | '轻载' | '繁忙' | '连接异常' = '空闲';

            if (maxUtil !== null) {
              if (maxUtil >= this.thresholds.gpuBusyMinPercent || (maxVram !== null && maxVram >= this.thresholds.vramBusyMinPercent)) {
                verdict = 'busy';
                verdictLabel = '繁忙';
              } else if (maxUtil > this.thresholds.gpuIdleMaxPercent || (maxVram !== null && maxVram >= 35)) {
                verdict = 'light';
                verdictLabel = '轻载';
              }
            }

            let gpuSummaryText = '未检测到 NVIDIA GPU';
            if (gpuLines.length > 0) {
              if (verdict === 'busy' && idleGpuCount > 0) {
                gpuSummaryText = `${gpuLines.length}×3090 · 空闲 ${idleGpuCount}/${gpuLines.length} 卡`;
              } else {
                gpuSummaryText = `${gpuLines.length}×3090 · 最高利用率 ${maxUtil !== null ? maxUtil + '%' : '—'}`;
              }
            }

            tempMap.set(displayKey, {
              serverId: displayKey,
              serverAlias: displayKey,
              host: p.hostName,
              connectionState: 'connected',
              verdict,
              verdictLabel,
              gpuCount: gpuLines.length,
              idleGpuCount,
              gpuSummaryText,
              maxGpuUtil: maxUtil,
              maxVramUtil: maxVram,
              lastUpdatedAt: Date.now(),
            });
          }

          if (remaining === 0) {
            this.isPollingCluster = false;
            // 按 LAB1 -> LAB9 顺序严格组装
            const sortedKeys = dedupedProfiles.map((p) => {
              const m = p.alias.match(/^(LAB\d+)/i);
              return m ? m[1].toUpperCase() : p.alias;
            });
            this.clusterSummaries = sortedKeys
              .map((key) => tempMap.get(key))
              .filter((item): item is ClusterServerSummary => item !== undefined);
            this.broadcast();
          }
        }
      );
    }
  }

  public getSnapshot(): MonitorSnapshot {
    if (this.mode === 'sandbox') {
      const snap = generateSandboxSnapshot({
        scenario: this.sandboxScenario,
        pollIntervalMs: this.pollIntervalMs,
        thresholds: this.thresholds,
        existingTrends: this.sandboxTrends,
        monitoringStartedAt: this.monitoringStartedAt ?? Date.now(),
        sshConfig: this.getSafeSshConfig(),
      });
      this.sandboxTrends = snap.trends;
      return snap;
    }

    // Check if real SSH data has gone stale
    let effectiveState = this.connectionState;
    if (
      (effectiveState === 'connected' || effectiveState === 'collecting') &&
      this.lastUpdatedAt &&
      Date.now() - this.lastUpdatedAt > Math.max(15000, this.pollIntervalMs * 2.5)
    ) {
      effectiveState = 'stale';
    }

    const verdictInfo = evaluateServerVerdict({
      connectionState: effectiveState,
      gpus: this.gpus,
      cpu: this.cpu,
      memory: this.memory,
      recentTrends: this.trends,
      thresholds: this.thresholds,
      previousVerdict: this.previousVerdict,
    });
    this.previousVerdict = verdictInfo.verdict;

    return {
      serverId: 'primary-ssh-node',
      serverAlias: this.sshConfig.alias || this.sshConfig.host || '未配置服务器',
      host: this.sshConfig.host || '未配置',
      mode: 'ssh',
      clusterNodes: this.clusterSummaries,
      connectionState: effectiveState,
      verdict: verdictInfo.verdict,
      verdictLabel: verdictInfo.verdictLabel,
      verdictReason: verdictInfo.verdictReason,
      verdictAdvisory: verdictInfo.verdictAdvisory,
      computeVsVramNote: verdictInfo.computeVsVramNote,
      lastUpdatedAt: this.lastUpdatedAt,
      monitoringStartedAt: this.monitoringStartedAt,
      uptimeSeconds: this.uptimeSeconds,
      hostname: this.hostname,
      osRelease: this.osRelease,
      gpuStatus: this.gpuStatus,
      gpuStatusMessage: this.gpuStatusMessage,
      gpus: this.gpus,
      cpu: this.cpu,
      memory: this.memory,
      disks: this.disks,
      processes: this.processes,
      trends: this.trends,
      pollIntervalMs: this.pollIntervalMs,
      thresholds: this.thresholds,
      lastError: this.lastError,
      sshConfig: this.getSafeSshConfig(),
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  public async triggerImmediateRefresh(): Promise<MonitorSnapshot> {
    this.consecutiveFailures = 0;
    this.lastClusterPollAt = 0;
    await this.collectOnce();
    this.scheduleNextTick();
    return this.getSnapshot();
  }

  public setMode(mode: 'ssh' | 'sandbox', scenario?: SandboxScenario): MonitorSnapshot {
    this.mode = mode;
    if (scenario) {
      if (this.sandboxScenario !== scenario) {
        this.sandboxScenario = scenario;
        this.sandboxTrends = buildSandboxHistory(
          scenario,
          this.pollIntervalMs,
          Date.now()
        );
      }
    } else if (mode === 'sandbox' && this.sandboxTrends.length === 0) {
      this.sandboxTrends = buildSandboxHistory(
        this.sandboxScenario,
        this.pollIntervalMs,
        Date.now()
      );
    }

    this.savePersistedSettings();
    if (mode === 'ssh') {
      this.scheduleNextTick(50);
    } else {
      this.broadcast();
    }
    return this.getSnapshot();
  }

  public updateSettings(params: {
    pollIntervalMs?: number;
    thresholds?: Partial<LoadThresholds>;
  }): MonitorSnapshot {
    if (typeof params.pollIntervalMs === 'number') {
      this.pollIntervalMs = this.clampPollInterval(params.pollIntervalMs);
    }
    if (params.thresholds) {
      this.thresholds = {
        ...this.thresholds,
        ...params.thresholds,
      };
    }
    this.savePersistedSettings();
    this.scheduleNextTick();
    this.broadcast();
    return this.getSnapshot();
  }

  public async updateSshConfig(input: SshConfigUpdateInput): Promise<{
    ok: boolean;
    error?: string;
    snapshot: MonitorSnapshot;
  }> {
    const validation = validateSshConfigInput(input);
    if (!validation.valid) {
      return {
        ok: false,
        error: validation.error,
        snapshot: this.getSnapshot(),
      };
    }

    this.disconnectSshClient();

    this.sshConfig = {
      alias: (input.alias ?? this.sshConfig.alias ?? 'Ubuntu-DL-Node-01').trim(),
      host: input.host.trim(),
      port: Number(input.port ?? 22) || 22,
      username: input.username.trim(),
      authMethod: input.authMethod === 'agent' ? 'agent' : 'privateKeyPath',
      privateKeyPath: (
        input.privateKeyPath ??
        this.sshConfig.privateKeyPath ??
        '~/.ssh/id_ed25519'
      ).trim(),
      passphrase:
        input.passphrase !== undefined
          ? input.passphrase
          : this.sshConfig.passphrase,
      hostKeyPolicy:
        input.hostKeyPolicy === 'pinned_fingerprint'
          ? 'pinned_fingerprint'
          : 'known_hosts',
      pinnedFingerprint: (
        input.pinnedFingerprint ?? this.sshConfig.pinnedFingerprint ?? ''
      ).trim(),
      knownHostsPath: (
        input.knownHostsPath ??
        this.sshConfig.knownHostsPath ??
        '~/.ssh/known_hosts'
      ).trim(),
    };

    // Reset state for the new SSH target
    this.mode = 'ssh';
    this.prevProcStat = null;
    this.trends = [];
    this.lastError = null;
    this.consecutiveFailures = 0;
    this.monitoringStartedAt = Date.now();
    this.connectionState = 'connecting';
    this.savePersistedSettings();
    this.broadcast();

    await this.collectOnce();
    this.scheduleNextTick();

    return {
      ok: true,
      snapshot: this.getSnapshot(),
    };
  }

  private disconnectSshClient(): void {
    if (this.sshClient) {
      try {
        this.sshClient.end();
        this.sshClient.destroy();
      } catch {
        // Ignore cleanup errors
      }
      this.sshClient = null;
      this.sshClientConnected = false;
    }
  }

  private async ensureSshConnection(): Promise<{
    client: SshClient;
    observedFingerprint?: string;
  }> {
    if (this.sshClient && this.sshClientConnected) {
      return { client: this.sshClient };
    }

    this.disconnectSshClient();

    // Check ~/.ssh/config for host alias resolution
    const aliasResolved = resolveSshConfigAlias(this.sshConfig.host);
    const targetHost = aliasResolved.hostName || this.sshConfig.host;
    const targetPort = this.sshConfig.port || aliasResolved.port || 22;
    const targetUser = this.sshConfig.username || aliasResolved.user || 'ubuntu';
    const keyPathToUse =
      this.sshConfig.privateKeyPath ||
      aliasResolved.identityFile ||
      '~/.ssh/id_ed25519';

    let privateKeyBuffer: Buffer | undefined;
    let agentSocket: string | undefined;

    if (this.sshConfig.authMethod === 'agent') {
      agentSocket =
        process.env.SSH_AUTH_SOCK ||
        (process.platform === 'win32'
          ? '\\\\.\\pipe\\openssh-ssh-agent'
          : undefined);
      if (!agentSocket) {
        throw new Error(
          'Private key file not found: 未检测到系统 SSH Agent 环境变量 (SSH_AUTH_SOCK)'
        );
      }
    } else {
      const resolvedKeyPath = expandHomePath(keyPathToUse);
      if (!resolvedKeyPath || !fs.existsSync(resolvedKeyPath)) {
        throw new Error(
          `Private key file not found: 本地私钥文件不存在 (${resolvedKeyPath})`
        );
      }
      try {
        privateKeyBuffer = fs.readFileSync(resolvedKeyPath);
      } catch (readErr) {
        throw new Error(
          `Cannot read private key: 无法读取私钥文件 (${
            readErr instanceof Error ? readErr.message : String(readErr)
          })`
        );
      }
    }

    return new Promise((resolve, reject) => {
      const client = new SshClient();
      let settled = false;
      let observedFingerprint: string | undefined;
      let hostKeyErrorReason: string | undefined;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          client.destroy();
          reject(
            new Error(
              `Connection timed out after ${this.connectTimeoutMs}ms connecting to ${targetHost}:${targetPort}`
            )
          );
        }
      }, this.connectTimeoutMs);

      client.on('ready', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.sshClient = client;
        this.sshClientConnected = true;
        resolve({ client, observedFingerprint });
      });

      client.on('error', (err) => {
        this.sshClientConnected = false;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (hostKeyErrorReason) {
          const wrapped = new Error(hostKeyErrorReason);
          (wrapped as Error & { observedFingerprint?: string }).observedFingerprint =
            observedFingerprint;
          reject(wrapped);
        } else {
          reject(err);
        }
      });

      client.on('close', () => {
        this.sshClientConnected = false;
      });

      client.on('end', () => {
        this.sshClientConnected = false;
      });

      try {
        client.connect({
          host: targetHost,
          port: targetPort,
          username: targetUser,
          privateKey: privateKeyBuffer,
          passphrase: this.sshConfig.passphrase || undefined,
          agent: agentSocket,
          readyTimeout: this.connectTimeoutMs,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          hostHash: undefined,
          hostVerifier: (keyBuffer: Buffer) => {
            const check = verifyServerHostKey({
              host: targetHost,
              port: targetPort,
              keyBuffer,
              policy: this.sshConfig.hostKeyPolicy,
              pinnedFingerprint: this.sshConfig.pinnedFingerprint,
              knownHostsPath: this.sshConfig.knownHostsPath,
            });
            observedFingerprint = check.observedFingerprint;
            if (!check.verified) {
              hostKeyErrorReason = check.reason;
              return false;
            }
            return true;
          },
        });
      } catch (syncErr) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(syncErr);
        }
      }
    });
  }

  private execRemoteCommand(client: SshClient, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.disconnectSshClient();
          reject(
            new Error(
              `Remote monitoring command timed out after ${this.commandTimeoutMs}ms`
            )
          );
        }
      }, this.commandTimeoutMs);

      client.exec(command, (err, stream) => {
        if (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
          return;
        }

        stream.on('data', (chunk: Buffer) => {
          stdout += chunk.toString('utf-8');
        });

        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf-8');
        });

        stream.on('close', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(stdout || stderr);
        });

        stream.on('error', (streamErr: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(streamErr);
        });
      });
    });
  }

  private appendTrendPoint(point: TrendPoint): void {
    const maxPoints = Math.min(
      180,
      Math.max(30, Math.floor((15 * 60 * 1000) / this.pollIntervalMs))
    );
    this.trends = [...this.trends.slice(-(maxPoints - 1)), point];
  }

  public async collectOnce(): Promise<void> {
    if (this.mode === 'sandbox') {
      this.broadcast();
      return;
    }

    if (!this.sshConfig.host || !this.sshConfig.username) {
      this.connectionState = 'unconfigured';
      this.broadcast();
      return;
    }

    if (this.isCollecting) return;
    this.isCollecting = true;

    try {
      this.connectionState = this.sshClientConnected ? 'collecting' : 'connecting';
      this.broadcast();

      const needInitialDelta = this.prevProcStat === null;
      const scriptToRun = needInitialDelta
        ? `echo "<<<SECTION:PROC_STAT_PRE>>>"\nhead -n 1 /proc/stat 2>/dev/null || true\necho "<<<END:PROC_STAT_PRE>>>"\nsleep 0.25\n${REMOTE_PROBE_SCRIPT}`
        : REMOTE_PROBE_SCRIPT;

      let rawOutput = '';

      // Check if target is a ProxyJump host or alias that OpenSSH handles natively
      const aliasTarget = resolveSshConfigAlias(this.sshConfig.host);
      const isNamedAlias = Boolean(this.sshConfig.alias && !/^\d+\.\d+\.\d+\.\d+$/.test(this.sshConfig.alias));

      try {
        const { client } = await this.ensureSshConnection();
        this.connectionState = 'collecting';
        rawOutput = await this.execRemoteCommand(client, scriptToRun);
      } catch (ssh2Err) {
        // Fallback to local OpenSSH CLI (supports ProxyJump, ~/.ssh/config, Windows Named Pipes seamlessly)
        const hostArg = this.sshConfig.alias || this.sshConfig.host;
        rawOutput = await new Promise<string>((resolve, reject) => {
          execFile(
            'ssh',
            ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${Math.round(this.connectTimeoutMs / 1000)}`, hostArg, scriptToRun],
            { maxBuffer: 10 * 1024 * 1024, timeout: this.commandTimeoutMs + 3000 },
            (cliErr, stdout, stderr) => {
              if (cliErr || !stdout) {
                reject(new Error(stderr?.trim() || cliErr?.message || String(ssh2Err)));
              } else {
                resolve(stdout);
              }
            }
          );
        });
      }

      const now = Date.now();

      // 1. Parse META
      const metaBlock = extractSection(rawOutput, 'META');
      const metaLines = metaBlock.split('\n').map((l) => l.trim());
      if (metaLines[0]) this.hostname = metaLines[0];
      if (metaLines[1]) this.osRelease = metaLines[1];
      if (metaLines[2]) {
        const upSec = Number(metaLines[2].split(/\s+/)[0]);
        if (Number.isFinite(upSec) && upSec > 0) {
          this.uptimeSeconds = Math.round(upSec);
        }
      }
      const parsedCores = Number(metaLines[3]);
      const logicalCores =
        Number.isFinite(parsedCores) && parsedCores > 0 ? parsedCores : null;
      const cpuModelName = metaLines[4] ? metaLines[4].trim() : null;

      // 2. Parse CPU (/proc/stat delta + /proc/loadavg)
      if (needInitialDelta) {
        const preStatRaw = extractSection(rawOutput, 'PROC_STAT_PRE');
        const preSample = parseProcStatLine(preStatRaw);
        if (preSample) {
          this.prevProcStat = preSample;
        }
      }

      const currStatRaw = extractSection(rawOutput, 'PROC_STAT');
      const currSample = parseProcStatLine(currStatRaw);
      const cpuUsagePercent = calculateCpuDeltaUsage(this.prevProcStat, currSample);
      if (currSample) {
        this.prevProcStat = currSample;
      }

      const loadAvgRaw = extractSection(rawOutput, 'LOADAVG');
      const loadAvg = parseLoadAvg(loadAvgRaw);
      this.cpu = {
        usagePercent: cpuUsagePercent,
        loadAvg1m: loadAvg?.loadAvg1m ?? 0,
        loadAvg5m: loadAvg?.loadAvg5m ?? 0,
        loadAvg15m: loadAvg?.loadAvg15m ?? 0,
        logicalCores,
        modelName: cpuModelName,
      };

      // 3. Parse Memory (/proc/meminfo with MemAvailable priority)
      const memRaw = extractSection(rawOutput, 'MEMINFO');
      const parsedMem = parseProcMeminfo(memRaw);
      if (parsedMem) {
        this.memory = parsedMem;
      }

      // 4. Parse Disk (df -B1 -P)
      const dfRaw = extractSection(rawOutput, 'DISK_DF');
      const parsedDisks = parseDfOutput(dfRaw);
      if (parsedDisks.length > 0) {
        this.disks = parsedDisks;
      }

      // 5. Parse NVIDIA GPU
      const gpuRaw = extractSection(rawOutput, 'NVIDIA_GPU');
      const parsedGpu = parseNvidiaSmiOutput(gpuRaw);
      this.gpuStatus = parsedGpu.status;
      this.gpuStatusMessage = parsedGpu.message;
      this.gpus = parsedGpu.gpus;

      // 6. Parse GPU + System Processes
      const gpuProcsRaw = extractSection(rawOutput, 'NVIDIA_PROCS');
      const topPsRaw = extractSection(rawOutput, 'TOP_PS');
      this.processes = mergeGpuAndSystemProcesses(
        gpuProcsRaw,
        topPsRaw,
        this.gpus
      );

      // 7. Record real trend point
      const gpuUtilAvg =
        this.gpus.length > 0
          ? Math.round(
              (this.gpus.reduce(
                (acc, g) => acc + (g.utilizationGpuPercent ?? 0),
                0
              ) /
                this.gpus.length) *
                10
            ) / 10
          : null;
      const gpuMemMax =
        this.gpus.length > 0
          ? Math.max(...this.gpus.map((g) => g.memoryUtilPercent ?? 0))
          : null;

      this.appendTrendPoint({
        timestamp: now,
        gpuUtilPercent: gpuUtilAvg,
        gpuMemPercent: gpuMemMax,
        cpuUtilPercent: this.cpu.usagePercent,
        memUtilPercent: this.memory?.usagePercent ?? null,
        status: 'ok',
      });

      this.lastUpdatedAt = now;
      this.lastError = null;
      this.consecutiveFailures = 0;
      this.connectionState = 'connected';
    } catch (err) {
      this.consecutiveFailures += 1;
      const observedFp = (err as Error & { observedFingerprint?: string })
        ?.observedFingerprint;
      this.lastError = classifySshError(err, observedFp);
      this.connectionState =
        this.lastError.code === 'NETWORK_UNREACHABLE' ? 'offline' : 'error';

      this.appendTrendPoint({
        timestamp: Date.now(),
        gpuUtilPercent: null,
        gpuMemPercent: null,
        cpuUtilPercent: null,
        memUtilPercent: null,
        status: 'gap',
      });
    } finally {
      this.isCollecting = false;
      this.pollClusterSummariesAsync();
      this.broadcast();
    }
  }
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT ?? 3000) || 3000;
  const collector = new MonitorCollector();

  app.use(express.json({ limit: '64kb' }));

  // Get current snapshot
  app.get('/api/snapshot', (_req: Request, res: Response) => {
    res.json(collector.getSnapshot());
  });

  // Server-Sent Events real-time stream
  app.get('/api/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    collector.addSubscriber(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      collector.removeSubscriber(res);
    });
  });

  // Manual immediate refresh / retry
  app.post('/api/retry', async (_req: Request, res: Response) => {
    const snap = await collector.triggerImmediateRefresh();
    res.json(snap);
  });

  // Switch between Real SSH mode and Isolated Demo Sandbox mode
  app.post('/api/mode', (req: Request, res: Response) => {
    const { mode, scenario } = req.body as {
      mode?: 'ssh' | 'sandbox';
      scenario?: SandboxScenario;
    };
    const targetMode = mode === 'sandbox' ? 'sandbox' : 'ssh';
    const snap = collector.setMode(targetMode, scenario);
    res.json(snap);
  });

  // Update polling interval & status thresholds
  app.post('/api/settings', (req: Request, res: Response) => {
    const { pollIntervalMs, thresholds } = req.body as {
      pollIntervalMs?: number;
      thresholds?: Partial<LoadThresholds>;
    };
    const snap = collector.updateSettings({ pollIntervalMs, thresholds });
    res.json(snap);
  });

  // Update SSH connection config (never returns private key or passphrase)
  app.post('/api/ssh-config', async (req: Request, res: Response) => {
    const input = req.body as SshConfigUpdateInput;
    const result = await collector.updateSshConfig(input);
    if (!result.ok) {
      res.status(400).json({ error: result.error, snapshot: result.snapshot });
      return;
    }
    res.json(result.snapshot);
  });

  // Switch target server to another host alias from ~/.ssh/config
  app.post('/api/switch-server', async (req: Request, res: Response) => {
    const { alias } = req.body as { alias?: string };
    if (!alias) {
      res.status(400).json({ error: '缺少主机别名 (alias)' });
      return;
    }
    const profiles = listSshConfigProfiles();
    let target = profiles.find((p) => p.alias === alias || p.hostName === alias);
    if (!target) {
      // 兼容按组名切换，如切换到 LAB5 时，在 profiles 中寻找 LAB5 或 LAB5-wuheng 等前缀匹配项
      target = profiles.find((p) => p.alias.toLowerCase().startsWith(alias.toLowerCase() + '-') || p.alias.toLowerCase() === alias.toLowerCase());
    }
    if (!target) {
      res.status(404).json({ error: `未在 ~/.ssh/config 中找到节点 ${alias}` });
      return;
    }

    const result = await collector.updateSshConfig({
      alias: target.alias,
      host: target.alias,
      port: target.port || 22,
      username: target.user || 'ubuntu',
      authMethod: 'privateKeyPath',
      privateKeyPath: target.identityFile || '~/.ssh/id_ed25519',
      hostKeyPolicy: 'known_hosts',
    });
    res.json(result.snapshot);
  });

  // List all host profiles parsed from local ~/.ssh/config (deduped and sorted LAB1-LAB9 first)
  app.get('/api/ssh-profiles', (_req: Request, res: Response) => {
    res.json(getDedupedSshProfiles());
  });

  collector.start();

  const distPath = path.resolve(__dirname, 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[PulseSSH] Server listening on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('[PulseSSH] Fatal startup error:', err);
  process.exit(1);
});
