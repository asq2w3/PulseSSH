export function formatBytesToGb(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1000) {
    return `${(gb / 1024).toFixed(2)} TB`;
  }
  return `${gb.toFixed(digits)} GB`;
}

export function formatMiBToGb(mib: number | null | undefined, digits = 1): string {
  if (mib === null || mib === undefined || !Number.isFinite(mib)) return '—';
  const gb = mib / 1024;
  return `${gb.toFixed(digits)} GB`;
}

export function formatPercent(val: number | null | undefined, digits = 1): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '不可用';
  return `${val.toFixed(digits)}%`;
}

export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '尚未采集';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const totalSec = Math.floor(seconds);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) {
    return `${days}天 ${hours}小时 ${mins}分`;
  }
  if (hours > 0) {
    return `${hours}小时 ${mins}分 ${secs}秒`;
  }
  if (mins > 0) {
    return `${mins}分 ${secs}秒`;
  }
  return `${secs}秒`;
}
