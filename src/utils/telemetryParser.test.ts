import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THRESHOLDS,
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
} from './telemetryParser';

test('parseProcStatLine and calculateCpuDeltaUsage compute accurate time-delta CPU usage', () => {
  const sample1 = parseProcStatLine('cpu  10000 200 3000 80000 500 100 50 0 0 0');
  const sample2 = parseProcStatLine('cpu  10300 200 3100 80500 500 100 50 0 0 0');
  assert.ok(sample1);
  assert.ok(sample2);

  // Delta: busy increased by (300 + 100) = 400; idle increased by 500; totalDelta = 900
  // Expected usage: 400 / 900 = 44.4%
  const usage = calculateCpuDeltaUsage(sample1, sample2);
  assert.equal(usage, 44.4);

  // Zero delta returns null rather than NaN or cumulative ratio
  assert.equal(calculateCpuDeltaUsage(sample1, sample1), null);
  assert.equal(calculateCpuDeltaUsage(null, sample2), null);
});

test('parseProcMeminfo prioritizes MemAvailable over MemFree', () => {
  const rawMeminfo = [
    'MemTotal:       65536000 kB',
    'MemFree:         4096000 kB',
    'MemAvailable:   49152000 kB',
    'Buffers:         2048000 kB',
    'Cached:         40960000 kB',
    'SwapTotal:       8388608 kB',
    'SwapFree:        8388608 kB',
  ].join('\n');

  const mem = parseProcMeminfo(rawMeminfo);
  assert.ok(mem);
  // Available is 49152000 / 65536000 = 75%, so Used is 25%
  assert.equal(mem.usagePercent, 25);
  assert.equal(mem.availableBytes, 49152000 * 1024);
  assert.equal(mem.usedBytes, (65536000 - 49152000) * 1024);
});

test('parseDfOutput filters pseudo filesystems and parses real mounts', () => {
  const rawDf = [
    'Filesystem     1B-blocks          Used     Available Use% Mounted on',
    'udev         33554432000             0   33554432000   0% /dev',
    'tmpfs         6710886400       1048576    6709837824   1% /run',
    '/dev/nvme0n1p2 1000000000000 420000000000 580000000000  42% /',
    '/dev/nvme1n1p1 4000000000000 1800000000000 2200000000000 45% /data',
    '/dev/loop0      58720256      58720256             0 100% /snap/core20/1974',
  ].join('\n');

  const disks = parseDfOutput(rawDf);
  assert.equal(disks.length, 2);
  assert.equal(disks[0].mountPoint, '/');
  assert.equal(disks[0].usagePercent, 42);
  assert.equal(disks[1].mountPoint, '/data');
  assert.equal(disks[1].usagePercent, 45);
});

test('parseNvidiaSmiOutput handles multi-GPU valid output, missing command, no GPU, and permission errors', () => {
  const validCsv = [
    '0, GPU-aaaa-1111, NVIDIA GeForce RTX 4090, 8, 24564, 4120, 20444, 46, 68.50, 450.00',
    '1, GPU-bbbb-2222, NVIDIA GeForce RTX 4090, 92, 24564, 21890, 2674, 74, 395.20, [Not Supported]',
  ].join('\n');

  const res = parseNvidiaSmiOutput(validCsv);
  assert.equal(res.status, 'available');
  assert.equal(res.gpus.length, 2);
  assert.equal(res.gpus[0].name, 'NVIDIA GeForce RTX 4090');
  assert.equal(res.gpus[0].utilizationGpuPercent, 8);
  assert.equal(res.gpus[0].memoryUtilPercent, 16.8);
  assert.equal(res.gpus[1].powerLimitW, null);

  const noCmd = parseNvidiaSmiOutput('__NO_NVIDIA_SMI__');
  assert.equal(noCmd.status, 'no_command');

  const noGpu = parseNvidiaSmiOutput('NVIDIA-SMI has failed because it couldn\'t communicate with the NVIDIA driver.');
  assert.equal(noGpu.status, 'no_gpu');

  const noPerm = parseNvidiaSmiOutput('Failed to initialize NVML: Insufficient Permissions');
  assert.equal(noPerm.status, 'permission_denied');
});

test('mergeGpuAndSystemProcesses enriches GPU compute processes with ps user and CPU/MEM metrics', () => {
  const gpus = parseNvidiaSmiOutput(
    '0, GPU-aaaa-1111, NVIDIA RTX 3090, 78, 24576, 18432, 6144, 69, 310.0, 350.0'
  ).gpus;

  const rawNvidiaProcs = 'GPU-aaaa-1111, 41820, /opt/conda/bin/python, 16840';
  const rawTopPs = [
    '41820 alice                            185.4 12.6 03:41:19 python          python train.py --batch-size 64',
    '10422 bob                               12.0  2.1 00:18:04 jupyter-kernel  /usr/bin/python -m ipykernel_launcher',
  ].join('\n');

  const merged = mergeGpuAndSystemProcesses(rawNvidiaProcs, rawTopPs, gpus);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].pid, 41820);
  assert.equal(merged[0].user, 'alice');
  assert.equal(merged[0].source, 'gpu');
  assert.equal(merged[0].gpuMemoryMiB, 16840);
  assert.equal(merged[0].cpuPercent, 185.4);
  assert.equal(merged[1].pid, 10422);
  assert.equal(merged[1].source, 'cpu');
});

test('evaluateServerVerdict separates GPU compute vs VRAM occupancy and applies smoothing', () => {
  // Case 1: Low GPU compute (2%) but high VRAM occupancy (18.4GB / 24GB = 76.7%) -> should be 'light' with computeVsVramNote
  const gpusVramResident = parseNvidiaSmiOutput(
    '0, GPU-aaaa-1111, NVIDIA RTX 3090, 2, 24576, 18841, 5735, 48, 52.0, 350.0'
  ).gpus;

  const verdictResident = evaluateServerVerdict({
    connectionState: 'connected',
    gpus: gpusVramResident,
    cpu: { usagePercent: 6.2, loadAvg1m: 0.4, loadAvg5m: 0.5, loadAvg15m: 0.4, logicalCores: 32, modelName: 'AMD EPYC' },
    memory: { totalBytes: 64e9, availableBytes: 48e9, usedBytes: 16e9, usagePercent: 25, swapTotalBytes: 8e9, swapUsedBytes: 0 },
    recentTrends: [],
    thresholds: DEFAULT_THRESHOLDS,
  });

  assert.equal(verdictResident.verdict, 'light');
  assert.equal(verdictResident.verdictLabel, '轻载');
  assert.ok(verdictResident.computeVsVramNote);
  assert.ok(verdictResident.computeVsVramNote.includes('显存已占用'));

  // Case 2: True idle
  const gpusIdle = parseNvidiaSmiOutput(
    '0, GPU-aaaa-1111, NVIDIA RTX 3090, 0, 24576, 420, 24156, 39, 24.0, 350.0'
  ).gpus;

  const verdictIdle = evaluateServerVerdict({
    connectionState: 'connected',
    gpus: gpusIdle,
    cpu: { usagePercent: 3.1, loadAvg1m: 0.12, loadAvg5m: 0.18, loadAvg15m: 0.15, logicalCores: 32, modelName: 'AMD EPYC' },
    memory: { totalBytes: 64e9, availableBytes: 56e9, usedBytes: 8e9, usagePercent: 12.5, swapTotalBytes: 8e9, swapUsedBytes: 0 },
    recentTrends: [],
    thresholds: DEFAULT_THRESHOLDS,
  });

  assert.equal(verdictIdle.verdict, 'idle');
  assert.equal(verdictIdle.verdictLabel, '空闲');
});

test('validateSshConfigInput blocks injection characters and classifySshError categorizes failures', () => {
  assert.equal(
    validateSshConfigInput({ host: '192.168.1.50; rm -rf /', username: 'ubuntu' }).valid,
    false
  );
  assert.equal(
    validateSshConfigInput({ host: '-oProxyCommand=evil', username: 'ubuntu' }).valid,
    false
  );
  assert.equal(
    validateSshConfigInput({ host: '10.0.0.12', username: 'researcher', port: 22 }).valid,
    true
  );

  const hostMismatch = classifySshError(new Error('HOST_KEY_MISMATCH: Server fingerprint changed'), 'SHA256:abc123xyz');
  assert.equal(hostMismatch.code, 'HOST_KEY_MISMATCH');
  assert.equal(hostMismatch.observedFingerprint, 'SHA256:abc123xyz');

  const keyErr = classifySshError(new Error('ENOENT: Private key file not found'));
  assert.equal(keyErr.code, 'PRIVATE_KEY_ERROR');

  const load = parseLoadAvg('1.25 0.85 0.42 2/845 49210');
  assert.deepEqual(load, { loadAvg1m: 1.25, loadAvg5m: 0.85, loadAvg15m: 0.42 });

  const extracted = extractSection('<<<SECTION:TEST>>>\nhello world\n<<<END:TEST>>>', 'TEST');
  assert.equal(extracted, 'hello world');
});

import { generateSandboxSnapshot } from './sandboxGenerator';

test('generateSandboxSnapshot produces isolated, well-formed snapshots for all 5 scenarios', () => {
  const dummySsh = {
    alias: 'Test-Node',
    host: '10.0.0.8',
    port: 22,
    username: 'ubuntu',
    authMethod: 'privateKeyPath' as const,
    privateKeyPathHint: '~/.ssh/id_ed25519',
    hasPassphrase: false,
    hostKeyPolicy: 'known_hosts' as const,
    pinnedFingerprint: '',
    knownHostsPath: '~/.ssh/known_hosts',
    configured: true,
  };

  const idleSnap = generateSandboxSnapshot({
    scenario: 'idle',
    pollIntervalMs: 5000,
    thresholds: DEFAULT_THRESHOLDS,
    existingTrends: [],
    monitoringStartedAt: Date.now() - 60000,
    sshConfig: dummySsh,
  });
  assert.equal(idleSnap.mode, 'sandbox');
  assert.equal(idleSnap.verdict, 'idle');
  assert.equal(idleSnap.gpus.length, 2);

  const vramSnap = generateSandboxSnapshot({
    scenario: 'vram_occupied',
    pollIntervalMs: 5000,
    thresholds: DEFAULT_THRESHOLDS,
    existingTrends: [],
    monitoringStartedAt: Date.now() - 60000,
    sshConfig: dummySsh,
  });
  assert.equal(vramSnap.verdict, 'light');
  assert.ok(vramSnap.computeVsVramNote);

  const busySnap = generateSandboxSnapshot({
    scenario: 'busy_training',
    pollIntervalMs: 5000,
    thresholds: DEFAULT_THRESHOLDS,
    existingTrends: [],
    monitoringStartedAt: Date.now() - 60000,
    sshConfig: dummySsh,
  });
  assert.equal(busySnap.verdict, 'busy');

  const noGpuSnap = generateSandboxSnapshot({
    scenario: 'no_gpu',
    pollIntervalMs: 5000,
    thresholds: DEFAULT_THRESHOLDS,
    existingTrends: [],
    monitoringStartedAt: Date.now() - 60000,
    sshConfig: dummySsh,
  });
  assert.equal(noGpuSnap.gpuStatus, 'no_command');
  assert.equal(noGpuSnap.gpus.length, 0);
  assert.ok(noGpuSnap.cpu);

  const errSnap = generateSandboxSnapshot({
    scenario: 'ssh_error',
    pollIntervalMs: 5000,
    thresholds: DEFAULT_THRESHOLDS,
    existingTrends: [],
    monitoringStartedAt: Date.now() - 60000,
    sshConfig: dummySsh,
  });
  assert.equal(errSnap.verdict, 'error');
  assert.ok(errSnap.lastError);
});
