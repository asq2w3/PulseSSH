import {
  ActiveProcessItem,
  ConnectionState,
  CpuMetrics,
  DiskMountMetrics,
  GpuCollectionStatus,
  GpuDeviceMetrics,
  LoadThresholds,
  MemoryMetrics,
  MonitorErrorInfo,
  ServerLoadVerdict,
  SshConfigUpdateInput,
  TrendPoint,
} from '../types/monitor';

export const DEFAULT_THRESHOLDS: LoadThresholds = {
  gpuIdleMaxPercent: 15,
  gpuBusyMinPercent: 55,
  vramBusyMinPercent: 80,
  cpuIdleMaxPercent: 25,
  cpuBusyMinPercent: 75,
  memBusyMinPercent: 85,
  smoothingWindowSamples: 3,
};

/**
 * Fixed, static, read-only Linux probe script.
 * Zero user-supplied strings are interpolated into this script.
 */
export const REMOTE_PROBE_SCRIPT = [
  'export LC_ALL=C LANG=C',
  'echo "<<<SECTION:META>>>"',
  'hostname 2>/dev/null || cat /proc/sys/kernel/hostname 2>/dev/null || echo "unknown-host"',
  ' (grep -m1 "^PRETTY_NAME=" /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d \'"\') || uname -sr 2>/dev/null || echo "Linux"',
  'cat /proc/uptime 2>/dev/null || echo "0 0"',
  'nproc 2>/dev/null || grep -c "^processor" /proc/cpuinfo 2>/dev/null || echo "0"',
  ' (grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2-) || echo ""',
  'echo "<<<END:META>>>"',
  'echo "<<<SECTION:PROC_STAT>>>"',
  'head -n 1 /proc/stat 2>/dev/null || true',
  'echo "<<<END:PROC_STAT>>>"',
  'echo "<<<SECTION:LOADAVG>>>"',
  'cat /proc/loadavg 2>/dev/null || true',
  'echo "<<<END:LOADAVG>>>"',
  'echo "<<<SECTION:MEMINFO>>>"',
  'cat /proc/meminfo 2>/dev/null || true',
  'echo "<<<END:MEMINFO>>>"',
  'echo "<<<SECTION:DISK_DF>>>"',
  'df -B1 -P -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs 2>/dev/null || df -B1 -P 2>/dev/null || true',
  'echo "<<<END:DISK_DF>>>"',
  'echo "<<<SECTION:NVIDIA_GPU>>>"',
  'if command -v nvidia-smi >/dev/null 2>&1; then',
  '  nvidia-smi --query-gpu=index,uuid,name,utilization.gpu,memory.total,memory.used,memory.free,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits 2>&1 || true',
  'else',
  '  echo "__NO_NVIDIA_SMI__"',
  'fi',
  'echo "<<<END:NVIDIA_GPU>>>"',
  'echo "<<<SECTION:NVIDIA_PROCS>>>"',
  'if command -v nvidia-smi >/dev/null 2>&1; then',
  '  nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory --format=csv,noheader,nounits 2>&1 || true',
  'fi',
  'echo "<<<END:NVIDIA_PROCS>>>"',
  'echo "<<<SECTION:TOP_PS>>>"',
  'ps -eo pid=,user:32=,pcpu=,pmem=,etime=,comm=,args= --sort=-pcpu 2>/dev/null | head -n 30 || true',
  'echo "<<<END:TOP_PS>>>"',
].join('\n');

export interface ProcStatSample {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
  total: number;
  idleAll: number;
}

export function extractSection(rawOutput: string, sectionName: string): string {
  const startMarker = `<<<SECTION:${sectionName}>>>`;
  const endMarker = `<<<END:${sectionName}>>>`;
  const startIdx = rawOutput.indexOf(startMarker);
  if (startIdx === -1) return '';
  const contentStart = startIdx + startMarker.length;
  const endIdx = rawOutput.indexOf(endMarker, contentStart);
  if (endIdx === -1) return rawOutput.slice(contentStart).trim();
  return rawOutput.slice(contentStart, endIdx).trim();
}

/**
 * Parses the aggregate `cpu ...` line from `/proc/stat`.
 * Note: Raw values in `/proc/stat` are cumulative jiffies since boot and MUST NOT
 * be used directly as instantaneous CPU utilization.
 */
export function parseProcStatLine(rawLine: string): ProcStatSample | null {
  const line = rawLine
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('cpu '));
  if (!line) return null;

  const parts = line.split(/\s+/).slice(1).map((n) => Number(n));
  if (parts.length < 4 || parts.some((n) => Number.isNaN(n) || n < 0)) {
    return null;
  }

  const user = parts[0] ?? 0;
  const nice = parts[1] ?? 0;
  const system = parts[2] ?? 0;
  const idle = parts[3] ?? 0;
  const iowait = parts[4] ?? 0;
  const irq = parts[5] ?? 0;
  const softirq = parts[6] ?? 0;
  const steal = parts[7] ?? 0;

  const idleAll = idle + iowait;
  const nonIdle = user + nice + system + irq + softirq + steal;
  const total = idleAll + nonIdle;

  if (total <= 0) return null;

  return {
    user,
    nice,
    system,
    idle,
    iowait,
    irq,
    softirq,
    steal,
    total,
    idleAll,
  };
}

/**
 * Computes CPU usage percentage between two `/proc/stat` samples separated in time.
 */
export function calculateCpuDeltaUsage(
  prev: ProcStatSample | null,
  curr: ProcStatSample | null
): number | null {
  if (!prev || !curr) return null;
  const totalDelta = curr.total - prev.total;
  const idleDelta = curr.idleAll - prev.idleAll;
  if (totalDelta <= 0) return null;

  const busyDelta = Math.max(0, totalDelta - idleDelta);
  const rawPercent = (busyDelta / totalDelta) * 100;
  const clamped = Math.min(100, Math.max(0, rawPercent));
  return Math.round(clamped * 10) / 10;
}

export function parseLoadAvg(rawLoadAvg: string): {
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
} | null {
  const trimmed = rawLoadAvg.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) return null;
  const loadAvg1m = Number(parts[0]);
  const loadAvg5m = Number(parts[1]);
  const loadAvg15m = Number(parts[2]);
  if ([loadAvg1m, loadAvg5m, loadAvg15m].some((v) => Number.isNaN(v))) {
    return null;
  }
  return {
    loadAvg1m: Math.round(loadAvg1m * 100) / 100,
    loadAvg5m: Math.round(loadAvg5m * 100) / 100,
    loadAvg15m: Math.round(loadAvg15m * 100) / 100,
  };
}

/**
 * Parses `/proc/meminfo` and prioritizes `MemAvailable` over `MemFree` so that
 * reclaimable page cache and buffers are not misreported as unavailable memory.
 */
export function parseProcMeminfo(rawMeminfo: string): MemoryMetrics | null {
  if (!rawMeminfo || !rawMeminfo.trim()) return null;
  const map = new Map<string, number>();

  for (const line of rawMeminfo.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_()]+):\s+(\d+)/);
    if (match) {
      map.set(match[1], Number(match[2]) * 1024); // kB -> Bytes
    }
  }

  const totalBytes = map.get('MemTotal') ?? 0;
  if (totalBytes <= 0) return null;

  let availableBytes = map.get('MemAvailable');
  if (availableBytes === undefined) {
    const memFree = map.get('MemFree') ?? 0;
    const buffers = map.get('Buffers') ?? 0;
    const cached = map.get('Cached') ?? 0;
    const sReclaimable = map.get('SReclaimable') ?? 0;
    availableBytes = memFree + buffers + cached + sReclaimable;
  }

  availableBytes = Math.min(totalBytes, Math.max(0, availableBytes));
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const usagePercent = Math.round((usedBytes / totalBytes) * 1000) / 10;

  const swapTotalBytes = map.get('SwapTotal') ?? 0;
  const swapFreeBytes = map.get('SwapFree') ?? 0;
  const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);

  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usagePercent,
    swapTotalBytes,
    swapUsedBytes,
  };
}

const IGNORED_MOUNT_PREFIXES = [
  '/proc',
  '/sys',
  '/dev',
  '/run',
  '/snap/',
  '/var/lib/docker/overlay2',
  '/boot/efi',
];

export function parseDfOutput(rawDf: string): DiskMountMetrics[] {
  if (!rawDf || !rawDf.trim()) return [];
  const lines = rawDf
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results: DiskMountMetrics[] = [];
  const seenMounts = new Set<string>();

  for (const line of lines) {
    if (line.startsWith('Filesystem') || line.startsWith('文件系统')) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const filesystem = parts[0];
    const totalBytes = Number(parts[1]);
    const usedBytes = Number(parts[2]);
    const availableBytes = Number(parts[3]);
    const mountPoint = parts.slice(5).join(' ');

    if (
      !mountPoint.startsWith('/') ||
      Number.isNaN(totalBytes) ||
      totalBytes <= 0 ||
      Number.isNaN(usedBytes) ||
      Number.isNaN(availableBytes)
    ) {
      continue;
    }

    if (
      filesystem === 'tmpfs' ||
      filesystem === 'devtmpfs' ||
      filesystem === 'overlay' ||
      filesystem === 'squashfs' ||
      filesystem === 'none'
    ) {
      continue;
    }

    if (IGNORED_MOUNT_PREFIXES.some((prefix) => mountPoint === prefix || mountPoint.startsWith(prefix))) {
      continue;
    }

    if (seenMounts.has(mountPoint)) continue;
    seenMounts.add(mountPoint);

    const denom = usedBytes + availableBytes > 0 ? usedBytes + availableBytes : totalBytes;
    const usagePercent = Math.min(100, Math.max(0, Math.round((usedBytes / denom) * 1000) / 10));

    results.push({
      filesystem,
      mountPoint,
      totalBytes,
      usedBytes,
      availableBytes,
      usagePercent,
    });
  }

  return results.sort((a, b) => {
    if (a.mountPoint === '/') return -1;
    if (b.mountPoint === '/') return 1;
    return b.totalBytes - a.totalBytes;
  });
}

function parseOptionalNumber(val: string | undefined): number | null {
  if (!val) return null;
  const cleaned = val.trim();
  if (
    !cleaned ||
    cleaned === 'N/A' ||
    cleaned.includes('Not Supported') ||
    cleaned.includes('[N/A]') ||
    cleaned.includes('Unknown')
  ) {
    return null;
  }
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export interface ParsedGpuResult {
  status: GpuCollectionStatus;
  message: string | null;
  gpus: GpuDeviceMetrics[];
}

export function parseNvidiaSmiOutput(rawGpuOutput: string): ParsedGpuResult {
  const trimmed = rawGpuOutput.trim();

  if (!trimmed || trimmed.includes('__NO_NVIDIA_SMI__')) {
    return {
      status: 'no_command',
      message: '未检测到 nvidia-smi 命令（远程服务器可能未安装 NVIDIA 驱动或未配置 GPU）',
      gpus: [],
    };
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('permission denied') ||
    lower.includes('insufficient permissions') ||
    lower.includes('failed to initialize nvml: insufficient permissions')
  ) {
    return {
      status: 'permission_denied',
      message: '当前 SSH 用户无权限访问 NVIDIA GPU 指标（NVML Insufficient Permissions）',
      gpus: [],
    };
  }

  if (
    lower.includes('no devices were found') ||
    lower.includes("couldn't communicate with the nvidia driver") ||
    lower.includes('failed to initialize nvml') ||
    lower.includes('nvidia-smi has failed')
  ) {
    return {
      status: 'no_gpu',
      message: '未检测到可用 NVIDIA GPU 或内核驱动尚未就绪',
      gpus: [],
    };
  }

  const gpus: GpuDeviceMetrics[] = [];
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 7) continue;

    const index = parseOptionalNumber(cols[0]);
    const uuid = cols[1] || `GPU-${index ?? gpus.length}`;
    const name = cols[2] || 'NVIDIA GPU';
    if (index === null || !name) continue;

    const utilizationGpuPercent = parseOptionalNumber(cols[3]);
    const memoryTotalMiB = parseOptionalNumber(cols[4]);
    const memoryUsedMiB = parseOptionalNumber(cols[5]);
    const memoryFreeMiB =
      parseOptionalNumber(cols[6]) ??
      (memoryTotalMiB !== null && memoryUsedMiB !== null
        ? Math.max(0, memoryTotalMiB - memoryUsedMiB)
        : null);
    const temperatureC = parseOptionalNumber(cols[7]);
    const powerDrawW = parseOptionalNumber(cols[8]);
    const powerLimitW = parseOptionalNumber(cols[9]);

    const memoryUtilPercent =
      memoryTotalMiB !== null && memoryTotalMiB > 0 && memoryUsedMiB !== null
        ? Math.min(100, Math.max(0, Math.round((memoryUsedMiB / memoryTotalMiB) * 1000) / 10))
        : null;

    gpus.push({
      index,
      uuid,
      name,
      utilizationGpuPercent,
      memoryTotalMiB,
      memoryUsedMiB,
      memoryFreeMiB,
      memoryUtilPercent,
      temperatureC,
      powerDrawW,
      powerLimitW,
    });
  }

  if (gpus.length === 0) {
    return {
      status: 'parse_error',
      message: '无法解析 nvidia-smi 输出格式',
      gpus: [],
    };
  }

  return {
    status: 'available',
    message: null,
    gpus: gpus.sort((a, b) => a.index - b.index),
  };
}

export function mergeGpuAndSystemProcesses(
  rawNvidiaProcs: string,
  rawTopPs: string,
  gpus: GpuDeviceMetrics[]
): ActiveProcessItem[] {
  const uuidToIndex = new Map<string, number>();
  for (const gpu of gpus) {
    uuidToIndex.set(gpu.uuid, gpu.index);
  }

  interface PsRow {
    pid: number;
    user: string;
    cpuPercent: number | null;
    memPercent: number | null;
    elapsedTime: string | null;
    comm: string;
    command: string;
  }

  const psMap = new Map<number, PsRow>();
  const psRows: PsRow[] = [];

  for (const rawLine of rawTopPs.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Format: pid user pcpu pmem etime comm args...
    const match = line.match(
      /^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s*(.*)$/
    );
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const user = match[2];
    const cpuPercent = parseOptionalNumber(match[3]);
    const memPercent = parseOptionalNumber(match[4]);
    const elapsedTime = match[5] || null;
    const comm = match[6] || 'process';
    const args = (match[7] || comm).trim();

    if (comm === 'ps' || args.includes('--query-gpu=')) continue;

    const row: PsRow = {
      pid,
      user,
      cpuPercent,
      memPercent,
      elapsedTime,
      comm,
      command: args,
    };
    psMap.set(pid, row);
    psRows.push(row);
  }

  const results: ActiveProcessItem[] = [];
  const gpuPidSet = new Set<number>();

  for (const rawLine of rawNvidiaProcs.split('\n')) {
    const line = rawLine.trim();
    if (
      !line ||
      line.toLowerCase().includes('no running processes') ||
      line.toLowerCase().includes('not supported') ||
      line.toLowerCase().includes('error')
    ) {
      continue;
    }
    const cols = line.split(',').map((c) => c.trim());
    if (cols.length < 3) continue;

    const gpuUuid = cols[0];
    const pid = parseOptionalNumber(cols[1]);
    if (pid === null || pid <= 0) continue;

    const rawProcName = cols[2] || 'gpu-process';
    const shortName = rawProcName.split('/').pop() || rawProcName;
    const gpuMemoryMiB = parseOptionalNumber(cols[3]);
    const gpuIndex = uuidToIndex.get(gpuUuid) ?? (gpus.length === 1 ? gpus[0].index : 0);

    const psInfo = psMap.get(pid);
    gpuPidSet.add(pid);

    results.push({
      pid,
      user: psInfo?.user ?? '—',
      processName: shortName,
      command: psInfo?.command ?? rawProcName,
      gpuIndex,
      gpuMemoryMiB,
      cpuPercent: psInfo?.cpuPercent ?? null,
      memPercent: psInfo?.memPercent ?? null,
      elapsedTime: psInfo?.elapsedTime ?? null,
      source: 'gpu',
    });
  }

  // Sort GPU processes by VRAM usage descending
  results.sort((a, b) => (b.gpuMemoryMiB ?? 0) - (a.gpuMemoryMiB ?? 0));

  // Append top non-GPU system processes that have meaningful CPU or Memory usage
  for (const ps of psRows) {
    if (gpuPidSet.has(ps.pid)) continue;
    if ((ps.cpuPercent ?? 0) < 0.5 && (ps.memPercent ?? 0) < 1.0) continue;
    results.push({
      pid: ps.pid,
      user: ps.user,
      processName: ps.comm,
      command: ps.command,
      gpuIndex: null,
      gpuMemoryMiB: null,
      cpuPercent: ps.cpuPercent,
      memPercent: ps.memPercent,
      elapsedTime: ps.elapsedTime,
      source: 'cpu',
    });
    if (results.length >= 20) break;
  }

  return results;
}

export interface VerdictEvaluationInput {
  connectionState: ConnectionState;
  gpus: GpuDeviceMetrics[];
  cpu: CpuMetrics | null;
  memory: MemoryMetrics | null;
  recentTrends: TrendPoint[];
  thresholds: LoadThresholds;
  previousVerdict?: ServerLoadVerdict;
}

export interface VerdictEvaluationOutput {
  verdict: ServerLoadVerdict;
  verdictLabel: '空闲' | '轻载' | '繁忙' | '连接异常';
  verdictReason: string;
  verdictAdvisory: string;
  computeVsVramNote: string | null;
}

function averageNonNull(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}

/**
 * Evaluates overall server load status ("空闲" | "轻载" | "繁忙" | "连接异常")
 * combining recent trend window smoothing, hysteresis (to prevent rapid oscillation
 * near threshold boundaries), and explicit separation of GPU compute vs. VRAM occupancy.
 */
export function evaluateServerVerdict(input: VerdictEvaluationInput): VerdictEvaluationOutput {
  const {
    connectionState,
    gpus,
    cpu,
    memory,
    recentTrends,
    thresholds,
    previousVerdict,
  } = input;

  const advisory =
    '注：空闲度评估基于近期采样均值与资源水位；实际能否启动新训练还取决于模型参数规模、Batch Size、DataLoader 并发及共享存储 I/O。';

  if (
    connectionState === 'error' ||
    connectionState === 'offline' ||
    connectionState === 'unconfigured'
  ) {
    return {
      verdict: 'error',
      verdictLabel: '连接异常',
      verdictReason:
        connectionState === 'unconfigured'
          ? '尚未配置远程 SSH 服务器连接信息'
          : '无法与远程服务器保持实时采集连接，当前无法确认实时负载',
      verdictAdvisory: advisory,
      computeVsVramNote: null,
    };
  }

  const windowSize = Math.max(1, Math.min(10, thresholds.smoothingWindowSamples || 3));
  const validTrendSlice = recentTrends
    .filter((t) => t.status === 'ok')
    .slice(-windowSize);

  const currentGpuAvg = averageNonNull(gpus.map((g) => g.utilizationGpuPercent));
  const currentGpuMax =
    gpus.length > 0
      ? Math.max(...gpus.map((g) => g.utilizationGpuPercent ?? 0))
      : null;
  const currentVramMax =
    gpus.length > 0
      ? Math.max(...gpus.map((g) => g.memoryUtilPercent ?? 0))
      : null;

  const smoothedGpu =
    averageNonNull([
      ...validTrendSlice.map((t) => t.gpuUtilPercent),
      currentGpuAvg,
    ]) ?? currentGpuAvg;

  const smoothedVram =
    averageNonNull([
      ...validTrendSlice.map((t) => t.gpuMemPercent),
      currentVramMax,
    ]) ?? currentVramMax;

  const smoothedCpu =
    averageNonNull([
      ...validTrendSlice.map((t) => t.cpuUtilPercent),
      cpu?.usagePercent ?? null,
    ]) ??
    cpu?.usagePercent ??
    null;

  const memUsage = memory?.usagePercent ?? null;

  // Hysteresis margin (3%) prevents flickering when metrics hover around thresholds
  const hysteresis = 3;
  const effectiveGpuBusyMin =
    previousVerdict === 'busy'
      ? Math.max(5, thresholds.gpuBusyMinPercent - hysteresis)
      : thresholds.gpuBusyMinPercent;
  const effectiveGpuIdleMax =
    previousVerdict === 'light' || previousVerdict === 'busy'
      ? Math.max(0, thresholds.gpuIdleMaxPercent - hysteresis)
      : thresholds.gpuIdleMaxPercent;

  const effectiveCpuBusyMin =
    previousVerdict === 'busy'
      ? Math.max(10, thresholds.cpuBusyMinPercent - hysteresis)
      : thresholds.cpuBusyMinPercent;
  const effectiveCpuIdleMax =
    previousVerdict === 'light' || previousVerdict === 'busy'
      ? Math.max(0, thresholds.cpuIdleMaxPercent - hysteresis)
      : thresholds.cpuIdleMaxPercent;

  // Check if GPU compute and VRAM occupancy diverge significantly
  let computeVsVramNote: string | null = null;
  if (gpus.length > 0 && smoothedGpu !== null && currentVramMax !== null) {
    if (smoothedGpu <= thresholds.gpuIdleMaxPercent && currentVramMax >= 30) {
      const topVramGpu = [...gpus].sort(
        (a, b) => (b.memoryUtilPercent ?? 0) - (a.memoryUtilPercent ?? 0)
      )[0];
      const usedGb = ((topVramGpu.memoryUsedMiB ?? 0) / 1024).toFixed(1);
      const totalGb = ((topVramGpu.memoryTotalMiB ?? 0) / 1024).toFixed(1);
      computeVsVramNote = `GPU 计算核心利用率低 (${smoothedGpu.toFixed(0)}%)，但 GPU ${topVramGpu.index} 显存已占用 ${usedGb} / ${totalGb} GB (${currentVramMax.toFixed(1)}%)。通常表示存在驻留权重、调试会话或排队暂停进程。`;
    } else if (smoothedGpu >= thresholds.gpuBusyMinPercent && currentVramMax < 35) {
      computeVsVramNote = `GPU 计算核心高负载 (${smoothedGpu.toFixed(0)}%)，但显存占用较低 (${currentVramMax.toFixed(1)}%)，当前主要为计算密集型小显存任务。`;
    }
  }

  // Busy conditions
  const reasonsBusy: string[] = [];
  if (smoothedGpu !== null && (smoothedGpu >= effectiveGpuBusyMin || (currentGpuMax ?? 0) >= thresholds.gpuBusyMinPercent + 10)) {
    reasonsBusy.push(`近期 GPU 平均计算利用率 ${smoothedGpu.toFixed(1)}%`);
  }
  if (smoothedVram !== null && smoothedVram >= thresholds.vramBusyMinPercent) {
    reasonsBusy.push(`GPU 显存占用率达 ${smoothedVram.toFixed(1)}%（高于阈值 ${thresholds.vramBusyMinPercent}%）`);
  }
  if (smoothedCpu !== null && smoothedCpu >= effectiveCpuBusyMin) {
    reasonsBusy.push(`CPU 近期平均利用率 ${smoothedCpu.toFixed(1)}%`);
  }
  if (memUsage !== null && memUsage >= thresholds.memBusyMinPercent) {
    reasonsBusy.push(`系统内存使用率 ${memUsage.toFixed(1)}%`);
  }

  if (reasonsBusy.length > 0) {
    return {
      verdict: 'busy',
      verdictLabel: '繁忙',
      verdictReason: `高负载运行中：${reasonsBusy.join(' · ')}`,
      verdictAdvisory: advisory,
      computeVsVramNote,
    };
  }

  // Light load conditions (including high VRAM occupancy even when GPU compute is idle!)
  const reasonsLight: string[] = [];
  if (smoothedGpu !== null && smoothedGpu > effectiveGpuIdleMax) {
    reasonsLight.push(`近期 GPU 计算利用率 ${smoothedGpu.toFixed(1)}%`);
  }
  if (currentVramMax !== null && currentVramMax >= 35) {
    reasonsLight.push(`显存已占用 ${currentVramMax.toFixed(1)}%`);
  }
  if (smoothedCpu !== null && smoothedCpu > effectiveCpuIdleMax) {
    reasonsLight.push(`CPU 利用率 ${smoothedCpu.toFixed(1)}%`);
  }
  if (memUsage !== null && memUsage >= 70) {
    reasonsLight.push(`系统内存占用 ${memUsage.toFixed(1)}%`);
  }

  if (reasonsLight.length > 0) {
    return {
      verdict: 'light',
      verdictLabel: '轻载',
      verdictReason: `部分资源占用：${reasonsLight.join(' · ')}`,
      verdictAdvisory: advisory,
      computeVsVramNote,
    };
  }

  const summaryParts: string[] = [];
  if (smoothedGpu !== null) summaryParts.push(`GPU 计算 ${smoothedGpu.toFixed(1)}%`);
  if (currentVramMax !== null) summaryParts.push(`显存 ${currentVramMax.toFixed(1)}%`);
  if (smoothedCpu !== null) summaryParts.push(`CPU ${smoothedCpu.toFixed(1)}%`);
  if (memUsage !== null) summaryParts.push(`内存 ${memUsage.toFixed(1)}%`);

  return {
    verdict: 'idle',
    verdictLabel: '空闲',
    verdictReason:
      summaryParts.length > 0
        ? `核心计算与存储资源充裕（${summaryParts.join(' · ')}）`
        : '远程服务器各项指标处于低水位空闲区间',
    verdictAdvisory: advisory,
    computeVsVramNote,
  };
}

/**
 * Validates SSH connection configuration parameters to prevent command injection
 * or invalid socket parameters.
 */
export function validateSshConfigInput(input: SshConfigUpdateInput): {
  valid: boolean;
  error?: string;
} {
  const host = (input.host ?? '').trim();
  const username = (input.username ?? '').trim();
  const port = input.port ?? 22;

  if (!host) {
    return { valid: false, error: 'SSH 主机地址不能为空' };
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(host) || host.startsWith('-')) {
    return {
      valid: false,
      error: 'SSH 主机地址包含非法字符（仅允许域名、IPv4/IPv6 或主机别名）',
    };
  }
  if (!username) {
    return { valid: false, error: 'SSH 用户名不能为空' };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username) || username.startsWith('-')) {
    return {
      valid: false,
      error: 'SSH 用户名格式不合法',
    };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return {
      valid: false,
      error: 'SSH 端口必须是 1 到 65535 之间的整数',
    };
  }
  if (input.privateKeyPath && /[\0\r\n;|`$&<>]/.test(input.privateKeyPath)) {
    return {
      valid: false,
      error: '私钥路径包含不允许的控制字符',
    };
  }
  if (
    input.pinnedFingerprint &&
    input.pinnedFingerprint.trim() !== '' &&
    !/^(SHA256:)?[A-Za-z0-9+/=]{32,64}$/.test(input.pinnedFingerprint.trim())
  ) {
    return {
      valid: false,
      error: '主机密钥指纹格式不合法，应为 SHA256:Base64 格式',
    };
  }

  return { valid: true };
}

export function classifySshError(err: unknown, observedFingerprint?: string): MonitorErrorInfo {
  const now = Date.now();
  const rawMsg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const lower = rawMsg.toLowerCase();

  if (lower.includes('host_key_mismatch') || lower.includes('host key mismatch')) {
    return {
      code: 'HOST_KEY_MISMATCH',
      title: 'SSH 主机密钥指纹不匹配（已拒绝连接）',
      message: rawMsg,
      remediation:
        '远程服务器返回的公钥指纹与本地 known_hosts 或配置的固定指纹不一致。请核实服务器是否重装或存在中间人风险，确认无误后更新 known_hosts 或固定指纹。',
      timestamp: now,
      observedFingerprint,
    };
  }

  if (lower.includes('host_key_unverified') || lower.includes('not found in known_hosts')) {
    return {
      code: 'HOST_KEY_UNVERIFIED',
      title: 'SSH 主机密钥尚未验证',
      message: rawMsg,
      remediation: observedFingerprint
        ? `当前服务器返回公钥指纹为 ${observedFingerprint}。为保障安全，系统禁止无条件跳过主机密钥校验。请核实该指纹并在连接配置中填入“信任的主机 SHA256 指纹”，或在本地终端执行 ssh 登录以写入 ~/.ssh/known_hosts。`
        : '请在本地终端首次执行 ssh 登录以写入 ~/.ssh/known_hosts，或在配置中指定服务器的 SHA256 主机指纹。',
      timestamp: now,
      observedFingerprint,
    };
  }

  if (
    lower.includes('enoent') ||
    lower.includes('private key file not found') ||
    lower.includes('cannot read private key') ||
    lower.includes('unsupported key format') ||
    lower.includes('bad passphrase') ||
    lower.includes('encrypted private key')
  ) {
    return {
      code: 'PRIVATE_KEY_ERROR',
      title: 'SSH 私钥读取或解密失败',
      message: rawMsg,
      remediation:
        '请检查本地 SSH 私钥路径是否存在、文件权限是否正确（Linux/macOS 建议 chmod 600），或确认加密私钥的口令（Passphrase）是否正确。',
      timestamp: now,
    };
  }

  if (
    lower.includes('all configured authentication methods failed') ||
    lower.includes('authentication failed') ||
    lower.includes('permission denied (publickey')
  ) {
    return {
      code: 'AUTH_FAILED',
      title: 'SSH 身份认证失败',
      message: '服务器拒绝了当前用户名或公钥凭据（All configured authentication methods failed）',
      remediation:
        '请确认 SSH 用户名是否正确，且对应公钥已写入远程服务器 ~/.ssh/authorized_keys（权限 600，~/.ssh 目录权限 700）。',
      timestamp: now,
    };
  }

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return {
      code: 'COMMAND_TIMEOUT',
      title: 'SSH 连接或监控命令执行超时',
      message: rawMsg,
      remediation:
        '请检查服务器网络连通性、防火墙/安全组 22 端口策略，或远程系统是否因极高 I/O 负载导致响应缓慢。',
      timestamp: now,
    };
  }

  if (
    lower.includes('econnrefused') ||
    lower.includes('ehostunreach') ||
    lower.includes('enetunreach') ||
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo')
  ) {
    return {
      code: 'NETWORK_UNREACHABLE',
      title: '远程服务器不可达或 SSH 端口拒绝连接',
      message: rawMsg,
      remediation:
        '请确认服务器 IP/域名拼写正确、已开启电源并接入网络（或已连接校园网/内网 VPN），且 sshd 服务正在运行。',
      timestamp: now,
    };
  }

  return {
    code: 'UNKNOWN',
    title: 'SSH 采集发生异常',
    message: rawMsg,
    remediation: '请检查网络连接与 SSH 配置参数后点击重试。',
    timestamp: now,
  };
}
