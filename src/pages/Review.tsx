import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { getChainReviewStats, getFailureDebugSummary, getPrecedentReviewList } from '../lib/db';
import { formatProtocolDateTime } from '../lib/protocolEvents';
import type { ChainReviewStats, FailureDebugSummary, PrecedentReviewItem } from '../types';

// 图表配色（匹配 CSS 变量：--success / --danger / --gold）
const CHART_COLORS = {
  completed: '#6ba882',
  failed: '#b8544a',
  precedent: '#df9a3c',
  fulfilled: '#6ba882',
};

interface DonutDataItem {
  name: string;
  value: number;
  colorKey: keyof typeof CHART_COLORS;
}

interface ChainDerivedStats {
  chain: ChainReviewStats;
  donutData: DonutDataItem[];
  mainSuccess: number;
  mainFailures: number;
  auxiliarySuccess: number;
  auxiliaryFailures: number;
  precedentCount: number;
  totalActions: number;
  successCount: number;
  failureCount: number;
  completionRate: number | null;
  failureRate: number | null;
  riskScore: number;
  riskTone: 'stable' | 'watch' | 'high';
}

interface ChainReviewSummary {
  totalActions: number;
  successCount: number;
  failureCount: number;
  precedentCount: number;
  completionRate: number | null;
  riskiest: ChainDerivedStats | null;
  steadiest: ChainDerivedStats | null;
}

type ReviewTab = 'chains' | 'failures' | 'precedents';
type TimePeriod = 'all' | '7d' | '30d' | 'month';

/** 构建本地时间的 since 字符串，避免 UTC 偏移导致日期不符合直觉 */
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
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
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

const REVIEW_HINT =
  'History 展示协议事件时间线，Review 聚焦失败模式、协议边界变化和链稳定性。';

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

  const [chainStats, setChainStats] = useState<ChainReviewStats[]>([]);
  const [failureSummary, setFailureSummary] = useState<FailureDebugSummary[]>([]);
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
    <div className="page review-page">
      <div className="review-hero">
        <div className="page-title-block">
          <h2>协议复盘</h2>
          <p className="page-subtitle">{REVIEW_HINT}</p>
        </div>
      </div>

      <div className="review-controls control-card">
        <div className="review-control-group">
          <span className="review-control-label">复盘模式</span>
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
        </div>

        <div className="review-control-group">
          <span className="review-control-label">时间范围</span>
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
      </div>

      {loading ? (
        <div className="review-loading">
          <p className="placeholder-text">正在汇总复盘数据...</p>
        </div>
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

function formatPercent(value: number | null): string {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

function riskToneFromScore(riskScore: number, failureRate: number | null): ChainDerivedStats['riskTone'] {
  if (riskScore >= 4 || (failureRate !== null && failureRate >= 0.35)) return 'high';
  if (riskScore > 0 || (failureRate !== null && failureRate >= 0.15)) return 'watch';
  return 'stable';
}

function riskLabel(tone: ChainDerivedStats['riskTone']): string {
  if (tone === 'high') return '高风险';
  if (tone === 'watch') return '关注';
  return '稳定';
}

function deriveChainStats(c: ChainReviewStats): ChainDerivedStats {
  const mainSuccess = c.completed_count;
  const mainFailures = c.failed_reset_count + c.failed_precedent_count;
  const auxiliarySuccess = c.reservation_fulfilled_count;
  const auxiliaryFailures = c.reservation_failed_reset_count + c.reservation_failed_precedent_count;
  const precedentCount = c.failed_precedent_count + c.reservation_failed_precedent_count;
  const successCount = mainSuccess + auxiliarySuccess;
  const failureCount = mainFailures + auxiliaryFailures;
  const totalActions = successCount + failureCount;
  const completionRate = totalActions > 0 ? successCount / totalActions : null;
  const failureRate = totalActions > 0 ? failureCount / totalActions : null;
  const riskScore = failureCount * 2 + precedentCount;

  const donutData: DonutDataItem[] = [
    { name: '主链完成', value: mainSuccess, colorKey: 'completed' as const },
    { name: '主链失败', value: mainFailures, colorKey: 'failed' as const },
    { name: '辅助链完成', value: auxiliarySuccess, colorKey: 'fulfilled' as const },
    { name: '辅助链失败', value: auxiliaryFailures, colorKey: 'precedent' as const },
  ].filter((d) => d.value > 0);

  return {
    chain: c,
    donutData,
    mainSuccess,
    mainFailures,
    auxiliarySuccess,
    auxiliaryFailures,
    precedentCount,
    totalActions,
    successCount,
    failureCount,
    completionRate,
    failureRate,
    riskScore,
    riskTone: riskToneFromScore(riskScore, failureRate),
  };
}

function summarizeChains(chains: ChainDerivedStats[]): ChainReviewSummary {
  const totalActions = chains.reduce((sum, item) => sum + item.totalActions, 0);
  const successCount = chains.reduce((sum, item) => sum + item.successCount, 0);
  const failureCount = chains.reduce((sum, item) => sum + item.failureCount, 0);
  const precedentCount = chains.reduce((sum, item) => sum + item.precedentCount, 0);
  const completionRate = totalActions > 0 ? successCount / totalActions : null;
  const active = chains.filter((item) => item.totalActions > 0);

  const riskiest = active.reduce<ChainDerivedStats | null>((best, item) => {
    if (!best) return item;
    if (item.riskScore !== best.riskScore) return item.riskScore > best.riskScore ? item : best;
    if ((item.failureRate ?? 0) !== (best.failureRate ?? 0)) {
      return (item.failureRate ?? 0) > (best.failureRate ?? 0) ? item : best;
    }
    return item.totalActions > best.totalActions ? item : best;
  }, null);

  const steadiest = active.reduce<ChainDerivedStats | null>((best, item) => {
    if (!best) return item;
    if ((item.completionRate ?? 0) !== (best.completionRate ?? 0)) {
      return (item.completionRate ?? 0) > (best.completionRate ?? 0) ? item : best;
    }
    return item.totalActions > best.totalActions ? item : best;
  }, null);

  return {
    totalActions,
    successCount,
    failureCount,
    precedentCount,
    completionRate,
    riskiest,
    steadiest,
  };
}

function sortChainsByReviewPriority(chains: ChainDerivedStats[]): ChainDerivedStats[] {
  return [...chains].sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    if ((b.failureRate ?? -1) !== (a.failureRate ?? -1)) return (b.failureRate ?? -1) - (a.failureRate ?? -1);
    if (b.totalActions !== a.totalActions) return b.totalActions - a.totalActions;
    return a.chain.chain_name.localeCompare(b.chain.chain_name, 'zh-Hans-CN');
  });
}

function ChainsSummary({ summary }: { summary: ChainReviewSummary }) {
  return (
    <div className="review-chain-summary">
      <div className="review-summary-grid">
        <ReviewSummaryMetric label="总事件" value={summary.totalActions} detail="主链与辅助链合计" />
        <ReviewSummaryMetric
          label="完成率"
          value={formatPercent(summary.completionRate)}
          detail={`${summary.successCount} 次完成`}
          tone="positive"
        />
        <ReviewSummaryMetric
          label="失败"
          value={summary.failureCount}
          detail="断链、违约与判例化"
          tone={summary.failureCount > 0 ? 'negative' : 'neutral'}
        />
        <ReviewSummaryMetric label="判例" value={summary.precedentCount} detail="正式边界变化" tone="neutral" />
      </div>

      <div className="review-insight-strip">
        {summary.riskiest ? (
          <span title={`风险：${riskLabel(summary.riskiest.riskTone)}`}>
            优先复盘：<strong>{summary.riskiest.chain.chain_name}</strong>，失败 {summary.riskiest.failureCount} 次，判例{' '}
            {summary.riskiest.precedentCount} 条
          </span>
        ) : (
          <span>当前范围暂无可分析事件。</span>
        )}
        {summary.steadiest && summary.steadiest.successCount > 0 && (
          <span>
            稳定表现：<strong>{summary.steadiest.chain.chain_name}</strong>，完成率{' '}
            {formatPercent(summary.steadiest.completionRate)}
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewSummaryMetric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className={`review-summary-metric review-summary-metric-${tone}`}>
      <span className="review-summary-metric-label">{label}</span>
      <strong className="review-summary-metric-value">{value}</strong>
      <span className="review-summary-metric-detail">{detail}</span>
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
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">暂无复盘数据</p>
          <p className="empty-desc">完成主链任务、辅助链履约和裁决后，复盘数据会出现在这里。</p>
        </div>
      </div>
    );
  }

  const derivedStats = stats.map(deriveChainStats);
  const sortedStats = sortChainsByReviewPriority(derivedStats);
  const summary = summarizeChains(derivedStats);

  return (
    <>
      <ChainsSummary summary={summary} />
      <div className="review-chain-list">
        {sortedStats.map((item) => {
          const c = item.chain;
          const chartData: DonutDataItem[] =
            item.donutData.length > 0 ? item.donutData : [{ name: '暂无事件', value: 1, colorKey: 'completed' }];
          const hasChartEvents = item.donutData.length > 0;

          return (
            <div key={c.chain_id} className="review-chain-card">
              <div className="review-chain-head">
                <div className="review-chain-title">
                  <span className="review-chain-kicker">主链</span>
                  <button
                    className="review-chain-name"
                    onClick={() => navigate(`/chains/${c.chain_id}`)}
                  >
                    {c.chain_name}
                  </button>
                </div>
                <div className="review-chain-status-row">
                  <span className="review-chain-rate">完成率 {formatPercent(item.completionRate)}</span>
                  <span className={`review-risk-badge review-risk-${item.riskTone}`}>{riskLabel(item.riskTone)}</span>
                  <span className={`status-badge ${c.status === 'active' ? 'status-active' : 'status-archived'}`}>
                    {c.status === 'active' ? '活跃' : '已归档'}
                  </span>
                </div>
              </div>

              <div className="review-chain-body">
                <div className="review-chain-donut">
                  <PieChart width={120} height={120}>
                    <Pie
                      data={chartData}
                      cx={60}
                      cy={60}
                      innerRadius={28}
                      outerRadius={52}
                      paddingAngle={0}
                      dataKey="value"
                      stroke="none"
                    >
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={hasChartEvents ? CHART_COLORS[entry.colorKey] : '#252528'} />
                      ))}
                    </Pie>
                    {hasChartEvents && (
                      <Tooltip
                        contentStyle={{
                          background: '#131316',
                          border: '1px solid #252528',
                          borderRadius: 6,
                          fontSize: 12,
                          color: '#f0ede6',
                        }}
                        formatter={(value, name) => [`${value} 次`, name]}
                      />
                    )}
                  </PieChart>
                  <span className="review-donut-total">
                    <strong>{item.totalActions}</strong>
                    <span>总事件</span>
                  </span>
                </div>

                <div className="review-chart-legend" aria-label={`${c.chain_name} 事件分布`}>
                  <ReviewLegendItem color="completed" label="主链完成" value={item.mainSuccess} />
                  <ReviewLegendItem color="failed" label="主链失败" value={item.mainFailures} />
                  <ReviewLegendItem color="fulfilled" label="辅助完成" value={item.auxiliarySuccess} />
                  <ReviewLegendItem color="precedent" label="辅助失败" value={item.auxiliaryFailures} />
                </div>

                <div className="review-chain-metrics">
                  <div className="review-metric-group">
                    <span className="review-metric-group-label">主链</span>
                    <div className="review-metric-row">
                      <ReviewMetric label="正式任务完成" value={c.completed_count} tone="positive" />
                      <ReviewMetric label="链条断裂" value={c.failed_reset_count} tone="negative" />
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
            </div>
          );
        })}
      </div>
    </>
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

function ReviewLegendItem({
  color,
  label,
  value,
}: {
  color: keyof typeof CHART_COLORS;
  label: string;
  value: number;
}) {
  return (
    <span className="review-legend-item">
      <span className="review-legend-dot" style={{ background: CHART_COLORS[color] }} />
      <span className="review-legend-label">{label}</span>
      <strong>{value}</strong>
    </span>
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
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">暂无失败记录</p>
          <p className="empty-desc">
            {period === 'all'
              ? '完成主链失败裁决或辅助链违约裁决并填写调试分类后，失败模式数据会出现在这里。'
              : '当前时间范围内没有失败记录。尝试扩大时间范围。'}
          </p>
        </div>
      </div>
    );
  }

  const totalFailures = summary.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="review-failure-layout">
      <div className="review-summary-card">
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

            <div className="review-failure-meta">
              {item.last_occurred_at && (
                <span className="review-failure-last">
                  最近发生：{formatProtocolDateTime(item.last_occurred_at)}
                </span>
              )}
              {item.chain_names.length > 0 && (
                <span className="review-failure-chains">
                  涉及主链：{item.chain_names.join('、')}
                </span>
              )}
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

            <div className="review-failure-prompt">
              建议检查该链的触发动作、完成条件或辅助链配置。
            </div>
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
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">暂无判例</p>
          <p className="empty-desc">
            {period === 'all'
              ? '在失败裁决中判例化后，判例会出现在这里。判例是协议的正式边界。'
              : '当前时间范围内没有判例。尝试扩大时间范围。'}
          </p>
        </div>
      </div>
    );
  }

  const activeCount = list.filter((p) => p.status === 'active').length;
  const retiredCount = list.length - activeCount;

  return (
    <div className="review-precedent-layout">
      <div className="review-summary-card">
        <span>
          共 <strong>{list.length}</strong> 条判例（生效 <strong>{activeCount}</strong>，废止 <strong>{retiredCount}</strong>）
        </span>
      </div>

      <p className="review-precedent-legend">
        <strong>生效中 (Active)</strong> 的判例仍定义当前协议边界，表示同类情形默认允许。
        <strong>已废止 (Retired)</strong> 的判例保留历史记录，但不再作为当前协议边界生效。
      </p>

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
