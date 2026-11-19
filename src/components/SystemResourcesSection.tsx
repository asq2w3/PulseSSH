import React from 'react';
import { HardDrive, Layers, Server } from 'lucide-react';
import { MonitorSnapshot } from '../types/monitor';
import { formatBytesToGb } from '../utils/formatters';

interface SystemResourcesSectionProps {
  snapshot: MonitorSnapshot;
  isDark: boolean;
}

function getBarColor(percent: number | null, idleMax: number, busyMin: number): string {
  if (percent === null || !Number.isFinite(percent)) return 'bg-slate-600';
  if (percent >= busyMin) return 'bg-red-500';
  if (percent > idleMax) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export const SystemResourcesSection: React.FC<SystemResourcesSectionProps> = ({
  snapshot,
  isDark,
}) => {
  const { cpu, memory, disks, thresholds } = snapshot;

  const cpuBarColor = getBarColor(
    cpu?.usagePercent ?? null,
    thresholds.cpuIdleMaxPercent,
    thresholds.cpuBusyMinPercent
  );
  const memBarColor = getBarColor(
    memory?.usagePercent ?? null,
    50,
    thresholds.memBusyMinPercent
  );

  return (
    <section id="section-resources" className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2
            className={`text-base font-semibold tracking-tight ${
              isDark ? 'text-slate-100' : 'text-slate-900'
            }`}
          >
            02. CPU、系统内存与存储空间
          </h2>
          <span aria-hidden="true" className="text-slate-500">
            ·
          </span>
          <span
            className={`text-xs font-mono tabular-nums ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            /proc/stat 时间差分 · /proc/meminfo MemAvailable · df -B1
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        {/* Card 1: CPU & System Load Average */}
        <article
          className={`rounded-xl border p-5 flex flex-col justify-between ${
            isDark
              ? 'bg-[#111827] border-slate-800'
              : 'bg-white border-slate-200'
          }`}
          data-testid="cpu-resource-card"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-500 shrink-0" />
                <h3
                  className={`text-sm font-semibold ${
                    isDark ? 'text-slate-100' : 'text-slate-900'
                  }`}
                >
                  CPU 与系统负载
                </h3>
              </div>
              <span
                className={`text-xs font-mono tabular-nums ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {cpu?.logicalCores ? `${cpu.logicalCores} 逻辑线程` : '线程数未获取'}
              </span>
            </div>

            {cpu ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span
                      className={`text-xs ${
                        isDark ? 'text-slate-400' : 'text-slate-500'
                      }`}
                      title="基于前后两次 /proc/stat 采样计数时间差计算的真实 CPU 总利用率"
                    >
                      CPU 总利用率
                    </span>
                    <span
                      className={`text-2xl font-bold font-mono tabular-nums ${
                        isDark ? 'text-slate-50' : 'text-slate-900'
                      }`}
                    >
                      {cpu.usagePercent !== null
                        ? `${cpu.usagePercent.toFixed(1)}%`
                        : '采样差分中'}
                    </span>
                  </div>

                  <div
                    className={`w-full h-2 rounded-full overflow-hidden ${
                      isDark ? 'bg-slate-800' : 'bg-slate-100'
                    }`}
                  >
                    <div
                      className={`h-full rounded-full transition-transform duration-200 origin-left ${cpuBarColor}`}
                      style={{
                        transform: `scaleX(${
                          Math.min(100, Math.max(0, cpu.usagePercent ?? 0)) / 100
                        })`,
                      }}
                    />
                  </div>
                </div>

                <div
                  className={`pt-3 border-t space-y-2 ${
                    isDark ? 'border-slate-800/80' : 'border-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={isDark ? 'text-slate-400' : 'text-slate-500'}
                      title="1分钟 / 5分钟 / 15分钟平均可运行队列任务数 (Load Average)"
                    >
                      平均负载 (1m / 5m / 15m)
                    </span>
                    <span
                      className={`font-mono tabular-nums font-medium ${
                        isDark ? 'text-slate-200' : 'text-slate-800'
                      }`}
                    >
                      {cpu.loadAvg1m.toFixed(2)} / {cpu.loadAvg5m.toFixed(2)} /{' '}
                      {cpu.loadAvg15m.toFixed(2)}
                    </span>
                  </div>
                  {cpu.modelName && (
                    <p
                      className={`text-xs truncate ${
                        isDark ? 'text-slate-400' : 'text-slate-500'
                      }`}
                      title={cpu.modelName}
                    >
                      型号：{cpu.modelName}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p
                className={`text-xs py-6 ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                暂无实时 CPU 采样数据
              </p>
            )}
          </div>
        </article>

        {/* Card 2: System Memory (MemAvailable based) */}
        <article
          className={`rounded-xl border p-5 flex flex-col justify-between ${
            isDark
              ? 'bg-[#111827] border-slate-800'
              : 'bg-white border-slate-200'
          }`}
          data-testid="memory-resource-card"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-500 shrink-0" />
                <h3
                  className={`text-sm font-semibold ${
                    isDark ? 'text-slate-100' : 'text-slate-900'
                  }`}
                >
                  系统内存 (RAM)
                </h3>
              </div>
              <span
                className={`text-xs font-mono tabular-nums ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
                title="基于 /proc/meminfo 中的 MemAvailable 计算可用内存，包含可随时回收的 Page Cache"
              >
                基于 MemAvailable
              </span>
            </div>

            {memory ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-xs whitespace-nowrap shrink-0 ${
                        isDark ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      已用 / 总量 ({memory.usagePercent.toFixed(1)}%)
                    </span>
                    <span
                      className={`text-lg font-bold font-mono tabular-nums whitespace-nowrap ${
                        isDark ? 'text-slate-50' : 'text-slate-900'
                      }`}
                    >
                      {formatBytesToGb(memory.usedBytes)} /{' '}
                      {formatBytesToGb(memory.totalBytes)}
                    </span>
                  </div>

                  <div
                    className={`w-full h-2 rounded-full overflow-hidden ${
                      isDark ? 'bg-slate-800' : 'bg-slate-100'
                    }`}
                  >
                    <div
                      className={`h-full rounded-full transition-transform duration-200 origin-left ${memBarColor}`}
                      style={{
                        transform: `scaleX(${
                          Math.min(100, Math.max(0, memory.usagePercent)) / 100
                        })`,
                      }}
                    />
                  </div>
                </div>

                <div
                  className={`pt-3 border-t space-y-2 text-xs font-mono tabular-nums ${
                    isDark ? 'border-slate-800/80' : 'border-slate-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                      实际可用内存 (MemAvailable)
                    </span>
                    <span
                      className={`font-medium ${
                        isDark ? 'text-emerald-400' : 'text-emerald-600'
                      }`}
                    >
                      {formatBytesToGb(memory.availableBytes)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                      Swap 交换分区已用
                    </span>
                    <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                      {formatBytesToGb(memory.swapUsedBytes)} /{' '}
                      {formatBytesToGb(memory.swapTotalBytes)}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <p
                className={`text-xs py-6 ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                暂无实时系统内存采样数据
              </p>
            )}
          </div>
        </article>

        {/* Card 3: Disk Mounts */}
        <article
          className={`rounded-xl border p-5 flex flex-col justify-between ${
            isDark
              ? 'bg-[#111827] border-slate-800'
              : 'bg-white border-slate-200'
          }`}
          data-testid="disk-resource-card"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-500 shrink-0" />
                <h3
                  className={`text-sm font-semibold ${
                    isDark ? 'text-slate-100' : 'text-slate-900'
                  }`}
                >
                  主要文件系统磁盘
                </h3>
              </div>
              <span
                className={`text-xs font-mono tabular-nums ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {disks.length > 0 ? `${disks.length} 个挂载点` : '未采集'}
              </span>
            </div>

            {disks.length > 0 ? (
              <div className="space-y-3">
                {disks.slice(0, 3).map((disk) => {
                  const diskBarColor = getBarColor(disk.usagePercent, 70, 90);
                  return (
                    <div key={disk.mountPoint} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs font-mono tabular-nums">
                        <div className="truncate">
                          <span
                            className={`font-semibold ${
                              isDark ? 'text-slate-100' : 'text-slate-900'
                            }`}
                          >
                            {disk.mountPoint}
                          </span>
                          <span
                            className={`ml-1.5 ${
                              isDark ? 'text-slate-500' : 'text-slate-400'
                            }`}
                          >
                            ({disk.filesystem})
                          </span>
                        </div>
                        <span
                          className={`shrink-0 ${
                            isDark ? 'text-slate-200' : 'text-slate-700'
                          }`}
                        >
                          {formatBytesToGb(disk.usedBytes)} /{' '}
                          {formatBytesToGb(disk.totalBytes)} ({disk.usagePercent.toFixed(1)}%)
                        </span>
                      </div>

                      <div
                        className={`w-full h-1.5 rounded-full overflow-hidden ${
                          isDark ? 'bg-slate-800' : 'bg-slate-100'
                        }`}
                      >
                        <div
                          className={`h-full rounded-full transition-transform duration-200 origin-left ${diskBarColor}`}
                          style={{
                            transform: `scaleX(${
                              Math.min(100, Math.max(0, disk.usagePercent)) / 100
                            })`,
                          }}
                        />
                      </div>

                      <div
                        className={`flex justify-between text-[11px] font-mono tabular-nums ${
                          isDark ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        <span>剩余可用：{formatBytesToGb(disk.availableBytes)}</span>
                        <span>使用率：{disk.usagePercent.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p
                className={`text-xs py-6 ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                暂无实时磁盘空间采样数据
              </p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
};
