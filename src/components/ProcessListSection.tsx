import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, Search, Terminal, X } from 'lucide-react';
import { ActiveProcessItem, MonitorSnapshot } from '../types/monitor';

interface ProcessListSectionProps {
  snapshot: MonitorSnapshot;
  isDark: boolean;
}

export const ProcessListSection: React.FC<ProcessListSectionProps> = ({
  snapshot,
  isDark,
}) => {
  const { processes } = snapshot;
  const [expanded, setExpanded] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'gpu'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPid, setCopiedPid] = useState<number | null>(null);

  const handleCopyCommand = async (pid: number, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedPid(pid);
      setTimeout(() => setCopiedPid(null), 2000);
    } catch {
      setCopiedPid(pid);
      setTimeout(() => setCopiedPid(null), 2000);
    }
  };

  const gpuProcessCount = processes.filter((p) => p.source === 'gpu').length;
  const filteredProcesses = processes.filter((p) => {
    if (filterMode === 'gpu' && p.source !== 'gpu') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchUser = p.user.toLowerCase().includes(q);
      const matchName = p.processName.toLowerCase().includes(q);
      const matchCmd = p.command.toLowerCase().includes(q);
      const matchPid = String(p.pid).includes(q);
      return matchUser || matchName || matchCmd || matchPid;
    }
    return true;
  });

  const visibleCount = expanded ? filteredProcesses.length : Math.min(5, filteredProcesses.length);
  const visibleProcesses = filteredProcesses.slice(0, visibleCount);

  return (
    <section id="section-processes" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2
            className={`text-base font-semibold tracking-tight ${
              isDark ? 'text-slate-100' : 'text-slate-900'
            }`}
          >
            04. 活跃计算进程与资源占用归属
          </h2>
          <span aria-hidden="true" className="text-slate-500">
            ·
          </span>
          <span
            className={`text-xs font-mono tabular-nums ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}
          >
            GPU 计算进程 {gpuProcessCount} 个 · 总活跃进程 {processes.length} 个
          </span>
        </div>

        {/* Search input & Interactive Filter Segmented Control */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索用户 / 进程 / 命令..."
              className={`pl-8 pr-7 py-1 text-xs rounded-lg border font-mono transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-500/50 ${
                isDark
                  ? 'bg-[#111827] border-slate-700 text-slate-200 placeholder-slate-500'
                  : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div
            className={`flex items-center gap-1 p-1 rounded-lg border ${
              isDark
                ? 'bg-[#111827] border-slate-800'
                : 'bg-slate-100 border-slate-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filterMode === 'all'
                  ? isDark
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-900 shadow-xs'
                  : isDark
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全部关注进程 ({processes.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('gpu')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filterMode === 'gpu'
                  ? isDark
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-900 shadow-xs'
                  : isDark
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              仅 GPU 进程 ({gpuProcessCount})
            </button>
          </div>
        </div>
      </div>

      <div
        className={`rounded-xl border overflow-hidden ${
          isDark ? 'bg-[#111827] border-slate-800' : 'bg-white border-slate-200'
        }`}
        data-testid="process-table-container"
      >
        {filteredProcesses.length === 0 ? (
          <div className="p-6 text-center space-y-1">
            <Terminal className="w-5 h-5 text-slate-500 mx-auto" />
            <p
              className={`text-sm font-medium ${
                isDark ? 'text-slate-300' : 'text-slate-700'
              }`}
            >
              {filterMode === 'gpu'
                ? '当前没有运行中的 GPU 计算进程'
                : '当前未检测到高占用训练或计算进程'}
            </p>
            <p
              className={`text-xs ${
                isDark ? 'text-slate-500' : 'text-slate-400'
              }`}
            >
              只读安全模式：仅采集进程资源归属，不提供远程终止进程或执行任意 Shell 命令接口。
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr
                    className={`border-b text-xs font-medium ${
                      isDark
                        ? 'border-slate-800 text-slate-400 bg-slate-900/40'
                        : 'border-slate-200 text-slate-500 bg-slate-50'
                    }`}
                  >
                    <th className="py-2.5 px-4 whitespace-nowrap">资源类型</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">PID</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">用户</th>
                    <th className="py-2.5 px-4 whitespace-nowrap">进程名称</th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      GPU 显存占用
                    </th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      CPU%
                    </th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      系统内存%
                    </th>
                    <th className="py-2.5 px-4 text-right whitespace-nowrap">
                      持续时间
                    </th>
                    <th className="py-2.5 px-4 whitespace-nowrap">启动命令摘要</th>
                  </tr>
                </thead>
                <tbody
                  className={`divide-y text-xs font-mono tabular-nums ${
                    isDark ? 'divide-slate-800/70' : 'divide-slate-100'
                  }`}
                >
                  {visibleProcesses.map((proc: ActiveProcessItem) => (
                    <tr
                      key={`${proc.source}-${proc.pid}-${proc.gpuIndex ?? 'cpu'}`}
                      className={
                        isDark
                          ? 'hover:bg-slate-800/40 transition-colors'
                          : 'hover:bg-slate-50 transition-colors'
                      }
                    >
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {proc.source === 'gpu' ? (
                          <span className="text-emerald-400 font-medium">
                            GPU {proc.gpuIndex ?? 0}
                          </span>
                        ) : (
                          <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                            CPU / RAM
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-2.5 px-4 whitespace-nowrap ${
                          isDark ? 'text-slate-300' : 'text-slate-700'
                        }`}
                      >
                        {proc.pid}
                      </td>
                      <td
                        className={`py-2.5 px-4 whitespace-nowrap font-sans font-medium ${
                          isDark ? 'text-slate-200' : 'text-slate-800'
                        }`}
                      >
                        {proc.user}
                      </td>
                      <td
                        className={`py-2.5 px-4 whitespace-nowrap font-semibold ${
                          isDark ? 'text-slate-100' : 'text-slate-900'
                        }`}
                      >
                        {proc.processName}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {proc.gpuMemoryMiB !== null ? (
                          <span
                            className={`font-semibold ${
                              isDark ? 'text-amber-300' : 'text-amber-700'
                            }`}
                          >
                            {(proc.gpuMemoryMiB / 1024).toFixed(2)} GB ({proc.gpuMemoryMiB} MiB)
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right whitespace-nowrap ${
                          isDark ? 'text-slate-200' : 'text-slate-700'
                        }`}
                      >
                        {proc.cpuPercent !== null ? `${proc.cpuPercent.toFixed(1)}%` : '—'}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right whitespace-nowrap ${
                          isDark ? 'text-slate-200' : 'text-slate-700'
                        }`}
                      >
                        {proc.memPercent !== null ? `${proc.memPercent.toFixed(1)}%` : '—'}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right whitespace-nowrap ${
                          isDark ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        {proc.elapsedTime || '—'}
                      </td>
                      <td
                        className={`py-2.5 px-4 max-w-md ${
                          isDark ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate" title={proc.command}>
                            {proc.command}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyCommand(proc.pid, proc.command)}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono shrink-0 border transition-colors ${
                              copiedPid === proc.pid
                                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 font-semibold'
                                : isDark
                                ? 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                                : 'bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
                            }`}
                            title="复制完整启动命令行"
                          >
                            {copiedPid === proc.pid ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredProcesses.length > 5 && (
              <div
                className={`px-4 py-2.5 border-t flex items-center justify-between ${
                  isDark ? 'border-slate-800 bg-slate-900/20' : 'border-slate-100 bg-slate-50/50'
                }`}
              >
                <span
                  className={`text-xs ${
                    isDark ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  当前显示 {visibleProcesses.length} / {filteredProcesses.length} 个活跃进程
                </span>
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isDark
                      ? 'text-emerald-400 hover:text-emerald-300'
                      : 'text-emerald-700 hover:text-emerald-800'
                  }`}
                >
                  {expanded ? (
                    <>
                      <span>收起列表</span>
                      <ChevronUp className="w-3.5 h-3.5" />
                    </>
                  ) : (
                    <>
                      <span>查看更多进程 (全部 {filteredProcesses.length} 项)</span>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
