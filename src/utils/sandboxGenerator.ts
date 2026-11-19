import {
  ActiveProcessItem,
  CpuMetrics,
  DiskMountMetrics,
  GpuCollectionStatus,
  GpuDeviceMetrics,
  LoadThresholds,
  MemoryMetrics,
  MonitorErrorInfo,
  MonitorSnapshot,
  SandboxScenario,
  SshSafeConfigSummary,
  TrendPoint,
} from '../types/monitor';
import { evaluateServerVerdict } from './telemetryParser';

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(val * 10) / 10));
}

export function buildSandboxHistory(
  scenario: SandboxScenario,
  pollIntervalMs: number,
  now: number
): TrendPoint[] {
  const maxPoints = Math.min(180, Math.max(30, Math.floor((15 * 60 * 1000) / pollIntervalMs)));
  const points: TrendPoint[] = [];

  for (let i = maxPoints - 1; i >= 0; i--) {
    const ts = now - i * pollIntervalMs;
    const wave = Math.sin((i / 6) * Math.PI * 0.5);
    const micro = Math.cos(i * 0.9) * 1.8;

    if (scenario === 'ssh_error' && i < 6) {
      points.push({
        timestamp: ts,
        gpuUtilPercent: null,
        gpuMemPercent: null,
        cpuUtilPercent: null,
        memUtilPercent: null,
        status: 'gap',
      });
      continue;
    }

    if (scenario === 'idle') {
      points.push({
        timestamp: ts,
        gpuUtilPercent: clamp(3 + wave * 2 + micro, 0, 12),
        gpuMemPercent: clamp(4.2 + wave * 0.2, 2, 10),
        cpuUtilPercent: clamp(6.5 + wave * 2.5 + micro, 1, 18),
        memUtilPercent: clamp(22.4 + wave * 0.5, 18, 30),
        status: 'ok',
      });
    } else if (scenario === 'vram_occupied') {
      points.push({
        timestamp: ts,
        gpuUtilPercent: clamp(2.5 + Math.abs(micro), 0, 9),
        gpuMemPercent: clamp(78.4 + wave * 0.4, 75, 82),
        cpuUtilPercent: clamp(11.2 + wave * 3, 4, 22),
        memUtilPercent: clamp(46.8 + wave * 0.8, 42, 52),
        status: 'ok',
      });
    } else if (scenario === 'busy_training') {
      points.push({
        timestamp: ts,
        gpuUtilPercent: clamp(94.5 + wave * 3.2 + micro, 82, 100),
        gpuMemPercent: clamp(91.2 + wave * 0.6, 88, 96),
        cpuUtilPercent: clamp(68.0 + wave * 8.5 + micro, 48, 92),
        memUtilPercent: clamp(74.5 + wave * 1.5, 68, 84),
        status: 'ok',
      });
    } else if (scenario === 'no_gpu') {
      points.push({
        timestamp: ts,
        gpuUtilPercent: null,
        gpuMemPercent: null,
        cpuUtilPercent: clamp(14.0 + wave * 4 + micro, 4, 32),
        memUtilPercent: clamp(34.2 + wave * 1.1, 28, 40),
        status: 'ok',
      });
    } else {
      points.push({
        timestamp: ts,
        gpuUtilPercent: clamp(18.0 + wave * 5, 5, 35),
        gpuMemPercent: clamp(32.0, 25, 40),
        cpuUtilPercent: clamp(15.0 + wave * 4, 5, 30),
        memUtilPercent: clamp(38.0, 30, 45),
        status: 'ok',
      });
    }
  }

  return points;
}

export function generateSandboxSnapshot(params: {
  scenario: SandboxScenario;
  pollIntervalMs: number;
  thresholds: LoadThresholds;
  existingTrends: TrendPoint[];
  monitoringStartedAt: number;
  sshConfig: SshSafeConfigSummary;
}): MonitorSnapshot {
  const {
    scenario,
    pollIntervalMs,
    thresholds,
    existingTrends,
    monitoringStartedAt,
    sshConfig,
  } = params;
  const now = Date.now();
  const jitter = Math.sin(now / 4000) * 1.5;

  const totalMem = 128 * 1024 * 1024 * 1024; // 128 GiB
  let gpus: GpuDeviceMetrics[] = [];
  let gpuStatus: GpuCollectionStatus = 'available';
  let gpuStatusMessage: string | null = null;
  let cpu: CpuMetrics | null = null;
  let memory: MemoryMetrics | null = null;
  let processes: ActiveProcessItem[] = [];
  let lastError: MonitorErrorInfo | null = null;

  const disks: DiskMountMetrics[] = [
    {
      filesystem: '/dev/nvme0n1p2',
      mountPoint: '/',
      totalBytes: 1000 * 1024 ** 3,
      usedBytes: 312 * 1024 ** 3,
      availableBytes: 688 * 1024 ** 3,
      usagePercent: 31.2,
    },
    {
      filesystem: '/dev/nvme1n1p1',
      mountPoint: '/data/datasets',
      totalBytes: 4000 * 1024 ** 3,
      usedBytes: 2480 * 1024 ** 3,
      availableBytes: 1520 * 1024 ** 3,
      usagePercent: 62.0,
    },
  ];

  if (scenario === 'idle') {
    const gpu0Util = clamp(2 + Math.abs(jitter), 0, 8);
    const gpu1Util = clamp(0 + Math.max(0, jitter), 0, 4);
    gpus = [
      {
        index: 0,
        uuid: 'GPU-sandbox-0000',
        name: 'NVIDIA GeForce RTX 4090',
        utilizationGpuPercent: gpu0Util,
        memoryTotalMiB: 24564,
        memoryUsedMiB: 840,
        memoryFreeMiB: 23724,
        memoryUtilPercent: 3.4,
        temperatureC: 38,
        powerDrawW: 26.4,
        powerLimitW: 450.0,
      },
      {
        index: 1,
        uuid: 'GPU-sandbox-0001',
        name: 'NVIDIA GeForce RTX 4090',
        utilizationGpuPercent: gpu1Util,
        memoryTotalMiB: 24564,
        memoryUsedMiB: 412,
        memoryFreeMiB: 24152,
        memoryUtilPercent: 1.7,
        temperatureC: 36,
        powerDrawW: 21.0,
        powerLimitW: 450.0,
      },
    ];
    cpu = {
      usagePercent: clamp(5.4 + jitter, 1.5, 12),
      loadAvg1m: 0.42,
      loadAvg5m: 0.58,
      loadAvg15m: 0.64,
      logicalCores: 64,
      modelName: 'AMD EPYC 7543 32-Core Processor',
    };
    const usedMem = Math.round(totalMem * 0.224);
    memory = {
      totalBytes: totalMem,
      availableBytes: totalMem - usedMem,
      usedBytes: usedMem,
      usagePercent: 22.4,
      swapTotalBytes: 16 * 1024 ** 3,
      swapUsedBytes: 0,
    };
    processes = [
      {
        pid: 14210,
        user: 'xorg',
        processName: 'Xorg',
        command: '/usr/lib/xorg/Xorg :0 -seat seat0',
        gpuIndex: 0,
        gpuMemoryMiB: 320,
        cpuPercent: 0.8,
        memPercent: 0.4,
        elapsedTime: '14-08:22:10',
        source: 'gpu',
      },
      {
        pid: 28904,
        user: 'researcher',
        processName: 'tensorboard',
        command: 'python -m tensorboard.main --logdir /data/runs --port 6006',
        gpuIndex: null,
        gpuMemoryMiB: null,
        cpuPercent: 1.9,
        memPercent: 1.2,
        elapsedTime: '06:14:52',
        source: 'cpu',
      },
    ];
  } else if (scenario === 'vram_occupied') {
    gpus = [
      {
        index: 0,
        uuid: 'GPU-sandbox-0000',
        name: 'NVIDIA GeForce RTX 4090',
        utilizationGpuPercent: clamp(2.0 + Math.abs(jitter * 0.6), 0, 6),
        memoryTotalMiB: 24564,
        memoryUsedMiB: 19260,
        memoryFreeMiB: 5304,
        memoryUtilPercent: 78.4,
        temperatureC: 47,
        powerDrawW: 54.2,
        powerLimitW: 450.0,
      },
      {
        index: 1,
        uuid: 'GPU-sandbox-0001',
        name: 'NVIDIA GeForce RTX 4090',
        utilizationGpuPercent: 0,
        memoryTotalMiB: 24564,
        memoryUsedMiB: 620,
        memoryFreeMiB: 23944,
        memoryUtilPercent: 2.5,
        temperatureC: 37,
        powerDrawW: 22.5,
        powerLimitW: 450.0,
      },
    ];
    cpu = {
      usagePercent: clamp(10.8 + jitter, 5, 18),
      loadAvg1m: 1.15,
      loadAvg5m: 1.42,
      loadAvg15m: 1.88,
      logicalCores: 64,
      modelName: 'AMD EPYC 7543 32-Core Processor',
    };
    const usedMem = Math.round(totalMem * 0.468);
    memory = {
      totalBytes: totalMem,
      availableBytes: totalMem - usedMem,
      usedBytes: usedMem,
      usagePercent: 46.8,
      swapTotalBytes: 16 * 1024 ** 3,
      swapUsedBytes: 0,
    };
    processes = [
      {
        pid: 51920,
        user: 'zhangwei',
        processName: 'python',
        command: '/opt/conda/envs/llm/bin/python -m ipykernel_launcher -f /home/zhangwei/.local/share/jupyter/runtime/kernel-8a91.json',
        gpuIndex: 0,
        gpuMemoryMiB: 18640,
        cpuPercent: 1.2,
        memPercent: 14.5,
        elapsedTime: '04:52:19',
        source: 'gpu',
      },
      {
        pid: 49102,
        user: 'zhangwei',
        processName: 'jupyter-lab',
        command: 'jupyter-lab --no-browser --port=8888',
        gpuIndex: null,
        gpuMemoryMiB: null,
        cpuPercent: 2.1,
        memPercent: 1.8,
        elapsedTime: '05:01:44',
        source: 'cpu',
      },
    ];
  } else if (scenario === 'busy_training') {
    const u0 = clamp(96 + jitter, 91, 100);
    const u1 = clamp(94 - jitter, 89, 99);
    gpus = [
      {
        index: 0,
        uuid: 'GPU-sandbox-0000',
        name: 'NVIDIA GeForce RTX 4090',
        utilizationGpuPercent: u0,
        memoryTotalMiB: 24564,
        memoryUsedMiB: 22410,
        memoryFreeMiB: 2154,
        memoryUtilPercent: 91.2,
        temperatureC: 73,
        powerDrawW: 412.5,
        powerLimitW: 450.0,
      },
      {
        index: 1,
        uuid: 'GPU-sandbox-0001',
        name: 'NVIDIA GeForce RTX 4090',
        utilizationGpuPercent: u1,
        memoryTotalMiB: 24564,
        memoryUsedMiB: 22180,
        memoryFreeMiB: 2384,
        memoryUtilPercent: 90.3,
        temperatureC: 71,
        powerDrawW: 398.0,
        powerLimitW: 450.0,
      },
    ];
    cpu = {
      usagePercent: clamp(68.4 + jitter * 2, 55, 84),
      loadAvg1m: 38.4,
      loadAvg5m: 36.1,
      loadAvg15m: 32.8,
      logicalCores: 64,
      modelName: 'AMD EPYC 7543 32-Core Processor',
    };
    const usedMem = Math.round(totalMem * 0.745);
    memory = {
      totalBytes: totalMem,
      availableBytes: totalMem - usedMem,
      usedBytes: usedMem,
      usagePercent: 74.5,
      swapTotalBytes: 16 * 1024 ** 3,
      swapUsedBytes: Math.round(0.4 * 1024 ** 3),
    };
    processes = [
      {
        pid: 88301,
        user: 'liuyang',
        processName: 'python',
        command: 'torchrun --nproc_per_node=2 train_qwen_lora.py --bf16 --batch_size 16 --grad_accum 4',
        gpuIndex: 0,
        gpuMemoryMiB: 21980,
        cpuPercent: 840.2,
        memPercent: 28.4,
        elapsedTime: '02:19:08',
        source: 'gpu',
      },
      {
        pid: 88302,
        user: 'liuyang',
        processName: 'python',
        command: 'torchrun --nproc_per_node=2 train_qwen_lora.py --bf16 --batch_size 16 --grad_accum 4',
        gpuIndex: 1,
        gpuMemoryMiB: 21760,
        cpuPercent: 812.6,
        memPercent: 27.9,
        elapsedTime: '02:19:08',
        source: 'gpu',
      },
      {
        pid: 90412,
        user: 'chenxi',
        processName: 'python',
        command: 'python preprocess_tokenize.py --workers 16 --dataset /data/datasets/openwebtext',
        gpuIndex: null,
        gpuMemoryMiB: null,
        cpuPercent: 620.0,
        memPercent: 9.2,
        elapsedTime: '00:34:15',
        source: 'cpu',
      },
    ];
  } else if (scenario === 'no_gpu') {
    gpuStatus = 'no_command';
    gpuStatusMessage = '当前服务器未安装 NVIDIA 驱动或无独立 GPU（CPU/内存/磁盘监控正常）';
    gpus = [];
    cpu = {
      usagePercent: clamp(14.2 + jitter, 6, 24),
      loadAvg1m: 2.1,
      loadAvg5m: 1.95,
      loadAvg15m: 1.8,
      logicalCores: 32,
      modelName: 'Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz',
    };
    const usedMem = Math.round(totalMem * 0.342);
    memory = {
      totalBytes: totalMem,
      availableBytes: totalMem - usedMem,
      usedBytes: usedMem,
      usagePercent: 34.2,
      swapTotalBytes: 8 * 1024 ** 3,
      swapUsedBytes: 0,
    };
    processes = [
      {
        pid: 31204,
        user: 'ubuntu',
        processName: 'python3',
        command: 'python3 evaluate_metrics.py --Split validation',
        gpuIndex: null,
        gpuMemoryMiB: null,
        cpuPercent: 98.4,
        memPercent: 6.4,
        elapsedTime: '00:12:41',
        source: 'cpu',
      },
    ];
  } else if (scenario === 'ssh_error') {
    lastError = {
      code: 'HOST_KEY_UNVERIFIED',
      title: 'SSH 主机密钥尚未验证（安全拦截演练）',
      message:
        'HOST_KEY_UNVERIFIED: 远程主机 192.168.50.28:22 的公钥未在本地 ~/.ssh/known_hosts 中找到。',
      remediation:
        '当前服务器返回公钥指纹为 SHA256:k9LmP2xQ8vR4nW7jT1yB5cF3hZ6dG0sA9eU2wI4oK8M。请核实该指纹后在连接配置中点击“信任并固定此 SHA256 指纹”，或在本地终端执行一次 ssh 登录。',
      timestamp: now,
      observedFingerprint: 'SHA256:k9LmP2xQ8vR4nW7jT1yB5cF3hZ6dG0sA9eU2wI4oK8M',
    };
  }

  let trends = existingTrends;
  if (trends.length < 10) {
    trends = buildSandboxHistory(scenario, pollIntervalMs, now);
  } else {
    const newPoint: TrendPoint =
      scenario === 'ssh_error'
        ? {
            timestamp: now,
            gpuUtilPercent: null,
            gpuMemPercent: null,
            cpuUtilPercent: null,
            memUtilPercent: null,
            status: 'gap',
          }
        : {
            timestamp: now,
            gpuUtilPercent:
              gpus.length > 0
                ? clamp(
                    gpus.reduce((s, g) => s + (g.utilizationGpuPercent ?? 0), 0) / gpus.length,
                    0,
                    100
                  )
                : null,
            gpuMemPercent:
              gpus.length > 0
                ? Math.max(...gpus.map((g) => g.memoryUtilPercent ?? 0))
                : null,
            cpuUtilPercent: cpu?.usagePercent ?? null,
            memUtilPercent: memory?.usagePercent ?? null,
            status: 'ok',
          };
    const maxPoints = Math.min(180, Math.max(30, Math.floor((15 * 60 * 1000) / pollIntervalMs)));
    trends = [...trends.slice(-(maxPoints - 1)), newPoint];
  }

  const connectionState = scenario === 'ssh_error' ? 'error' : 'connected';
  const verdictInfo = evaluateServerVerdict({
    connectionState,
    gpus,
    cpu,
    memory,
    recentTrends: trends,
    thresholds,
  });

  return {
    serverId: 'sandbox-node',
    serverAlias: `${sshConfig.alias || 'Ubuntu-DL-Node-01'} (演示沙盒)`,
    host: sshConfig.host || '192.168.50.28',
    mode: 'sandbox',
    clusterNodes: [
      {
        serverId: 'LAB1',
        serverAlias: 'LAB1',
        host: '10.126.126.6',
        connectionState: 'connected',
        verdict: 'idle',
        verdictLabel: '空闲',
        gpuCount: 1,
        idleGpuCount: 1,
        gpuSummaryText: '1 卡 RTX 3090 · 空闲 (0%)',
        maxGpuUtil: 0,
        maxVramUtil: 1,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB2',
        serverAlias: 'LAB2',
        host: '10.23.23.86',
        connectionState: 'connected',
        verdict: 'busy',
        verdictLabel: '繁忙',
        gpuCount: 2,
        idleGpuCount: 1,
        gpuSummaryText: '2 卡 RTX 3090 · 空闲 1/2 卡',
        maxGpuUtil: 100,
        maxVramUtil: 44,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB3',
        serverAlias: 'LAB3',
        host: '2001:da8:2018:b7c1::cd72',
        connectionState: 'connected',
        verdict: 'busy',
        verdictLabel: '繁忙',
        gpuCount: 2,
        idleGpuCount: 0,
        gpuSummaryText: '2 卡 RTX 3090 · 双卡满载 (100%)',
        maxGpuUtil: 100,
        maxVramUtil: 75,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB4',
        serverAlias: 'LAB4',
        host: '10.23.23.92',
        connectionState: 'connected',
        verdict: 'busy',
        verdictLabel: '繁忙',
        gpuCount: 2,
        idleGpuCount: 1,
        gpuSummaryText: '2 卡 RTX 3090 · 空闲 1/2 卡',
        maxGpuUtil: 100,
        maxVramUtil: 70,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB5',
        serverAlias: 'LAB5',
        host: '10.23.21.20',
        connectionState: 'connected',
        verdict: 'idle',
        verdictLabel: '空闲',
        gpuCount: 0,
        idleGpuCount: 0,
        gpuSummaryText: '未检测到 NVIDIA GPU',
        maxGpuUtil: null,
        maxVramUtil: null,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB6',
        serverAlias: 'LAB6',
        host: '10.126.126.5',
        connectionState: 'connected',
        verdict: 'idle',
        verdictLabel: '空闲',
        gpuCount: 1,
        idleGpuCount: 1,
        gpuSummaryText: '1 卡 RTX 3090 · 空闲 (5%)',
        maxGpuUtil: 5,
        maxVramUtil: 3,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB7',
        serverAlias: 'LAB7',
        host: '10.23.23.87',
        connectionState: 'connected',
        verdict: 'busy',
        verdictLabel: '繁忙',
        gpuCount: 2,
        idleGpuCount: 1,
        gpuSummaryText: '2 卡 RTX 3090 · 空闲 1/2 卡',
        maxGpuUtil: 100,
        maxVramUtil: 51,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB8',
        serverAlias: 'LAB8',
        host: '10.23.21.119',
        connectionState: 'connected',
        verdict: 'light',
        verdictLabel: '轻载',
        gpuCount: 1,
        idleGpuCount: 0,
        gpuSummaryText: '1 卡 RTX 3090 · 轻载 (38%)',
        maxGpuUtil: 38,
        maxVramUtil: 51,
        lastUpdatedAt: now,
      },
      {
        serverId: 'LAB9',
        serverAlias: 'LAB9',
        host: '10.23.23.89',
        connectionState: 'connected',
        verdict: 'busy',
        verdictLabel: '繁忙',
        gpuCount: 1,
        idleGpuCount: 0,
        gpuSummaryText: '1 卡 RTX 3090 · 满载 (99%)',
        maxGpuUtil: 99,
        maxVramUtil: 94,
        lastUpdatedAt: now,
      },
    ],
    sandboxScenario: scenario,
    connectionState,
    verdict: verdictInfo.verdict,
    verdictLabel: verdictInfo.verdictLabel,
    verdictReason: verdictInfo.verdictReason,
    verdictAdvisory: verdictInfo.verdictAdvisory,
    computeVsVramNote: verdictInfo.computeVsVramNote,
    lastUpdatedAt: scenario === 'ssh_error' ? now - 35_000 : now,
    monitoringStartedAt,
    uptimeSeconds: 14 * 86400 + 8 * 3600 + 1920,
    hostname: 'ubuntu-dl-4090x2',
    osRelease: 'Ubuntu 22.04.5 LTS',
    gpuStatus,
    gpuStatusMessage,
    gpus,
    cpu,
    memory,
    disks,
    processes,
    trends,
    pollIntervalMs,
    thresholds,
    lastError,
    sshConfig,
    consecutiveFailures: scenario === 'ssh_error' ? 3 : 0,
  };
}
