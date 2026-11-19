import React, { useState } from 'react';
import { Activity } from 'lucide-react';
import { MonitorSnapshot, TrendPoint } from '../types/monitor';
import { formatTimestamp } from '../utils/formatters';

interface TrendChartsSectionProps {
  snapshot: MonitorSnapshot;
  isDark: boolean;
}

interface MetricChartConfig {
  key: 'gpuUtilPercent' | 'gpuMemPercent' | 'cpuUtilPercent' | 'memUtilPercent';
  title: string;
  subtitle: string;
  strokeColor: string;
  fillId: string;
  thresholdLine?: number;
}

const CHART_CONFIGS: MetricChartConfig[] = [
  {
    key: 'gpuUtilPercent',
    title: 'GPU 平均计算利用率',
    subtitle: '最近 15 分钟 SM 计算核心负载趋势',
    strokeColor: '#10B981', // emerald-500
    fillId: 'grad-gpu-util',
  },
  {
    key: 'gpuMemPercent',
    title: 'GPU 显存最高占用率',
    subtitle: '最近 15 分钟显存容量水位',
    strokeColor: '#F59E0B', // amber-500
    fillId: 'grad-gpu-mem',
  },
  {
    key: 'cpuUtilPercent',
    title: 'CPU 总利用率',
    subtitle: '最近 15 分钟 /proc/stat 时间差分趋势',
    strokeColor: '#38BDF8', // sky-400
    fillId: 'grad-cpu-util',
  },
  {
    key: 'memUtilPercent',
    title: '系统内存使用率',
    subtitle: '最近 15 分钟系统 RAM 占用比例',
    strokeColor: '#A78BFA', // violet-400
    fillId: 'grad-mem-util',
  },
];

/**
 * Builds segmented SVG path strings so that 'gap' points (disconnected/missing data)
 * break the line cleanly instead of drawing a misleading straight line across outages.
 */
function buildSegmentedPaths(
  points: TrendPoint[],
  key: MetricChartConfig['key'],
  width: number,
  height: number,
  padX: number,
  padY: number
): {
  linePaths: string[];
  areaPaths: string[];
  gapRanges: Array<{ x1: number; x2: number }>;
  latestValue: number | null;
  avgValue: number | null;
  maxValue: number | null;
} {
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const count = points.length;

  if (count === 0) {
    return {
      linePaths: [],
      areaPaths: [],
      gapRanges: [],
      latestValue: null,
      avgValue: null,
      maxValue: null,
    };
  }

  const getX = (idx: number) =>
    count === 1 ? padX + innerW / 2 : padX + (idx / (count - 1)) * innerW;
  const getY = (val: number) =>
    padY + innerH - (Math.min(100, Math.max(0, val)) / 100) * innerH;

  const linePaths: string[] = [];
  const areaPaths: string[] = [];
  const gapRanges: Array<{ x1: number; x2: number }> = [];

  let currentSegment: Array<{ x: number; y: number }> = [];
  let gapStartIdx: number | null = null;
  const validValues: number[] = [];

  const flushSegment = () => {
    if (currentSegment.length === 0) return;
    if (currentSegment.length === 1) {
      const p = currentSegment[0];
      linePaths.push(`M ${Math.max(padX, p.x - 3).toFixed(1)} ${p.y.toFixed(1)} L ${Math.min(width - padX, p.x + 3).toFixed(1)} ${p.y.toFixed(1)}`);
    } else {
      const d = currentSegment
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      linePaths.push(d);

      const first = currentSegment[0];
      const last = currentSegment[currentSegment.length - 1];
      const bottomY = (padY + innerH).toFixed(1);
      areaPaths.push(`${d} L ${last.x.toFixed(1)} ${bottomY} L ${first.x.toFixed(1)} ${bottomY} Z`);
    }
    currentSegment = [];
  };

  for (let i = 0; i < count; i++) {
    const pt = points[i];
    const val = pt.status === 'ok' ? pt[key] : null;

    if (val === null || val === undefined || !Number.isFinite(val)) {
      flushSegment();
      if (pt.status === 'gap' && gapStartIdx === null) {
        gapStartIdx = i;
      }
    } else {
      if (gapStartIdx !== null) {
        gapRanges.push({
          x1: getX(Math.max(0, gapStartIdx - 1)),
          x2: getX(i),
        });
        gapStartIdx = null;
      }
      validValues.push(val);
      currentSegment.push({ x: getX(i), y: getY(val) });
    }
  }

  flushSegment();
  if (gapStartIdx !== null) {
    gapRanges.push({
      x1: getX(Math.max(0, gapStartIdx - 1)),
      x2: getX(count - 1),
    });
  }

  const latestValue = validValues.length > 0 ? validValues[validValues.length - 1] : null;
  const avgValue =
    validValues.length > 0
      ? Math.round((validValues.reduce((a, b) => a + b, 0) / validValues.length) * 10) / 10
      : null;
  const maxValue = validValues.length > 0 ? Math.max(...validValues) : null;

  return {
    linePaths,
    areaPaths,
    gapRanges,
    latestValue,
    avgValue,
    maxValue,
  };
}

export const TrendChartsSection: React.FC<TrendChartsSectionProps> = ({
  snapshot,
  isDark,
}) => {
  const { trends, pollIntervalMs } = snapshot;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const svgWidth = 520;
  const svgHeight = 132;
  const padX = 8;
  const padY = 10;

  const activePoint =
    hoverIdx !== null && trends[hoverIdx] ? trends[hoverIdx] : trends[trends.length - 1] ?? null;

  const gapCount = trends.filter((t) => t.status === 'gap').length;

  return (
    <section id="section-trends" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2
            className={`text-base font-semibold tracking-tight ${
              isDark ? 'text-slate-100' : 'text-slate-900'
            }`}
          >
            03. 最近 15 分钟资源实时趋势
          </h2>
          <span aria-hidden="true" className="text-slate-500">
            ·
          </span>
          <span
            className={`text-xs font-mono tabular-nums ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            采样间隔 {(pollIntervalMs / 1000).toFixed(0)}s · 已缓存 {trends.length} 个采样点
          </span>
          {gapCount > 0 && (
            <>
              <span aria-hidden="true" className="text-slate-500">
                ·
              </span>
              <span className="text-xs font-mono text-amber-500">
                含 {gapCount} 处断线缺失区间
              </span>
            </>
          )}
        </div>

        {activePoint && (
          <div
            className={`text-xs font-mono tabular-nums ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            <span>游标时刻：{formatTimestamp(activePoint.timestamp)}</span>
            {activePoint.status === 'gap' && (
              <span className="ml-2 text-red-400">[连接中断/未采样]</span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CHART_CONFIGS.map((cfg) => {
          const {
            linePaths,
            areaPaths,
            gapRanges,
            latestValue,
            avgValue,
            maxValue,
          } = buildSegmentedPaths(
            trends,
            cfg.key,
            svgWidth,
            svgHeight,
            padX,
            padY
          );

          const inspectedVal =
            hoverIdx !== null && trends[hoverIdx]?.status === 'ok'
              ? trends[hoverIdx][cfg.key]
              : latestValue;

          const hoverX =
            hoverIdx !== null && trends.length > 1
              ? padX + (hoverIdx / (trends.length - 1)) * (svgWidth - padX * 2)
              : null;

          return (
            <article
              key={cfg.key}
              className={`rounded-xl border p-4 ${
                isDark
                  ? 'bg-[#111827] border-slate-800'
                  : 'bg-white border-slate-200'
              }`}
              data-testid={`trend-chart-${cfg.key}`}
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Activity
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: cfg.strokeColor }}
                    />
                    <h3
                      className={`text-sm font-semibold ${
                        isDark ? 'text-slate-100' : 'text-slate-900'
                      }`}
                    >
                      {cfg.title}
                    </h3>
                  </div>
                  <p
                    className={`text-xs mt-0.5 ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    {cfg.subtitle}
                  </p>
                </div>

                <div className="text-right font-mono tabular-nums">
                  <div
                    className={`text-lg font-bold ${
                      isDark ? 'text-slate-50' : 'text-slate-900'
                    }`}
                  >
                    {inspectedVal !== null && inspectedVal !== undefined
                      ? `${inspectedVal.toFixed(1)}%`
                      : '不可用'}
                  </div>
                  <div
                    className={`text-[11px] ${
                      isDark ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  >
                    均值 {avgValue !== null ? `${avgValue.toFixed(1)}%` : '—'} · 峰值{' '}
                    {maxValue !== null ? `${maxValue.toFixed(1)}%` : '—'}
                  </div>
                </div>
              </div>

              <div
                className="relative select-none"
                onMouseLeave={() => setHoverIdx(null)}
                onMouseMove={(e) => {
                  if (trends.length === 0) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const idx = Math.round(relX * (trends.length - 1));
                  setHoverIdx(idx);
                }}
              >
                <svg
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  className="w-full h-32 overflow-visible"
                  role="img"
                  aria-label={`${cfg.title} 15分钟趋势图`}
                >
                  <defs>
                    <linearGradient id={cfg.fillId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={cfg.strokeColor} stopOpacity="0.22" />
                      <stop offset="100%" stopColor={cfg.strokeColor} stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal reference grid lines (0%, 50%, 100%) */}
                  {[0, 50, 100].map((pct) => {
                    const y =
                      padY +
                      (svgHeight - padY * 2) -
                      (pct / 100) * (svgHeight - padY * 2);
                    return (
                      <g key={pct}>
                        <line
                          x1={padX}
                          y1={y}
                          x2={svgWidth - padX}
                          y2={y}
                          stroke={isDark ? '#1E293B' : '#F1F5F9'}
                          strokeWidth="1"
                          strokeDasharray={pct === 50 ? '3 3' : undefined}
                        />
                        <text
                          x={svgWidth - padX}
                          y={y - 3}
                          textAnchor="end"
                          fill={isDark ? '#64748B' : '#94A3B8'}
                          fontSize="9"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {pct}%
                        </text>
                      </g>
                    );
                  })}

                  {/* Disconnected / missing data gap zones */}
                  {gapRanges.map((g, i) => (
                    <rect
                      key={i}
                      x={g.x1}
                      y={padY}
                      width={Math.max(4, g.x2 - g.x1)}
                      height={svgHeight - padY * 2}
                      fill={isDark ? 'rgba(239, 68, 68, 0.10)' : 'rgba(239, 68, 68, 0.08)'}
                    />
                  ))}

                  {/* Area under curve */}
                  {areaPaths.map((d, i) => (
                    <path key={i} d={d} fill={`url(#${cfg.fillId})`} />
                  ))}

                  {/* Line paths */}
                  {linePaths.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      fill="none"
                      stroke={cfg.strokeColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}

                  {/* Hover crosshair */}
                  {hoverX !== null && (
                    <line
                      x1={hoverX}
                      y1={padY}
                      x2={hoverX}
                      y2={svgHeight - padY}
                      stroke={isDark ? '#94A3B8' : '#64748B'}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  )}
                </svg>

                {linePaths.length === 0 && (
                  <div
                    className={`absolute inset-0 flex items-center justify-center text-xs ${
                      isDark ? 'text-slate-500' : 'text-slate-400'
                    }`}
                  >
                    等待历史采样数据汇聚...
                  </div>
                )}
              </div>

              <div
                className={`flex items-center justify-between text-[11px] font-mono tabular-nums pt-1 ${
                  isDark ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                <span>
                  {trends.length > 0 ? formatTimestamp(trends[0].timestamp) : '—'}
                </span>
                <span>15 分钟时间窗口</span>
                <span>
                  {trends.length > 0
                    ? formatTimestamp(trends[trends.length - 1].timestamp)
                    : '—'}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};
