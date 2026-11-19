import React from 'react';
import { AlertTriangle, CheckCircle2, Cpu, Flame, HelpCircle, ShieldAlert, Zap } from 'lucide-react';
import { GpuCollectionStatus, GpuDeviceMetrics, LoadThresholds, MonitorSnapshot } from '../types/monitor';
import { formatMiBToGb } from '../utils/formatters';

interface GpuSectionProps {
  snapshot: MonitorSnapshot;
  isDark: boolean;
  onOpenSettings: (tab?: 'ssh' | 'thresholds') => void;
}

function getLevelColorClasses(
  percent: number | null,
  idleMax: number,
  busyMin: number,
  isDark: boolean
): {
  bar: string;
  text: string;
  label: string;
} {
  if (percent === null || !Number.isFinite(percent)) {
    return {
      bar: isDark ? 'bg-slate-700' : 'bg-slate-300',
      text: isDark ? 'text-slate-400' : 'text-slate-500',
      label: '不可用',
    };
  }
  if (percent >= busyMin) {
    return {
      bar: 'bg-red-500',
      text: isDark ? 'text-red-400' : 'text-red-600',
      label: '高负载',
    };
  }
  if (percent > idleMax) {
    return {
      bar: 'bg-amber-500',
      text: isDark ? 'text-amber-400' : 'text-amber-600',
      label: '中等',
    };
  }
  return {
    bar: 'bg-emerald-500',
    text: isDark ? 'text-emerald-400' : 'text-emerald-600',
    label: '空闲',
  };
}

function getGpuUnavailabilityInfo(status: GpuCollectionStatus, message: string | null): {
  title: string;
  detail: string;
  badgeText: string;
} {
  switch (status) {
    case 'permission_denied':
      return {
        title: '无权限访问 NVIDIA GPU 指标 (Permission Denied)',
        detail:
          message ||
          '当前 SSH 登录用户无权限调用 NVML / nvidia-smi。请确认用户在 video / render 组中，或检查驱动设备节点 /dev/nvidia* 权限。',
        badgeText: '无权限',
      };
    case 'no_gpu':
      return {
        title: '未检测到可用 NVIDIA GPU 设备',
        detail:
          message ||
          '远程服务器未安装 NVIDIA 计算卡，或内核模块 nvidia.ko 尚未加载。CPU、系统内存与磁盘监控仍正常运作。',
        badgeText: '不可用',
      };
    case 'no_command':
      return {
        title: '未检测到 nvidia-smi 命令行工具',
        detail:
          message ||
          '远程 Ubuntu 服务器未安装 NVIDIA 驱动套件（nvidia-utils），或当前是非 GPU 服务器。CPU、内存与磁盘指标仍保持实时采集。',
        badgeText: '不可用',
      };
    default:
      return {
        title: 'GPU 指标解析异常',
        detail: message || 'nvidia-smi 返回了非预期格式的数据，请检查远程驱动版本兼容性。',
        badgeText: '解析异常',
      };
  }
}

export const GpuSection: React.FC<GpuSectionProps> = ({
  snapshot,
  isDark,
  onOpenSettings,
}) => {
  const {
    verdict,
    verdictLabel,
    verdictReason,
    verdictAdvisory,
    computeVsVramNote,
    gpus,
    gpuStatus,
    gpuStatusMessage,
    thresholds,
    connectionState,
  } = snapshot;

  const verdictTheme = {
    idle: {
      surface: isDark
        ? 'bg-[#111827] border-emerald-500/30'
        : 'bg-white border-emerald-500/40',
      text: isDark ? 'text-emerald-400' : 'text-emerald-700',
      icon: <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />,
      subtitle: '适合安排新的实验或模型训练任务',
    },
    light: {
      surface: isDark
        ? 'bg-[#111827] border-amber-500/30'
        : 'bg-white border-amber-500/40',
      text: isDark ? 'text-amber-400' : 'text-amber-700',
      icon: <Zap className="w-6 h-6 text-amber-500 shrink-0" />,
      subtitle: '存在驻留显存或轻量任务，请留意剩余显存容量',
    },
    busy: {
      surface: isDark
        ? 'bg-[#111827] border-red-500/35'
        : 'bg-white border-red-500/40',
      text: isDark ? 'text-red-400' : 'text-red-700',
      icon: <Flame className="w-6 h-6 text-red-500 shrink-0" />,
      subtitle: '计算或显存处于高水位，建议等待或避开占满的 GPU 卡',
    },
    error: {
      surface:
        connectionState === 'unconfigured'
          ? isDark
            ? 'bg-[#111827] border-slate-700'
            : 'bg-white border-slate-300'
          : isDark
          ? 'bg-[#111827] border-red-500/40'
          : 'bg-white border-red-500/45',
      text:
        connectionState === 'unconfigured'
          ? isDark
            ? 'text-slate-300'
            : 'text-slate-700'
          : isDark
          ? 'text-red-400'
          : 'text-red-700',
      icon:
        connectionState === 'unconfigured' ? (
          <HelpCircle className="w-6 h-6 text-slate-400 shrink-0" />
        ) : (
          <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
        ),
      subtitle:
        connectionState === 'unconfigured'
          ? '尚未配置远程 SSH 连接，请配置主机参数或切换至演示沙盒'
          : '当前未能获取实时指标，请先完成配置或恢复 SSH 连接',
    },
  }[verdict];

  const isDisconnected =
    connectionState === 'unconfigured' ||
    ((connectionState === 'error' || connectionState === 'offline') && gpus.length === 0);

  return (
    <section id="section-overview" className="space-y-4">
      {/* Overall Server Verdict Banner */}
      <div
        className={`rounded-xl border p-5 transition-colors ${verdictTheme.surface}`}
        data-testid="overall-verdict-banner"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              {verdictTheme.icon}
              <span
                className={`text-xs font-medium tracking-wide ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                当前整体负载判定
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span
                className={`text-2xl font-bold tracking-tight ${verdictTheme.text}`}
                data-testid="verdict-label"
              >
                {verdictLabel}
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span
                className={`text-sm font-medium ${
                  isDark ? 'text-slate-200' : 'text-slate-700'
                }`}
              >
                {verdictTheme.subtitle}
              </span>
            </div>

            <p
              className={`text-sm leading-relaxed ${
                isDark ? 'text-slate-300' : 'text-slate-600'
              }`}
            >
              {verdictReason}
            </p>

            {computeVsVramNote && (
              <div
                className={`mt-2 pt-2 border-t text-xs flex items-start gap-2 ${
                  isDark
                    ? 'border-slate-800 text-amber-300/90'
                    : 'border-slate-200 text-amber-800'
                }`}
                data-testid="compute-vram-divergence-note"
              >
                <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <span>
                  <strong>计算与显存分离提示：</strong>
                  {computeVsVramNote}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between gap-2 shrink-0">
            <div
              className={`text-xs font-mono tabular-nums ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              <span>空闲上限 ≤ {thresholds.gpuIdleMaxPercent}%</span>
              <span className="mx-1.5">·</span>
              <span>繁忙下限 ≥ {thresholds.gpuBusyMinPercent}%</span>
              <span className="mx-1.5">·</span>
              <span>显存预警 ≥ {thresholds.vramBusyMinPercent}%</span>
            </div>
            <button
              type="button"
              onClick={() => onOpenSettings('thresholds')}
              className={`text-xs font-medium underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 ${
                isDark
                  ? 'text-slate-300 hover:text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              调整判定阈值
            </button>
          </div>
        </div>

        <p
          className={`mt-3 pt-2.5 border-t text-xs ${
            isDark
              ? 'border-slate-800/80 text-slate-400'
              : 'border-slate-100 text-slate-500'
          }`}
        >
          {verdictAdvisory}
        </p>
      </div>

      {/* Primary Visual Priority: NVIDIA GPU Telemetry Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2
              className={`text-base font-semibold tracking-tight ${
                isDark ? 'text-slate-100' : 'text-slate-900'
              }`}
            >
              01. NVIDIA GPU 计算与显存监控
            </h2>
            <span aria-hidden="true" className="text-slate-500">
              ·
            </span>
            <span
              className={`text-xs font-mono tabular-nums ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}
            >
              {gpuStatus === 'available'
                ? `已识别 ${gpus.length} 张加速卡`
                : 'GPU 状态受限'}
            </span>
          </div>
          <span
            className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
            title="显存被占用并不代表 GPU 正在执行矩阵计算；请同时查看计算利用率与剩余显存"
          >
            数据源：nvidia-smi 只读采样
          </span>
        </div>

        {isDisconnected ? (
          <div
            className={`rounded-xl border p-6 ${
              isDark
                ? 'bg-[#111827] border-slate-800 text-slate-300'
                : 'bg-white border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  等待建立远程 SSH 连接后采集真实 GPU 指标
                </p>
                <p
                  className={`text-xs ${
                    isDark ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  系统不会在未连接状态下填充假数据。请先配置远程 Ubuntu 服务器 SSH 参数，或切换至“演示沙盒模式”预览不同负载场景。
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenSettings('ssh')}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
              >
                配置 SSH 服务器
              </button>
            </div>
          </div>
        ) : gpuStatus !== 'available' ? (
          <div
            className={`rounded-xl border p-5 ${
              isDark
                ? 'bg-[#111827] border-slate-800'
                : 'bg-white border-slate-200'
            }`}
            data-testid="gpu-unavailable-card"
          >
            {(() => {
              const info = getGpuUnavailabilityInfo(gpuStatus, gpuStatusMessage);
              return (
                <div className="flex items-start gap-3.5">
                  <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3
                        className={`text-sm font-semibold ${
                          isDark ? 'text-slate-100' : 'text-slate-900'
                        }`}
                      >
                        {info.title}
                      </h3>
                      <span aria-hidden="true" className="text-slate-500">
                        ·
                      </span>
                      <span className="text-xs font-mono text-amber-500">
                        {info.badgeText}
                      </span>
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        isDark ? 'text-slate-400' : 'text-slate-600'
                      }`}
                    >
                      {info.detail}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div
            className={`grid grid-cols-1 ${
              gpus.length > 1 ? 'xl:grid-cols-2' : 'xl:grid-cols-1'
            } gap-4`}
          >
            {gpus.map((gpu: GpuDeviceMetrics) => {
              const utilStyle = getLevelColorClasses(
                gpu.utilizationGpuPercent,
                thresholds.gpuIdleMaxPercent,
                thresholds.gpuBusyMinPercent,
                isDark
              );
              const vramStyle = getLevelColorClasses(
                gpu.memoryUtilPercent,
                35,
                thresholds.vramBusyMinPercent,
                isDark
              );

              const usedGb = formatMiBToGb(gpu.memoryUsedMiB, 1);
              const totalGb = formatMiBToGb(gpu.memoryTotalMiB, 1);
              const freeGb = formatMiBToGb(gpu.memoryFreeMiB, 1);

              return (
                <article
                  key={gpu.uuid || gpu.index}
                  className={`rounded-xl border p-5 transition-colors ${
                    isDark
                      ? 'bg-[#111827] border-slate-800'
                      : 'bg-white border-slate-200'
                  }`}
                  data-testid={`gpu-card-${gpu.index}`}
                >
                  {/* Card Header: GPU Index · Model Name + Temperature & Power */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-800/60 dark:border-slate-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <Cpu className="w-4 h-4 text-emerald-500 shrink-0" />
                      <h3
                        className={`text-base font-semibold tracking-tight truncate ${
                          isDark ? 'text-slate-100' : 'text-slate-900'
                        }`}
                      >
                        GPU {gpu.index} · {gpu.name}
                      </h3>
                    </div>

                    <div
                      className={`flex items-center gap-3 text-xs font-mono tabular-nums ${
                        isDark ? 'text-slate-300' : 'text-slate-600'
                      }`}
                    >
                      <span title="GPU 核心温度">
                        温度：
                        <strong
                          className={
                            (gpu.temperatureC ?? 0) >= 80
                              ? 'text-red-400'
                              : (gpu.temperatureC ?? 0) >= 70
                              ? 'text-amber-400'
                              : isDark
                              ? 'text-slate-100'
                              : 'text-slate-900'
                          }
                        >
                          {gpu.temperatureC !== null ? `${gpu.temperatureC}°C` : '不可用'}
                        </strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span title="GPU 实时功耗 / 功耗上限">
                        功耗：
                        <strong className={isDark ? 'text-slate-100' : 'text-slate-900'}>
                          {gpu.powerDrawW !== null
                            ? `${gpu.powerDrawW.toFixed(0)}${
                                gpu.powerLimitW !== null
                                  ? ` / ${gpu.powerLimitW.toFixed(0)} W`
                                  : ' W'
                              }`
                            : '不可用'}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Dual Separated Metrics: Compute Utilization vs VRAM Occupancy */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                    {/* Column 1: GPU Compute Utilization */}
                    <div className="space-y-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`text-xs font-medium ${
                            isDark ? 'text-slate-400' : 'text-slate-500'
                          }`}
                          title="SM 流处理器在采样周期内执行核函数的时间占比"
                        >
                          GPU 计算利用率
                        </span>
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`text-xs font-medium ${utilStyle.text}`}
                          >
                            {utilStyle.label}
                          </span>
                          <span
                            className={`text-2xl font-bold font-mono tabular-nums ${
                              isDark ? 'text-slate-50' : 'text-slate-900'
                            }`}
                          >
                            {gpu.utilizationGpuPercent !== null
                              ? `${gpu.utilizationGpuPercent.toFixed(0)}%`
                              : '不可用'}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`w-full h-2.5 rounded-full overflow-hidden ${
                          isDark ? 'bg-slate-800' : 'bg-slate-100'
                        }`}
                      >
                        <div
                          className={`h-full rounded-full transition-transform duration-200 origin-left ${utilStyle.bar}`}
                          style={{
                            transform: `scaleX(${
                              Math.min(100, Math.max(0, gpu.utilizationGpuPercent ?? 0)) / 100
                            })`,
                          }}
                        />
                      </div>

                      <div
                        className={`flex items-center justify-between text-xs font-mono tabular-nums ${
                          isDark ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        <span>计算核心状态</span>
                        <span>
                          {(gpu.utilizationGpuPercent ?? 0) <= thresholds.gpuIdleMaxPercent
                            ? '无活跃算子密集计算'
                            : '正在执行 CUDA 核函数'}
                        </span>
                      </div>
                    </div>

                    {/* Column 2: GPU VRAM Occupancy */}
                    <div className="space-y-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                            isDark ? 'text-slate-400' : 'text-slate-500'
                          }`}
                          title="已分配的显存容量（包含训练张量、模型权重及上下文缓存）"
                        >
                          显存占用 (VRAM)
                        </span>
                        <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
                          <span
                            className={`text-xs font-mono tabular-nums ${vramStyle.text}`}
                          >
                            {gpu.memoryUtilPercent !== null
                              ? `${gpu.memoryUtilPercent.toFixed(1)}%`
                              : '不可用'}
                          </span>
                          <span
                            className={`text-lg font-bold font-mono tabular-nums whitespace-nowrap ${
                              isDark ? 'text-slate-50' : 'text-slate-900'
                            }`}
                          >
                            {gpu.memoryUsedMiB !== null && gpu.memoryTotalMiB !== null
                              ? `${((gpu.memoryUsedMiB ?? 0) / 1024).toFixed(1)} / ${totalGb}`
                              : '不可用'}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`w-full h-2.5 rounded-full overflow-hidden ${
                          isDark ? 'bg-slate-800' : 'bg-slate-100'
                        }`}
                      >
                        <div
                          className={`h-full rounded-full transition-transform duration-200 origin-left ${vramStyle.bar}`}
                          style={{
                            transform: `scaleX(${
                              Math.min(100, Math.max(0, gpu.memoryUtilPercent ?? 0)) / 100
                            })`,
                          }}
                        />
                      </div>

                      <div
                        className={`flex items-center justify-between text-xs font-mono tabular-nums ${
                          isDark ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        <span>
                          已用：{gpu.memoryUsedMiB !== null ? `${gpu.memoryUsedMiB} MiB` : '—'}
                        </span>
                        <span>剩余可用：{freeGb}</span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
