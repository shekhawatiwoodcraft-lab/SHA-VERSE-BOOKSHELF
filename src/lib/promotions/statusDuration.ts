export type StatusDurationUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export const MIN_STATUS_DURATION_SECONDS = 5;

export function getDaysInCurrentMonth(referenceDate: Date = new Date()): number {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
}

export function toDurationMs(value: number, unit: StatusDurationUnit): number {
  const numeric = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  switch (unit) {
    case 'seconds':
      return Math.max(MIN_STATUS_DURATION_SECONDS, numeric) * 1000;
    case 'minutes':
      return numeric * 60 * 1000;
    case 'hours':
      return numeric * 60 * 60 * 1000;
    case 'days':
      return numeric * 24 * 60 * 60 * 1000;
  }
}

export function formatDurationLabel(value: number, unit: StatusDurationUnit): string {
  const safeValue =
    unit === 'seconds'
      ? Math.max(MIN_STATUS_DURATION_SECONDS, Math.floor(value || MIN_STATUS_DURATION_SECONDS))
      : Math.max(1, Math.floor(value || 1));
  const unitName = safeValue === 1 ? unit.slice(0, -1) : unit;
  return `${safeValue} ${unitName}`;
}

export function computeExpiresAt(durationMs: number, nowMs = Date.now()): string {
  const clamped = Math.max(MIN_STATUS_DURATION_SECONDS * 1000, durationMs);
  return new Date(nowMs + clamped).toISOString();
}

export function isStatusActive(expiresAt: string, nowMs = Date.now()): boolean {
  const ts = new Date(expiresAt).getTime();
  return Number.isFinite(ts) && ts > nowMs;
}

export function formatRemainingTime(expiresAt: string, nowMs = Date.now()): string {
  const diffMs = Math.max(0, new Date(expiresAt).getTime() - nowMs);
  const secs = Math.ceil(diffMs / 1000);
  if (secs < 60) return `${secs}s left`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m left` : `${hrs}h left`;
  }
  const days = Math.floor(hrs / 24);
  return `${days}d left`;
}
