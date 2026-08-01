import type { FormulaEvent } from '../types';

export function protocolEventTypeLabel(type: string): string {
  if (type === 'focus') return '主链';
  if (type === 'reservation') return '辅助链';
  return 'RSIP';
}

export function rsipSummaryEventLabel(type: string): string {
  if (type === 'created') return '定式创建';
  if (type === 'activated') return '定式点亮';
  if (type === 'deactivated') return '定式熄灭';
  if (type === 'rollback_child_deactivated') return '递归回滚';
  if (type === 'reparented') return '定式调整父节点';
  return type;
}

export function rsipTimelineEventLabel(type: string): string {
  if (type === 'created') return 'RSIP 定式创建';
  if (type === 'activated') return 'RSIP 定式点亮';
  if (type === 'deactivated') return 'RSIP 定式熄灭';
  if (type === 'rollback_child_deactivated') return 'RSIP 子定式回滚熄灭';
  if (type === 'reparented') return 'RSIP 定式调整父节点';
  return type;
}

export function formulaEventLabel(type: FormulaEvent['event_type']): string {
  if (type === 'created') return '加入定式树';
  if (type === 'activated') return '点亮';
  if (type === 'deactivated') return '熄灭';
  if (type === 'reparented') return '调整父节点';
  return '递归回滚';
}

export function formatProtocolDateTime(raw: string): string {
  return new Date(raw + 'Z').toLocaleString('zh-CN');
}

export function formatRelativeProtocolTime(raw: string): string {
  const date = new Date(raw + 'Z');
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
