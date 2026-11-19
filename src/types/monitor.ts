export type ConnectionState =
  | 'unconfigured'
  | 'connecting'
  | 'connected'
  | 'collecting'
  | 'error'
  | 'stale'
  | 'offline';

export type ServerLoadVerdict = 'idle' | 'light' | 'busy' | 'error';

export type SandboxScenario =
  | 'idle'
  | 'vram_occupied'
  | 'busy_training'
  | 'no_gpu'
  | 'ssh_error';

export type GpuCollectionStatus =
  | 'available'
  | 'no_gpu'
  | 'no_command'
  | 'permission_denied'
  | 'parse_error';

export interface LoadThresholds {
  gpuIdleMaxPercent: number;
  gpuBusyMinPercent: number;
  vramBusyMinPercent: number;
  cpuIdleMaxPercent: number;
  cpuBusyMinPercent: number;
  memBusyMinPercent: number;
  smoothingWindowSamples: number;
}

export interface GpuDeviceMetrics {
  index: number;
  uuid: string;
  name: string;
  utilizationGpuPercent: number | null;
  memoryTotalMiB: number | null;
  memoryUsedMiB: number | null;
  memoryFreeMiB: number | null;
  memoryUtilPercent: number | null;
  temperatureC: number | null;
  powerDrawW: number | null;
  powerLimitW: number | null;
}

export interface CpuMetrics {
  usagePercent: number | null;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  logicalCores: number | null;
  modelName: string | null;
}

export interface MemoryMetrics {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface DiskMountMetrics {
  filesystem: string;
  mountPoint: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface ActiveProcessItem {
  pid: number;
  user: string;
  processName: string;
  command: string;
  gpuIndex: number | null;
  gpuMemoryMiB: number | null;
  cpuPercent: number | null;
  memPercent: number | null;
  elapsedTime: string | null;
  source: 'gpu' | 'cpu';
}

export interface TrendPoint {
  timestamp: number;
  gpuUtilPercent: number | null;
  gpuMemPercent: number | null;
  cpuUtilPercent: number | null;
  memUtilPercent: number | null;
  status: 'ok' | 'gap';
}

export type MonitorErrorCode =
  | 'AUTH_FAILED'
  | 'PRIVATE_KEY_ERROR'
  | 'HOST_KEY_MISMATCH'
  | 'HOST_KEY_UNVERIFIED'
  | 'NETWORK_UNREACHABLE'
  | 'COMMAND_TIMEOUT'
  | 'PARSE_ERROR'
  | 'SSH_CONFIG_INVALID'
  | 'UNKNOWN';

export interface MonitorErrorInfo {
  code: MonitorErrorCode;
  title: string;
  message: string;
  remediation: string;
  timestamp: number;
  observedFingerprint?: string;
}

export interface SshSafeConfigSummary {
  alias: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'privateKeyPath' | 'agent';
  privateKeyPathHint: string;
  hasPassphrase: boolean;
  hostKeyPolicy: 'known_hosts' | 'pinned_fingerprint';
  pinnedFingerprint: string;
  knownHostsPath: string;
  configured: boolean;
}

export interface SshConfigUpdateInput {
  alias?: string;
  host: string;
  port?: number;
  username: string;
  authMethod?: 'privateKeyPath' | 'agent';
  privateKeyPath?: string;
  passphrase?: string;
  hostKeyPolicy?: 'known_hosts' | 'pinned_fingerprint';
  pinnedFingerprint?: string;
  knownHostsPath?: string;
}

export interface ClusterServerSummary {
  serverId: string;
  serverAlias: string;
  host: string;
  connectionState: ConnectionState;
  verdict: ServerLoadVerdict;
  verdictLabel: '空闲' | '轻载' | '繁忙' | '连接异常';
  gpuCount: number;
  idleGpuCount?: number;
  gpuSummaryText: string;
  maxGpuUtil: number | null;
  maxVramUtil: number | null;
  lastUpdatedAt: number | null;
  error?: string | null;
}

export interface MonitorSnapshot {
  serverId: string;
  serverAlias: string;
  host: string;
  mode: 'ssh' | 'sandbox';
  clusterNodes?: ClusterServerSummary[];
  sandboxScenario?: SandboxScenario;
  connectionState: ConnectionState;
  verdict: ServerLoadVerdict;
  verdictLabel: '空闲' | '轻载' | '繁忙' | '连接异常';
  verdictReason: string;
  verdictAdvisory: string;
  computeVsVramNote: string | null;
  lastUpdatedAt: number | null;
  monitoringStartedAt: number | null;
  uptimeSeconds: number | null;
  hostname: string | null;
  osRelease: string | null;
  gpuStatus: GpuCollectionStatus;
  gpuStatusMessage: string | null;
  gpus: GpuDeviceMetrics[];
  cpu: CpuMetrics | null;
  memory: MemoryMetrics | null;
  disks: DiskMountMetrics[];
  processes: ActiveProcessItem[];
  trends: TrendPoint[];
  pollIntervalMs: number;
  thresholds: LoadThresholds;
  lastError: MonitorErrorInfo | null;
  sshConfig: SshSafeConfigSummary;
  consecutiveFailures: number;
}
