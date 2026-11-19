import React, { useEffect, useState } from 'react';
import { Check, KeyRound, Lock, ShieldCheck, Sliders, X } from 'lucide-react';
import {
  LoadThresholds,
  MonitorSnapshot,
  SshConfigUpdateInput,
} from '../types/monitor';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab: 'ssh' | 'thresholds';
  snapshot: MonitorSnapshot;
  isDark: boolean;
  onClose: () => void;
  onSaveSshConfig: (input: SshConfigUpdateInput) => Promise<{ ok: boolean; error?: string }>;
  onSaveSettings: (params: {
    pollIntervalMs: number;
    thresholds: LoadThresholds;
  }) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab,
  snapshot,
  isDark,
  onClose,
  onSaveSshConfig,
  onSaveSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'ssh' | 'thresholds'>(initialTab);
  const [profiles, setProfiles] = useState<
    Array<{ alias: string; hostName: string; user: string; port: number; identityFile: string }>
  >([]);

  // SSH form state
  const [alias, setAlias] = useState(snapshot.sshConfig.alias);
  const [host, setHost] = useState(snapshot.sshConfig.host);
  const [port, setPort] = useState(String(snapshot.sshConfig.port || 22));
  const [username, setUsername] = useState(snapshot.sshConfig.username || 'ubuntu');
  const [authMethod, setAuthMethod] = useState<'privateKeyPath' | 'agent'>(
    snapshot.sshConfig.authMethod
  );
  const [privateKeyPath, setPrivateKeyPath] = useState(
    snapshot.sshConfig.privateKeyPathHint || '~/.ssh/id_ed25519'
  );
  const [passphrase, setPassphrase] = useState('');
  const [hostKeyPolicy, setHostKeyPolicy] = useState<
    'known_hosts' | 'pinned_fingerprint'
  >(snapshot.sshConfig.hostKeyPolicy);
  const [pinnedFingerprint, setPinnedFingerprint] = useState(
    snapshot.sshConfig.pinnedFingerprint || ''
  );
  const [knownHostsPath, setKnownHostsPath] = useState(
    snapshot.sshConfig.knownHostsPath || '~/.ssh/known_hosts'
  );

  // Thresholds & polling form state
  const [pollSeconds, setPollSeconds] = useState(
    String(Math.round(snapshot.pollIntervalMs / 1000))
  );
  const [gpuIdleMax, setGpuIdleMax] = useState(
    String(snapshot.thresholds.gpuIdleMaxPercent)
  );
  const [gpuBusyMin, setGpuBusyMin] = useState(
    String(snapshot.thresholds.gpuBusyMinPercent)
  );
  const [vramBusyMin, setVramBusyMin] = useState(
    String(snapshot.thresholds.vramBusyMinPercent)
  );
  const [cpuIdleMax, setCpuIdleMax] = useState(
    String(snapshot.thresholds.cpuIdleMaxPercent)
  );
  const [cpuBusyMin, setCpuBusyMin] = useState(
    String(snapshot.thresholds.cpuBusyMinPercent)
  );
  const [memBusyMin, setMemBusyMin] = useState(
    String(snapshot.thresholds.memBusyMinPercent)
  );

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setAlias(snapshot.sshConfig.alias);
      setHost(snapshot.sshConfig.host);
      setPort(String(snapshot.sshConfig.port || 22));
      setUsername(snapshot.sshConfig.username || 'ubuntu');
      setAuthMethod(snapshot.sshConfig.authMethod);
      setPrivateKeyPath(
        snapshot.sshConfig.privateKeyPathHint || '~/.ssh/id_ed25519'
      );
      setPassphrase('');
      setHostKeyPolicy(snapshot.sshConfig.hostKeyPolicy);
      setPinnedFingerprint(snapshot.sshConfig.pinnedFingerprint || '');
      setKnownHostsPath(
        snapshot.sshConfig.knownHostsPath || '~/.ssh/known_hosts'
      );

      setPollSeconds(String(Math.round(snapshot.pollIntervalMs / 1000)));
      setGpuIdleMax(String(snapshot.thresholds.gpuIdleMaxPercent));
      setGpuBusyMin(String(snapshot.thresholds.gpuBusyMinPercent));
      setVramBusyMin(String(snapshot.thresholds.vramBusyMinPercent));
      setCpuIdleMax(String(snapshot.thresholds.cpuIdleMaxPercent));
      setCpuBusyMin(String(snapshot.thresholds.cpuBusyMinPercent));
      setMemBusyMin(String(snapshot.thresholds.memBusyMinPercent));
      setFormError(null);
      setFormSuccess(null);

      fetch('/api/ssh-profiles')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setProfiles(data);
        })
        .catch(() => {});
    }
  }, [isOpen, initialTab, snapshot.sshConfig, snapshot.pollIntervalMs, snapshot.thresholds]);

  if (!isOpen) return null;

  const handleSshSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);
    try {
      const res = await onSaveSshConfig({
        alias: alias.trim() || 'Ubuntu-DL-Node-01',
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authMethod,
        privateKeyPath: privateKeyPath.trim(),
        passphrase: passphrase ? passphrase : undefined,
        hostKeyPolicy,
        pinnedFingerprint: pinnedFingerprint.trim(),
        knownHostsPath: knownHostsPath.trim(),
      });
      if (!res.ok) {
        setFormError(res.error || 'SSH 配置校验未通过');
      } else {
        setFormSuccess('SSH 配置已保存并触发连接检测');
        setTimeout(() => onClose(), 600);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleThresholdsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const pSec = Number(pollSeconds);
    const gIdle = Number(gpuIdleMax);
    const gBusy = Number(gpuBusyMin);
    const vBusy = Number(vramBusyMin);
    const cIdle = Number(cpuIdleMax);
    const cBusy = Number(cpuBusyMin);
    const mBusy = Number(memBusyMin);

    if (!Number.isFinite(pSec) || pSec < 2 || pSec > 60) {
      setFormError('采样间隔需在 2 秒至 60 秒之间');
      return;
    }
    if (gIdle >= gBusy) {
      setFormError('GPU 空闲上限必须小于 GPU 繁忙下限');
      return;
    }
    if (cIdle >= cBusy) {
      setFormError('CPU 空闲上限必须小于 CPU 繁忙下限');
      return;
    }

    setSubmitting(true);
    try {
      await onSaveSettings({
        pollIntervalMs: Math.round(pSec * 1000),
        thresholds: {
          gpuIdleMaxPercent: gIdle,
          gpuBusyMinPercent: gBusy,
          vramBusyMinPercent: vBusy,
          cpuIdleMaxPercent: cIdle,
          cpuBusyMinPercent: cBusy,
          memBusyMinPercent: mBusy,
          smoothingWindowSamples: snapshot.thresholds.smoothingWindowSamples,
        },
      });
      setFormSuccess('采样间隔与负载判定阈值已实时生效');
      setTimeout(() => onClose(), 500);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = `w-full px-3 py-2 text-xs rounded-lg border font-mono transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
    isDark
      ? 'bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500'
      : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
  }`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className={`w-full max-w-xl rounded-xl border shadow-xl overflow-hidden ${
          isDark
            ? 'bg-[#111827] border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            isDark ? 'border-slate-800' : 'border-slate-200'
          }`}
        >
          <h2 id="settings-modal-title" className="text-base font-semibold">
            服务器连接与监控配置
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭配置窗口"
            className={`p-1.5 rounded-lg transition-colors ${
              isDark
                ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div
          className={`flex border-b px-6 gap-6 ${
            isDark ? 'border-slate-800 bg-slate-900/30' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              setActiveTab('ssh');
              setFormError(null);
              setFormSuccess(null);
            }}
            className={`py-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
              activeTab === 'ssh'
                ? 'border-emerald-500 text-emerald-500'
                : isDark
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>SSH 连接与主机安全校验</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('thresholds');
              setFormError(null);
              setFormSuccess(null);
            }}
            className={`py-3 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
              activeTab === 'thresholds'
                ? 'border-emerald-500 text-emerald-500'
                : isDark
                ? 'border-transparent text-slate-400 hover:text-slate-200'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>采样间隔与空闲判定阈值</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 max-h-[78vh] overflow-y-auto">
          {formError && (
            <div className="mb-4 p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-400">
              {formError}
            </div>
          )}
          {formSuccess && (
            <div className="mb-4 p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-400 flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{formSuccess}</span>
            </div>
          )}

          {activeTab === 'ssh' ? (
            <form onSubmit={handleSshSubmit} className="space-y-4">
              {profiles.length > 0 && (
                <div
                  className={`p-3 rounded-lg border space-y-2 ${
                    isDark
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-emerald-500/40 bg-emerald-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-semibold ${
                        isDark ? 'text-emerald-400' : 'text-emerald-700'
                      }`}
                    >
                      从本地 ~/.ssh/config 识别到的服务器：
                    </span>
                    <span className="text-[11px] text-slate-400">点击一键填入</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {profiles.map((p) => (
                      <button
                        key={p.alias}
                        type="button"
                        onClick={() => {
                          setAlias(p.alias);
                          setHost(p.alias);
                          setPort(String(p.port || 22));
                          setUsername(p.user);
                          setPrivateKeyPath(p.identityFile || '~/.ssh/id_ed25519');
                          setAuthMethod('privateKeyPath');
                        }}
                        className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                          host === p.hostName || host === p.alias
                            ? 'bg-emerald-600 text-white border-emerald-500 font-semibold'
                            : isDark
                            ? 'bg-slate-800 text-slate-200 border-slate-700 hover:border-slate-500'
                            : 'bg-white text-slate-800 border-slate-300 hover:border-slate-400'
                        }`}
                      >
                        {p.alias}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    服务器显示别名
                  </label>
                  <input
                    type="text"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    placeholder="Ubuntu-DL-Node-01"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    SSH 主机地址或 ~/.ssh/config 别名 *
                  </label>
                  <input
                    type="text"
                    required
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="192.168.1.100 或 dl-server"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    登录用户名 *
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ubuntu"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    SSH 端口
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-800/60">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium">SSH 身份认证方式</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAuthMethod('privateKeyPath')}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        authMethod === 'privateKeyPath'
                          ? 'bg-emerald-600 text-white'
                          : isDark
                          ? 'bg-slate-800 text-slate-300'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      本地私钥路径
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMethod('agent')}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        authMethod === 'agent'
                          ? 'bg-emerald-600 text-white'
                          : isDark
                          ? 'bg-slate-800 text-slate-300'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      系统 SSH Agent
                    </button>
                  </div>
                </div>

                {authMethod === 'privateKeyPath' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1.5">
                        本地私钥文件路径
                      </label>
                      <input
                        type="text"
                        value={privateKeyPath}
                        onChange={(e) => setPrivateKeyPath(e.target.value)}
                        placeholder="~/.ssh/id_ed25519 或 C:\Users\me\.ssh\id_rsa"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5">
                        私钥口令 (Passphrase，可选)
                      </label>
                      <input
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder={
                          snapshot.sshConfig.hasPassphrase
                            ? '已设置（留空保持不变）'
                            : '仅保存在本地后端内存'
                        }
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Host Key Verification Security Section */}
              <div className="space-y-3 pt-2 border-t border-slate-800/60">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-xs font-semibold">
                    SSH 主机密钥验证策略（安全强制开启）
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1.5">
                      验证方式
                    </label>
                    <select
                      value={hostKeyPolicy}
                      onChange={(e) =>
                        setHostKeyPolicy(
                          e.target.value as 'known_hosts' | 'pinned_fingerprint'
                        )
                      }
                      className={inputClass}
                    >
                      <option value="known_hosts">
                        校验本地 known_hosts 文件 (推荐)
                      </option>
                      <option value="pinned_fingerprint">
                        固定服务器 SHA256 公钥指纹
                      </option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5">
                      信任的 SHA256 指纹（可选或固定校验必填）
                    </label>
                    <input
                      type="text"
                      value={pinnedFingerprint}
                      onChange={(e) => setPinnedFingerprint(e.target.value)}
                      placeholder="SHA256:xxxx..."
                      className={inputClass}
                    />
                  </div>
                </div>

                {snapshot.lastError?.observedFingerprint && (
                  <div
                    className={`p-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                      isDark
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    <span className="font-mono truncate">
                      最近检测到指纹：{snapshot.lastError.observedFingerprint}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setHostKeyPolicy('pinned_fingerprint');
                        setPinnedFingerprint(
                          snapshot.lastError?.observedFingerprint || ''
                        );
                      }}
                      className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
                    >
                      填入此指纹
                    </button>
                  </div>
                )}

                <div
                  className={`flex items-start gap-2 text-[11px] ${
                    isDark ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    安全承诺：本地后端仅读取私钥路径建立连接，绝不将私钥内容、口令返回给浏览器前端或写入日志。您也可直接在项目根目录配置{' '}
                    <code className="font-mono">.env</code> 文件。
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    isDark
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  {submitting ? '正在验证并连接...' : '保存并连接远程服务器'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleThresholdsSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5">
                  自动采样轮询间隔（秒，范围 2 ~ 60，默认 5 秒）
                </label>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={pollSeconds}
                  onChange={(e) => setPollSeconds(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    GPU 空闲上限 (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={gpuIdleMax}
                    onChange={(e) => setGpuIdleMax(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    GPU 繁忙下限 (%)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={99}
                    value={gpuBusyMin}
                    onChange={(e) => setGpuBusyMin(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    显存繁忙预警 (%)
                  </label>
                  <input
                    type="number"
                    min={20}
                    max={99}
                    value={vramBusyMin}
                    onChange={(e) => setVramBusyMin(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    CPU 空闲上限 (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={cpuIdleMax}
                    onChange={(e) => setCpuIdleMax(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    CPU 繁忙下限 (%)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={99}
                    value={cpuBusyMin}
                    onChange={(e) => setCpuBusyMin(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5">
                    系统内存繁忙下限 (%)
                  </label>
                  <input
                    type="number"
                    min={30}
                    max={99}
                    value={memBusyMin}
                    onChange={(e) => setMemBusyMin(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <p
                className={`text-xs leading-relaxed ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                判定逻辑说明：系统综合最近 {snapshot.thresholds.smoothingWindowSamples}{' '}
                个采样周期的平滑均值与 3% 迟滞缓冲区间（Hysteresis）计算服务器总体负载状态，避免指标在临界值附近时状态频繁跳变。
              </p>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-4 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    isDark
                      ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
                >
                  保存阈值设置
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
