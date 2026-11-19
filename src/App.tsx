import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Cpu,
  FlaskConical,
  Moon,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
} from 'lucide-react';
import { GpuSection } from './components/GpuSection';
import { ProcessListSection } from './components/ProcessListSection';
import { SettingsModal } from './components/SettingsModal';
import { SystemResourcesSection } from './components/SystemResourcesSection';
import { TrendChartsSection } from './components/TrendChartsSection';
import {
  ConnectionState,
  LoadThresholds,
  MonitorSnapshot,
  SandboxScenario,
  SshConfigUpdateInput,
} from './types/monitor';
import { formatDurationSeconds, formatTimestamp } from './utils/formatters';

const CONNECTION_STATE_LABELS: Record<
  ConnectionState,
  { label: string; colorDark: string; colorLight: string }
> = {
  unconfigured: {
    label: '未配置',
    colorDark: 'text-amber-400',
    colorLight: 'text-amber-700',
  },
  connecting: {
    label: '正在连接',
    colorDark: 'text-sky-400',
    colorLight: 'text-sky-700',
  },
  connected: {
    label: '已连接',
    colorDark: 'text-emerald-400',
    colorLight: 'text-emerald-700',
  },
  collecting: {
    label: '采集中',
    colorDark: 'text-emerald-400',
    colorLight: 'text-emerald-700',
  },
  stale: {
    label: '数据过期',
    colorDark: 'text-amber-400',
    colorLight: 'text-amber-700',
  },
  error: {
    label: '连接失败',
    colorDark: 'text-red-400',
    colorLight: 'text-red-700',
  },
  offline: {
    label: '远程服务器离线或无法访问',
    colorDark: 'text-red-400',
    colorLight: 'text-red-700',
  },
};

const SANDBOX_SCENARIOS: Array<{ id: SandboxScenario; label: string }> = [
  { id: 'idle', label: '场景1：空闲 (双卡 RTX 4090)' },
  { id: 'vram_occupied', label: '场景2：轻载 (显存驻留/无计算)' },
  { id: 'busy_training', label: '场景3：繁忙 (分布式训练中)' },
  { id: 'no_gpu', label: '场景4：无 NVIDIA GPU 环境' },
  { id: 'ssh_error', label: '场景5：SSH 主机密钥拦截/断线' },
];

export default function App() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pulsessh-theme');
      if (saved === 'light') return false;
      if (saved === 'dark') return true;
    }
    return true;
  });
  const [copiedSshCmd, setCopiedSshCmd] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'ssh' | 'thresholds'>('ssh');
  const [switchingServer, setSwitchingServer] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('pulsessh-theme', next ? 'dark' : 'light');
      }
      return next;
    });
  };

  const handleCopySshCommand = async () => {
    if (!snapshot) return;
    const targetAlias = snapshot.serverAlias.split(' ')[0] || snapshot.host;
    const cmd = `ssh ${targetAlias}`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedSshCmd(true);
      setTimeout(() => setCopiedSshCmd(false), 2000);
    } catch {
      setCopiedSshCmd(true);
      setTimeout(() => setCopiedSshCmd(false), 2000);
    }
  };

  // 1-second clock tick for continuous monitoring duration readout
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch('/api/snapshot');
      if (res.ok) {
        const data = (await res.json()) as MonitorSnapshot;
        setSnapshot(data);
      }
    } catch {
      // Handled by SSE reconnect
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();

    // Check if URL has ?sandbox=1 for instant demo inspection
    const params = new URLSearchParams(window.location.search);
    if (params.get('sandbox') === '1') {
      fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'sandbox', scenario: 'idle' }),
      })
        .then((r) => r.json())
        .then((d) => setSnapshot(d))
        .catch(() => {});
    }

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectSse = () => {
      es = new EventSource('/api/stream');
      es.onopen = () => {
        setSseConnected(true);
      };
      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as MonitorSnapshot;
          setSnapshot(parsed);
          setLoading(false);
        } catch {
          // Ignore malformed frame
        }
      };
      es.onerror = () => {
        setSseConnected(false);
        es?.close();
        reconnectTimer = setTimeout(connectSse, 3000);
      };
    };

    connectSse();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [fetchSnapshot]);

  const handleSwitchServer = async (alias: string) => {
    setSwitchingServer(alias);
    try {
      const res = await fetch('/api/switch-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      });
      if (res.ok) {
        const data = (await res.json()) as MonitorSnapshot;
        setSnapshot(data);
      }
    } finally {
      setSwitchingServer(null);
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/retry', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as MonitorSnapshot;
        setSnapshot(data);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleSwitchMode = async (
    mode: 'ssh' | 'sandbox',
    scenario?: SandboxScenario
  ) => {
    const res = await fetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, scenario }),
    });
    if (res.ok) {
      const data = (await res.json()) as MonitorSnapshot;
      setSnapshot(data);
    }
  };

  const handleSaveSshConfig = async (
    input: SshConfigUpdateInput
  ): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch('/api/ssh-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await res.json();
    if (!res.ok) {
      return { ok: false, error: body.error || '保存配置失败' };
    }
    setSnapshot(body as MonitorSnapshot);
    return { ok: true };
  };

  const handleSaveSettings = async (params: {
    pollIntervalMs: number;
    thresholds: LoadThresholds;
  }) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.ok) {
      const data = (await res.json()) as MonitorSnapshot;
      setSnapshot(data);
    }
  };

  const handleTrustObservedFingerprint = async (fp: string) => {
    if (!snapshot) return;
    await handleSaveSshConfig({
      alias: snapshot.sshConfig.alias,
      host: snapshot.sshConfig.host,
      port: snapshot.sshConfig.port,
      username: snapshot.sshConfig.username,
      authMethod: snapshot.sshConfig.authMethod,
      privateKeyPath: snapshot.sshConfig.privateKeyPathHint,
      hostKeyPolicy: 'pinned_fingerprint',
      pinnedFingerprint: fp,
      knownHostsPath: snapshot.sshConfig.knownHostsPath,
    });
  };

  const openSettings = (tab: 'ssh' | 'thresholds' = 'ssh') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  if (loading || !snapshot) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${
          isDark ? 'bg-[#0B0F17] text-slate-200' : 'bg-[#F8FAFC] text-slate-800'
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
          <p className="text-sm font-medium">正在初始化 SSH 服务器监控面板...</p>
        </div>
      </div>
    );
  }

  const connMeta = CONNECTION_STATE_LABELS[snapshot.connectionState];
  const monitoringDurationSec = snapshot.monitoringStartedAt
    ? Math.max(0, Math.floor((nowTick - snapshot.monitoringStartedAt) / 1000))
    : null;

  return (
    <div
      className={`min-h-screen transition-colors ${
        isDark ? 'bg-[#0B0F17] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'
      }`}
    >
      {/* Top Bar Contract: 3-zone single row */}
      <header
        className={`sticky top-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 border-b backdrop-blur-md ${
          isDark
            ? 'bg-[#0B0F17]/90 border-slate-800'
            : 'bg-white/90 border-slate-200'
        }`}
      >
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#section-overview"
          className={`text-lg font-bold tracking-tight whitespace-nowrap shrink-0 ${
            isDark ? 'text-slate-50' : 'text-slate-900'
          }`}
        >
          PulseSSH
        </a>

        {/* Zone 2: 4 clean single-line text navigation links */}
        <nav
          aria-label="页面分区导航"
          className={`hidden md:flex items-center gap-6 text-sm font-medium ${
            isDark ? 'text-slate-400' : 'text-slate-600'
          }`}
        >
          <a
            href="#section-overview"
            className={`hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              isDark ? 'hover:text-white' : 'hover:text-slate-900'
            }`}
          >
            总体状态与 GPU
          </a>
          <a
            href="#section-resources"
            className={`hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              isDark ? 'hover:text-white' : 'hover:text-slate-900'
            }`}
          >
            CPU 与内存磁盘
          </a>
          <a
            href="#section-trends"
            className={`hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              isDark ? 'hover:text-white' : 'hover:text-slate-900'
            }`}
          >
            15 分钟趋势
          </a>
          <a
            href="#section-processes"
            className={`hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
              isDark ? 'hover:text-white' : 'hover:text-slate-900'
            }`}
          >
            活跃进程列表
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => openSettings('ssh')}
            className="px-4 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
          >
            连接与阈值配置
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Row 1: Server Name, SSH Status, Last Updated Time, Continuous Monitoring Duration, and Necessary Operations */}
        <section
          aria-label="服务器连接状态与操作栏"
          className={`rounded-xl border p-4 ${
            isDark
              ? 'bg-[#111827] border-slate-800'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Left: Server Identity & SSH Status Metadata */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1
                  className={`text-lg font-bold tracking-tight ${
                    isDark ? 'text-slate-50' : 'text-slate-900'
                  }`}
                  data-testid="server-alias-heading"
                >
                  {snapshot.serverAlias}
                </h1>
                <span aria-hidden="true" className="text-slate-500">
                  ·
                </span>
                <span
                  className={`text-xs font-mono tabular-nums ${
                    isDark ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  {snapshot.host}
                  {snapshot.sshConfig.port !== 22 ? `:${snapshot.sshConfig.port}` : ''}
                </span>
                <span aria-hidden="true" className="text-slate-500">
                  ·
                </span>
                <span
                  className={`text-xs font-semibold ${
                    isDark ? connMeta.colorDark : connMeta.colorLight
                  }`}
                  data-testid="connection-state-label"
                >
                  SSH 状态：{connMeta.label}
                </span>
                <button
                  type="button"
                  onClick={handleCopySshCommand}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded border transition-colors ${
                    copiedSshCmd
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 font-semibold'
                      : isDark
                      ? 'bg-slate-800/80 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
                      : 'bg-slate-100 border-slate-300 text-slate-700 hover:text-slate-900 hover:border-slate-400'
                  }`}
                  title="复制当前节点的 SSH 登录指令"
                >
                  {copiedSshCmd ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>已复制: ssh {snapshot.serverAlias.split(' ')[0]}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>复制 SSH 命令</span>
                    </>
                  )}
                </button>
              </div>

              <div
                className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                <span>
                  最近采集时间：{formatTimestamp(snapshot.lastUpdatedAt)}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  持续监控时长：{formatDurationSeconds(monitoringDurationSec)}
                </span>
                {snapshot.osRelease && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>系统：{snapshot.osRelease}</span>
                  </>
                )}
                {snapshot.uptimeSeconds !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      服务器运行：{formatDurationSeconds(snapshot.uptimeSeconds)}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  实时推送：{sseConnected ? 'SSE 在线' : 'SSE 重连中'}
                </span>
              </div>
            </div>

            {/* Right: Essential Operations (Manual Refresh, Mode Switch, Theme Toggle) */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {/* Real SSH vs Isolated Sandbox Mode Switcher */}
              <div
                className={`flex items-center gap-1 p-1 rounded-lg border ${
                  isDark
                    ? 'bg-slate-900 border-slate-800'
                    : 'bg-slate-100 border-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSwitchMode('ssh')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    snapshot.mode === 'ssh'
                      ? 'bg-emerald-600 text-white'
                      : isDark
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  真实 SSH 监控
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSwitchMode(
                      'sandbox',
                      snapshot.sandboxScenario || 'idle'
                    )
                  }
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    snapshot.mode === 'sandbox'
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : isDark
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  演示沙盒模式
                </button>
              </div>

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                <span>手动刷新</span>
              </button>

              <button
                type="button"
                onClick={() => openSettings('thresholds')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>采样与阈值</span>
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={isDark ? '切换为浅色主题' : '切换为深色主题'}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {isDark ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>浅色</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-700" />
                    <span>深色</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Cluster Nodes Quick Overview & One-Click Switcher */}
          {snapshot.clusterNodes && snapshot.clusterNodes.length > 0 && (() => {
            const totalIdleGpus = snapshot.clusterNodes.reduce(
              (acc, n) => acc + (n.connectionState === 'connected' ? (n.idleGpuCount ?? 0) : 0),
              0
            );
            const fullyIdleNodes = snapshot.clusterNodes.filter(
              (n) => n.connectionState === 'connected' && n.verdict === 'idle'
            ).length;

            return (
              <div
                className={`mt-4 pt-3.5 border-t space-y-2.5 ${
                  isDark ? 'border-slate-800' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-500" />
                    <span
                      className={`text-xs font-semibold ${
                        isDark ? 'text-slate-200' : 'text-slate-800'
                      }`}
                    >
                      实验室服务器集群概览 (LAB1 ~ LAB9)：
                    </span>
                    <span
                      className={`text-[11px] ${
                        isDark ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      点击卡片一键切换
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono">
                      总空闲卡数: {totalIdleGpus} 张
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-500/15 border border-sky-500/30 text-sky-400 font-mono">
                      完全空闲节点: {fullyIdleNodes} 台
                    </span>
                  </div>
                  <span
                    className={`text-[11px] font-mono tabular-nums ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    已发现 {snapshot.clusterNodes.length} 台节点 · 自动轮询空闲度
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
                  {snapshot.clusterNodes.map((node) => {
                    const isCurrent =
                      snapshot.serverAlias.startsWith(node.serverId) ||
                      snapshot.host === node.host;

                    const verdictBadge = {
                      idle: {
                        bgDark: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400',
                        bgLight: 'bg-emerald-50 border-emerald-200 text-emerald-700',
                        dot: 'bg-emerald-500',
                      },
                      light: {
                        bgDark: 'bg-amber-500/15 border-amber-500/40 text-amber-300',
                        bgLight: 'bg-amber-50 border-amber-200 text-amber-700',
                        dot: 'bg-amber-500',
                      },
                      busy: {
                        bgDark: 'bg-red-500/15 border-red-500/40 text-red-400',
                        bgLight: 'bg-red-50 border-red-200 text-red-700',
                        dot: 'bg-red-500',
                      },
                      error: {
                        bgDark: 'bg-slate-800 border-slate-700 text-slate-400',
                        bgLight: 'bg-slate-100 border-slate-300 text-slate-600',
                        dot: 'bg-slate-500',
                      },
                    }[node.verdict];

                    return (
                      <button
                        key={node.serverId}
                        type="button"
                        disabled={switchingServer === node.serverId}
                        onClick={() => handleSwitchServer(node.serverId)}
                        className={`p-2.5 rounded-lg border text-left transition-all duration-150 flex flex-col justify-between ${
                          isCurrent
                            ? isDark
                              ? 'bg-slate-800/90 border-emerald-500 ring-2 ring-emerald-500/30'
                              : 'bg-white border-emerald-600 ring-2 ring-emerald-600/20 shadow-xs'
                            : isDark
                            ? 'bg-slate-900/60 border-slate-800 hover:border-slate-600 hover:bg-slate-800/50'
                            : 'bg-slate-50 border-slate-200 hover:border-slate-400 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 w-full mb-1.5">
                          <span
                            className={`text-xs font-bold font-mono truncate ${
                              isCurrent
                                ? isDark
                                  ? 'text-emerald-400'
                                  : 'text-emerald-700'
                                : isDark
                                ? 'text-slate-100'
                                : 'text-slate-900'
                            }`}
                          >
                            {node.serverId}
                          </span>
                          {switchingServer === node.serverId ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono animate-pulse">
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                              <span>切换中...</span>
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                                isDark ? verdictBadge.bgDark : verdictBadge.bgLight
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${verdictBadge.dot}`}
                              />
                              <span>{node.verdictLabel}</span>
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] font-mono tabular-nums leading-tight space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={`truncate ${
                                isDark ? 'text-slate-300' : 'text-slate-700'
                              }`}
                            >
                              {node.gpuCount > 0 ? `${node.gpuCount}× 3090` : '无GPU'}
                            </span>
                            {node.idleGpuCount && node.idleGpuCount > 0 ? (
                              <span className="text-[10px] font-bold text-emerald-400 whitespace-nowrap">
                                余 {node.idleGpuCount} 卡空
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={`text-[10px] truncate ${
                              isDark ? 'text-slate-400' : 'text-slate-500'
                            }`}
                          >
                            {node.connectionState === 'error'
                              ? '连接超时'
                              : node.gpuCount === 0
                              ? 'CPU 节点'
                              : node.maxGpuUtil !== null
                              ? `GPU ${node.maxGpuUtil}% · 显存 ${node.maxVramUtil ?? 0}%`
                              : '不可用'}
                          </div>

                          {node.gpuCount > 0 && node.maxGpuUtil !== null && (
                            <div
                              className={`w-full h-1 rounded-full overflow-hidden ${
                                isDark ? 'bg-slate-800' : 'bg-slate-200'
                              }`}
                            >
                              <div
                                className={`h-full transition-all duration-300 rounded-full ${
                                  node.maxGpuUtil >= 75
                                    ? 'bg-red-500'
                                    : node.maxGpuUtil >= 20
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(4, node.maxGpuUtil))}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Isolated Sandbox Mode Scenario Selector Bar */}
          {snapshot.mode === 'sandbox' && (
            <div
              className={`mt-4 pt-3.5 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                isDark ? 'border-slate-800' : 'border-slate-200'
              }`}
              data-testid="sandbox-isolation-banner"
            >
              <div className="flex items-center gap-2 text-xs text-amber-400">
                <FlaskConical className="w-4 h-4 shrink-0 text-amber-500" />
                <span>
                  <strong>当前处于隔离演示沙盒模式：</strong>
                  展示明确标注的模拟数据，用于验证空闲/显存驻留/满载/无GPU/异常五类场景，绝不混入真实 SSH 监控数据。
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {SANDBOX_SCENARIOS.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => handleSwitchMode('sandbox', sc.id)}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                      snapshot.sandboxScenario === sc.id
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : isDark
                        ? 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Unconfigured Guidance Card (when in real SSH mode and SSH_HOST is empty) */}
        {snapshot.mode === 'ssh' && snapshot.connectionState === 'unconfigured' && (
          <section
            aria-label="SSH 首次配置引导"
            className={`rounded-xl border p-6 ${
              isDark
                ? 'bg-[#111827] border-emerald-500/30'
                : 'bg-white border-emerald-500/40'
            }`}
            data-testid="unconfigured-onboarding-card"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2 max-w-3xl">
                <div className="flex items-center gap-2 text-emerald-500 text-xs font-semibold">
                  <Terminal className="w-4 h-4" />
                  <span>快速开始 · 零远端 Agent 部署</span>
                </div>
                <h2
                  className={`text-lg font-bold ${
                    isDark ? 'text-slate-50' : 'text-slate-900'
                  }`}
                >
                  连接您的 Ubuntu 深度学习训练服务器
                </h2>
                <p
                  className={`text-xs leading-relaxed ${
                    isDark ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  本应用通过本地后端复用受限只读 SSH 会话采集{' '}
                  <code className="font-mono">nvidia-smi</code>、
                  <code className="font-mono">/proc/stat</code>、
                  <code className="font-mono">/proc/meminfo</code> 与{' '}
                  <code className="font-mono">df</code>{' '}
                  指标，无需在远程服务器安装任何常驻监控服务或数据库。您可以在下方一键配置 SSH 连接，或在本地{' '}
                  <code className="font-mono">.env</code> 中填写参数。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => openSettings('ssh')}
                  className="px-4 py-2.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
                >
                  立即填写 SSH 连接配置
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('sandbox', 'idle')}
                  className={`px-4 py-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    isDark
                      ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  先体验演示沙盒数据
                </button>
              </div>
            </div>
          </section>
        )}

        {/* SSH Connection / Collection Error Diagnostic Card */}
        {snapshot.lastError && (
          <section
            aria-label="SSH 连接与采集异常诊断"
            className={`rounded-xl border p-5 ${
              isDark
                ? 'bg-[#111827] border-red-500/45'
                : 'bg-white border-red-500/50'
            }`}
            data-testid="ssh-error-diagnostic-card"
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                  <h2
                    className={`text-sm font-bold ${
                      isDark ? 'text-red-400' : 'text-red-700'
                    }`}
                  >
                    {snapshot.lastError.title}
                  </h2>
                  <span aria-hidden="true" className="text-slate-500">
                    ·
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    错误码：{snapshot.lastError.code}
                  </span>
                  <span aria-hidden="true" className="text-slate-500">
                    ·
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    最后一次成功更新时间：{formatTimestamp(snapshot.lastUpdatedAt)}
                  </span>
                </div>

                <p
                  className={`text-xs font-mono ${
                    isDark ? 'text-slate-300' : 'text-slate-700'
                  }`}
                >
                  {snapshot.lastError.message}
                </p>

                <p
                  className={`text-xs leading-relaxed ${
                    isDark ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  排查建议：{snapshot.lastError.remediation}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {snapshot.lastError.observedFingerprint && (
                  <button
                    type="button"
                    onClick={() =>
                      handleTrustObservedFingerprint(
                        snapshot.lastError!.observedFingerprint!
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>信任并固定此 SHA256 指纹</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleManualRefresh}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors whitespace-nowrap shrink-0"
                >
                  立即重试采集
                </button>
                <button
                  type="button"
                  onClick={() => openSettings('ssh')}
                  className={`px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    isDark
                      ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  检查 SSH 配置
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Layer 1: Overall Server Verdict + NVIDIA GPU Monitoring */}
        <GpuSection
          snapshot={snapshot}
          isDark={isDark}
          onOpenSettings={openSettings}
        />

        {/* Layer 2: CPU, System Memory (MemAvailable) & Disk Mounts */}
        <SystemResourcesSection snapshot={snapshot} isDark={isDark} />

        {/* Layer 3: Last 15 Minutes Real-Time Resource Trends */}
        <TrendChartsSection snapshot={snapshot} isDark={isDark} />

        {/* Layer 4: Collapsible GPU & System Active Processes Table */}
        <ProcessListSection snapshot={snapshot} isDark={isDark} />
      </main>

      {/* Quiet Footer */}
      <footer
        className={`mt-12 border-t py-6 px-6 text-xs ${
          isDark
            ? 'border-slate-800/80 text-slate-500'
            : 'border-slate-200 text-slate-400'
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            PulseSSH · 远程 Linux 训练服务器空闲度与 GPU 负载监控面板
          </span>
          <span>
            只读 SSH 安全采集 · 强制校验主机公钥指纹 · 零远端常驻依赖
          </span>
        </div>
      </footer>

      {/* Settings & SSH Configuration Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        initialTab={settingsTab}
        snapshot={snapshot}
        isDark={isDark}
        onClose={() => setSettingsOpen(false)}
        onSaveSshConfig={handleSaveSshConfig}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  );
}
