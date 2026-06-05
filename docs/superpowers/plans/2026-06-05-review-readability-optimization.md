# Review Readability Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the `Review` page so users can read the selected period at a glance, spot risky chains first, and then inspect per-chain chart details.

**Architecture:** Keep all review data sourced from the existing Tauri commands and derive readability metrics in the React layer. Add small pure helper functions in `src/pages/Review.tsx`, then render a summary strip above the chain cards and sort cards by derived risk.

**Tech Stack:** React 19, TypeScript 6, Vite, Tauri API wrappers, Recharts 2, existing Corona CSS system in `src/styles/global.css`.

---

## File Structure

- Modify `src/pages/Review.tsx`
  - Add pure derived metric types and helpers near the existing chart constants.
  - Change `ChainsReview` to calculate summary data, render the summary section, and sort enriched chain rows.
  - Change loading and empty copy for clearer current-period feedback.
- Modify `src/styles/global.css`
  - Extend only the `/* ===== Review Page ===== */` section.
  - Add responsive styles for summary cards, insight strip, chart legend, risk badges, and narrow layouts.
- Verification commands
  - `npm run typecheck`
  - `npm run lint`
  - Browser/Tauri visual pass on `/review`

---

### Task 1: Add Derived Review Metrics

**Files:**
- Modify: `src/pages/Review.tsx`

- [ ] **Step 1: Add derived metric types below `DonutDataItem`**

Add this code immediately after the `DonutDataItem` interface:

```ts
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
```

- [ ] **Step 2: Replace `buildChainDonutData` with derived helpers**

Replace the existing `buildChainDonutData` function with:

```ts
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
    { name: '主链完成', value: mainSuccess, colorKey: 'completed' },
    { name: '主链失败', value: mainFailures, colorKey: 'failed' },
    { name: '辅助链完成', value: auxiliarySuccess, colorKey: 'fulfilled' },
    { name: '辅助链失败', value: auxiliaryFailures, colorKey: 'precedent' },
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
```

- [ ] **Step 3: Run typecheck for helper syntax**

Run:

```bash
npm run typecheck
```

Expected: TypeScript may still report unrelated existing issues if present, but there must be no syntax or type errors pointing to the new helper names.

---

### Task 2: Render the Chain Summary Section

**Files:**
- Modify: `src/pages/Review.tsx`

- [ ] **Step 1: Change the loading copy**

In the main `Review` component, change:

```tsx
<p className="placeholder-text">加载中...</p>
```

to:

```tsx
<p className="placeholder-text">正在汇总复盘数据...</p>
```

- [ ] **Step 2: Add `ChainsSummary` before `ChainsReview`**

Insert this component above `function ChainsReview`:

```tsx
function ChainsSummary({ summary }: { summary: ChainReviewSummary }) {
  return (
    <div className="review-chain-summary">
      <div className="review-summary-grid">
        <ReviewSummaryMetric label="总事件" value={summary.totalActions} detail="主链与辅助链合计" />
        <ReviewSummaryMetric label="完成率" value={formatPercent(summary.completionRate)} detail={`${summary.successCount} 次完成`} tone="positive" />
        <ReviewSummaryMetric label="失败" value={summary.failureCount} detail="断链、违约与判例化" tone={summary.failureCount > 0 ? 'negative' : 'neutral'} />
        <ReviewSummaryMetric label="判例" value={summary.precedentCount} detail="正式边界变化" tone="neutral" />
      </div>

      <div className="review-insight-strip">
        {summary.riskiest ? (
          <span>
            优先复盘：
            <strong>{summary.riskiest.chain.chain_name}</strong>
            ，失败 {summary.riskiest.failureCount} 次，判例 {summary.riskiest.precedentCount} 条
          </span>
        ) : (
          <span>当前范围暂无可分析事件。</span>
        )}
        {summary.steadiest && (
          <span>
            稳定表现：
            <strong>{summary.steadiest.chain.chain_name}</strong>
            ，完成率 {formatPercent(summary.steadiest.completionRate)}
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
```

- [ ] **Step 3: Wire summary into `ChainsReview`**

At the start of `ChainsReview`, after the empty-state guard, add:

```tsx
  const derivedStats = stats.map(deriveChainStats);
  const sortedStats = sortChainsByReviewPriority(derivedStats);
  const summary = summarizeChains(derivedStats);
```

Then change the returned wrapper from:

```tsx
return (
  <div className="review-chain-list">
    {stats.map((c) => {
```

to:

```tsx
return (
  <>
    <ChainsSummary summary={summary} />
    <div className="review-chain-list">
      {sortedStats.map((item) => {
        const c = item.chain;
```

At the end of the component, close the fragment:

```tsx
    </div>
  </>
);
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: no TypeScript errors in `src/pages/Review.tsx`.

---

### Task 3: Improve Chain Card Readability

**Files:**
- Modify: `src/pages/Review.tsx`

- [ ] **Step 1: Use the derived chart fields in the card map**

Inside the `sortedStats.map((item) => { ... })` block, remove these old local lines:

```tsx
const donutData = buildChainDonutData(c);
const totalActions = donutData.reduce((s, d) => s + d.value, 0);
```

Use `item.donutData` and `item.totalActions` instead.

- [ ] **Step 2: Add completion and risk metadata to the card header**

Replace the current status badge block:

```tsx
<span className={`status-badge ${c.status === 'active' ? 'status-active' : 'status-archived'}`}>
  {c.status === 'active' ? '活跃' : '已归档'}
</span>
```

with:

```tsx
<div className="review-chain-status-row">
  <span className="review-chain-rate">完成率 {formatPercent(item.completionRate)}</span>
  <span className={`review-risk-badge review-risk-${item.riskTone}`}>{riskLabel(item.riskTone)}</span>
  <span className={`status-badge ${c.status === 'active' ? 'status-active' : 'status-archived'}`}>
    {c.status === 'active' ? '活跃' : '已归档'}
  </span>
</div>
```

- [ ] **Step 3: Make the donut robust for zero-event chains**

Replace:

```tsx
<PieChart width={120} height={120}>
  <Pie
    data={donutData}
```

with:

```tsx
<PieChart width={120} height={120}>
  <Pie
    data={item.donutData.length > 0 ? item.donutData : [{ name: '暂无事件', value: 1, colorKey: 'completed' }]}
```

Replace:

```tsx
{donutData.map((entry, i) => (
  <Cell key={i} fill={CHART_COLORS[entry.colorKey]} />
))}
```

with:

```tsx
{(item.donutData.length > 0 ? item.donutData : [{ name: '暂无事件', value: 1, colorKey: 'completed' as const }]).map((entry, i) => (
  <Cell key={i} fill={item.donutData.length > 0 ? CHART_COLORS[entry.colorKey] : '#252528'} />
))}
```

Replace:

```tsx
<span className="review-donut-total">{totalActions}</span>
```

with:

```tsx
<span className="review-donut-total">
  <strong>{item.totalActions}</strong>
  <span>总事件</span>
</span>
```

- [ ] **Step 4: Add a chart legend**

Immediately after the closing `</div>` for `review-chain-donut`, add:

```tsx
<div className="review-chart-legend" aria-label={`${c.chain_name} 事件分布`}>
  <ReviewLegendItem color="completed" label="主链完成" value={item.mainSuccess} />
  <ReviewLegendItem color="failed" label="主链失败" value={item.mainFailures} />
  <ReviewLegendItem color="fulfilled" label="辅助完成" value={item.auxiliarySuccess} />
  <ReviewLegendItem color="precedent" label="辅助失败" value={item.auxiliaryFailures} />
</div>
```

Add this component below `ReviewMetric`:

```tsx
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
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: no TypeScript errors in `src/pages/Review.tsx`.

---

### Task 4: Add Review Readability Styles

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add summary and insight styles after `.review-empty-card .empty-state`**

Add:

```css
.review-chain-summary {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}

.review-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.review-summary-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
}

.review-summary-metric-positive {
  border-color: rgba(107, 168, 130, 0.22);
}

.review-summary-metric-negative {
  border-color: rgba(184, 84, 74, 0.25);
}

.review-summary-metric-label,
.review-summary-metric-detail {
  font-size: 11px;
  color: var(--text-muted);
}

.review-summary-metric-value {
  font-size: 24px;
  line-height: 1.1;
  font-family: var(--font-display);
  color: var(--text-primary);
}

.review-insight-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 11px 14px;
  border: 1px solid var(--gold-border);
  border-left: 3px solid var(--gold);
  border-radius: var(--radius-sm);
  background: var(--gold-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.review-insight-strip strong {
  color: var(--text-primary);
  font-weight: 600;
}
```

- [ ] **Step 2: Add card header, risk, and legend styles after `.review-chain-head`**

Add:

```css
.review-chain-status-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
}

.review-chain-rate {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.review-risk-badge {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.review-risk-stable {
  color: var(--success);
  background: var(--success-subtle);
  border-color: rgba(107, 168, 130, 0.2);
}

.review-risk-watch {
  color: var(--warning);
  background: var(--warning-subtle);
  border-color: rgba(201, 138, 70, 0.2);
}

.review-risk-high {
  color: var(--danger);
  background: var(--danger-subtle);
  border-color: rgba(184, 84, 74, 0.2);
}
```

Add after `.review-donut-total`:

```css
.review-donut-total {
  flex-direction: column;
  gap: 1px;
}

.review-donut-total strong {
  font-size: 22px;
  line-height: 1;
}

.review-donut-total span {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.2;
}

.review-chart-legend {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  width: 128px;
  flex-shrink: 0;
}

.review-legend-item {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-height: 24px;
  font-size: 11px;
  color: var(--text-secondary);
}

.review-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.review-legend-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-legend-item strong {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-weight: 600;
}
```

- [ ] **Step 3: Add responsive styles near existing review media query**

Before the existing `@media (max-width: 1080px)` block or inside it, add:

```css
@media (max-width: 1080px) {
  .review-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-chain-body {
    display: grid;
    grid-template-columns: 120px minmax(120px, 160px) minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .review-summary-grid {
    grid-template-columns: 1fr;
  }

  .review-chain-head,
  .review-chain-body {
    display: flex;
    flex-direction: column;
  }

  .review-chain-status-row {
    justify-content: flex-start;
  }

  .review-chart-legend {
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

If this duplicates the current `@media (max-width: 1080px)` selector, merge the new rules into the existing block instead of creating two adjacent identical blocks.

- [ ] **Step 4: Run lint after CSS changes**

Run:

```bash
npm run lint
```

Expected: no lint errors introduced by `Review.tsx`.

---

### Task 5: Final Verification

**Files:**
- Verify: `src/pages/Review.tsx`
- Verify: `src/styles/global.css`

- [ ] **Step 1: Run full frontend checks**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both commands complete successfully. If either command reports pre-existing unrelated failures, record the exact failure and confirm no failure points to the Review readability changes.

- [ ] **Step 2: Open the Review page**

Run the local app in the normal project workflow:

```bash
npm run dev -- --host 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5173/review
```

Expected visual behavior in a Tauri-capable app session:

- “按主链复盘” shows a summary section above chain cards when data exists.
- Chain cards are sorted with risky chains first.
- Each chain card header shows completion rate, risk badge, and archive/active status.
- The donut center shows total event count with the “总事件” label.
- The legend makes chart colors understandable without hovering.
- Empty ranges show the existing empty card with clearer copy.

- [ ] **Step 3: Check responsive widths**

Use browser widths around 1080px and 720px.

Expected:

- Around 1080px, summary cards wrap to two columns and chain metrics remain readable.
- Around 720px, chain card header, donut, legend, and metrics stack vertically.
- No button, badge, chart label, or metric text overlaps another element.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff -- src/pages/Review.tsx src/styles/global.css
```

Expected:

- Diff only implements derived metrics, summary UI, chain card readability, and Review-specific CSS.
- No database, route, unrelated CTDP, or package dependency changes are included in the implementation diff.

---

## Self-Review

- Spec coverage: tasks cover summary metrics, derived indicators, risk sorting, chart legend, loading copy, zero-event chart handling, responsive styles, and verification.
- Placeholder scan: the plan contains concrete code snippets, commands, expected results, and file paths for each task.
- Type consistency: `ChainDerivedStats`, `ChainReviewSummary`, `riskTone`, `CHART_COLORS`, and `DonutDataItem` names are consistent across all tasks.
