import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getChainReviewStats, getFailureDebugSummary, getPrecedentReviewList } from '../lib/db';
import { formatProtocolDateTime } from '../lib/protocolEvents';
import type { ChainReviewStats, FailureDebugSummary, PrecedentReviewItem } from '../types';

type ReviewTab = 'chains' | 'failures' | 'precedents';
type TimePeriod = 'all' | '7d' | '30d' | 'month';

function sinceFromPeriod(period: TimePeriod): string | null {
  if (period === 'all') return null;
  const now = new Date();
  if (period === '7d') {
    now.setDate(now.getDate() - 7);
  } else if (period === '30d') {
    now.setDate(now.getDate() - 30);
  } else if (period === 'month') {
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
  }
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

const PERIOD_LABELS: Record<TimePeriod, string> = {
  all: '全部',
  '7d': '最近 7 天',
  '30d': '最近 30 天',
  month: '本月',
};

const TABS: { key: ReviewTab; label: string }[] = [
  { key: 'chains', label: '按主链复盘' },
  { key: 'failures', label: '失败模式复盘' },
  { key: 'precedents', label: '判例复盘' },
];

function scopeLabel(scope: string): string {
  return scope === 'main_chain' ? '主链' : '辅助链';
}

function statusBadge(status: string): { label: string; className: string } {
  if (status === 'active') return { label: '生效中', className: 'status-active' };
  return { label: '已废止', className: 'status-archived' };
}

export default function Review() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ReviewTab>('chains');
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [loading, setLoading] = useState(true);

  // Chains review
  const [chainStats, setChainStats] = useState<ChainReviewStats[]>([]);

  // Failures review
  const [failureSummary, setFailureSummary] = useState<FailureDebugSummary[]>([]);

  // Precedents review
  const [precedentList, setPrecedentList] = useState<PrecedentReviewItem[]>([]);

  useEffect(() => {
    setLoading(true);
    const since = sinceFromPeriod(period);

    if (tab === 'chains') {
      getChainReviewStats(since)
        .then(setChainStats)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else if (tab === 'failures') {
      getFailureDebugSummary(since)
        .then(setFailureSummary)
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      getPrecedentReviewList(since)
        .then(setPrecedentList)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [tab, period]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>协议复盘</h2>
      </div>

      <div className="review-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`review-tab ${tab === t.key ? 'review-tab-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="review-period-bar">
        <span className="review-period-label">时间范围</span>
        <div className="review-period-options">
          {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((p) => (
            <button
              key={p}
              className={`review-period-btn ${period === p ? 'review-period-active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="placeholder-text">加载中...</p>
      ) : (
        <>
          {tab === 'chains' && <ChainsReview stats={chainStats} navigate={navigate} />}
          {tab === 'failures' && <FailuresReview summary={failureSummary} period={period} />}
          {tab === 'precedents' && <PrecedentsReview list={precedentList} navigate={navigate} period={period} />}
        </>
      )}
    </div>
  );
}

function ChainsReview({
  stats,
  navigate,
}: {
  stats: ChainReviewStats[];
  navigate: (to: string) => void;
}) {
  if (stats.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">暂无数据</p>
        <p className="empty-desc">完成主链任务、辅助链履约和裁决后，复盘数据会出现在这里。</p>
      </div>
    );
  }

  return (
    <div className="review-chain-list">
      {stats.map((c) => (
        <div key={c.chain_id} className="review-chain-card">
          <div className="review-chain-head">
            <button
              className="history-chain-link"
              onClick={() => navigate(`/chains/${c.chain_id}`)}
            >
              {c.chain_name}
            </button>
            <span className={`status-badge ${c.status === 'active' ? 'status-active' : 'status-archived'}`}>
              {c.status === 'active' ? '活跃' : '已归档'}
            </span>
          </div>

          <div className="review-chain-metrics">
            <div className="review-metric-group">
              <span className="review-metric-group-label">主链</span>
              <div className="review-metric-row">
                <ReviewMetric label="正式任务完成" value={c.completed_count} tone="positive" />
                <ReviewMetric label="失败清零" value={c.failed_reset_count} tone="negative" />
                <ReviewMetric label="判例化" value={c.failed_precedent_count} tone="neutral" />
              </div>
            </div>

            <div className="review-metric-group">
              <span className="review-metric-group-label">辅助链</span>
              <div className="review-metric-row">
                <ReviewMetric label="履约" value={c.reservation_fulfilled_count} tone="positive" />
                <ReviewMetric label="违约" value={c.reservation_failed_reset_count} tone="negative" />
                <ReviewMetric label="判例化" value={c.reservation_failed_precedent_count} tone="neutral" />
              </div>
            </div>

            <div className="review-metric-group">
              <span className="review-metric-group-label">长度</span>
              <div className="review-metric-row">
                <ReviewMetric label="当前主链" value={`${c.current_length} 节`} tone="neutral" />
                <ReviewMetric label="历史最佳主链" value={`${c.best_length} 节`} tone="positive" />
                <ReviewMetric label="当前辅助链" value={`${c.auxiliary_current_length} 节`} tone="neutral" />
                <ReviewMetric label="历史最佳辅助链" value={`${c.auxiliary_best_length} 节`} tone="positive" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReviewMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className={`review-metric review-metric-${tone}`}>
      <span className="review-metric-value">{value}</span>
      <span className="review-metric-label">{label}</span>
    </div>
  );
}

function FailuresReview({
  summary,
  period,
}: {
  summary: FailureDebugSummary[];
  period: TimePeriod;
}) {
  if (summary.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">暂无失败记录</p>
        <p className="empty-desc">
          {period === 'all'
            ? '完成主链失败裁决或辅助链违约裁决并填写调试分类后，失败模式数据会出现在这里。'
            : '当前时间范围内没有失败记录。尝试扩大时间范围。'}
        </p>
      </div>
    );
  }

  const totalFailures = summary.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="review-failure-layout">
      <div className="review-failure-summary">
        <span className="review-failure-total">
          共 <strong>{totalFailures}</strong> 次失败裁决
        </span>
        <span className="review-failure-hint">按失败分类聚合</span>
      </div>

      <div className="review-failure-list">
        {summary.map((item) => (
          <div key={item.category} className="review-failure-card">
            <div className="review-failure-head">
              <span className="review-failure-category">{item.category}</span>
              <span className="review-failure-count">{item.count} 次</span>
            </div>
            {item.recent_notes.length > 0 && (
              <div className="review-failure-notes">
                <span className="review-failure-notes-label">最近失败备注</span>
                {item.recent_notes.map((note, i) => (
                  <p key={i} className="review-failure-note">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PrecedentsReview({
  list,
  navigate,
  period,
}: {
  list: PrecedentReviewItem[];
  navigate: (to: string) => void;
  period: TimePeriod;
}) {
  if (list.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">暂无判例</p>
        <p className="empty-desc">
          {period === 'all'
            ? '在失败裁决中判例化后，判例会出现在这里。判例是协议的正式边界。'
            : '当前时间范围内没有判例。尝试扩大时间范围。'}
        </p>
      </div>
    );
  }

  const activeCount = list.filter((p) => p.status === 'active').length;
  const retiredCount = list.length - activeCount;

  return (
    <div className="review-precedent-layout">
      <div className="review-precedent-summary">
        <span>
          共 <strong>{list.length}</strong> 条判例（生效 <strong>{activeCount}</strong>，废止 <strong>{retiredCount}</strong>）
        </span>
      </div>

      <div className="precedents-list">
        {list.map((p) => {
          const badge = statusBadge(p.status);
          return (
            <div key={p.id} className="precedent-item review-precedent-item">
              <div className="precedent-item-header">
                <span className="precedent-item-title">
                  <span className="boundary-source">{scopeLabel(p.scope)}</span>
                  {p.title}
                </span>
                <div className="review-precedent-meta">
                  <span className={`formula-status ${badge.className}`}>{badge.label}</span>
                  <span className="precedent-item-time">{formatProtocolDateTime(p.created_at)}</span>
                </div>
              </div>
              <div className="review-precedent-info">
                <span className="review-precedent-chain">
                  所属链：
                  <button
                    className="history-chain-link"
                    onClick={() => navigate(`/chains/${p.chain_id}?precedent=${p.id}`)}
                  >
                    {p.chain_name}
                  </button>
                </span>
                <span className="review-precedent-session">
                  来源：{p.created_from_session_type === 'focus' ? '神圣座位' : '辅助链'} #
                  {p.created_from_session_id ?? '-'}
                </span>
              </div>
              {p.description && <p className="precedent-item-desc">{p.description}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
