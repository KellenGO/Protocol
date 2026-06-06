# RSIP Review Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign RSIPReview page with master-detail layout, remove redundant RsipReviewPanel from RSIP page.

**Architecture:** Remove the inline `RsipReviewPanel` from RSIP.tsx and repurpose its functionality into a right-side detail panel within RSIPReview.tsx. The formulas tab becomes a two-column layout: scrollable formula list on the left, editable detail view on the right. Navigation from RSIP formula tree "复盘" buttons uses query params (`?formula=id`).

**Tech Stack:** React, TypeScript, CSS (Corona Design System), React Router (useSearchParams, useNavigate).

---

### Task 1: Remove RsipReviewPanel from RSIP.tsx

**Files:**
- Modify: `src/pages/RSIP.tsx`

- [ ] **Step 1: Remove RsipReviewPanel and related state/code**

Delete the `RsipReviewPanel` component (lines 913–1015) and the `ReviewMetric` helper (lines 1017–1024).

Remove the following state variables and their declarations:
- `review`, `reviewLoading`, `reviewTitle`, `reviewDescription`, `deactivationNote`, `reviewError`, `savingReview`, `reviewChanged`

Remove the following functions:
- `loadReview` (lines 95–109)
- `handleSaveReview` (lines 175–197)

Remove these imports (check if still used elsewhere first):
- `getRsipFormulaReview` and `updateRsipFormula` from `../lib/db`
- `FormulaReview` from `../types`

Remove the `useEffect` that calls `loadReview` on searchParams change (lines 117–121).

Remove `review?.formula.id` references in `handleActivate` and `handleDeactivate` — simplify to not pass a second argument to `deactivateRsipFormula`:
```tsx
await deactivateRsipFormula(id);
```

Remove the `<aside className="rsip-side-panel">` wrapper around the remaining two cards (create card + events card), since the side panel layout was only needed when the review panel was present. Flatten the layout: the create card and events card can stack directly, or the aside can stay but just wrap the remaining cards.

- [ ] **Step 2: Change "复盘" button to navigate**

Add `useNavigate` import if not already present. In `FormulaTreeNode`, change the "复盘" button from calling `onReview(node.id)` to navigating:

```tsx
const navigate = useNavigate();

// In the button:
<button className="btn btn-secondary" onClick={() => navigate(`/rsip-review?formula=${node.id}`)}>
  复盘
</button>
```

Remove the `onReview` prop from `FormulaTreeNode` and its callers.

- [ ] **Step 3: Verify typecheck**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/pages/RSIP.tsx
git commit -m "refactor: remove inline RsipReviewPanel from RSIP page, navigate to /rsip-review instead"
```

---

### Task 2: Redesign RSIPReview.tsx with Master-Detail Layout

**Files:**
- Modify: `src/pages/RSIPReview.tsx`

- [ ] **Step 1: Add URL-driven formula selection**

Add `useSearchParams` to read `?formula=` query param. Add state for selected formula:

```tsx
import { useSearchParams } from 'react-router-dom';

// Inside the component:
const [searchParams, setSearchParams] = useSearchParams();
const [selectedFormulaId, setSelectedFormulaId] = useState<number | null>(null);

// On mount or when review data loads, check for ?formula= param:
useEffect(() => {
  const formulaId = Number(searchParams.get('formula'));
  if (Number.isFinite(formulaId) && formulaId > 0) {
    setSelectedFormulaId(formulaId);
  }
}, [searchParams, review.priorityFormulas]);
```

Add state for editing in the detail panel:

```tsx
const [editTitle, setEditTitle] = useState('');
const [editDescription, setEditDescription] = useState('');
const [savingDetail, setSavingDetail] = useState(false);
const [detailError, setDetailError] = useState('');
```

When `selectedFormulaId` changes, populate edit fields from the selected formula's data.

- [ ] **Step 2: Replace FormulaReviewList with MasterDetailLayout**

Replace the `FormulaReviewList` component with a new `FormulaMasterDetail` component that splits into left list + right detail panel:

```tsx
function FormulaMasterDetail({
  items,
  selectedId,
  onSelect,
  onSave,
  editTitle,
  editDescription,
  setEditTitle,
  setEditDescription,
  saving,
  error,
}: {
  items: RsipFormulaReviewItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSave: () => void;
  editTitle: string;
  editDescription: string;
  setEditTitle: (v: string) => void;
  setEditDescription: (v: string) => void;
  saving: boolean;
  error: string;
}) {
  if (items.length === 0) {
    return (
      <div className="review-empty-card">
        <div className="empty-state">
          <p className="empty-title">暂无RSIP定式</p>
          <p className="empty-desc">创建定式并点亮或熄灭后，RSIP复盘会在这里形成稳定性视图。</p>
        </div>
      </div>
    );
  }

  const selected = items.find(i => i.formula.id === selectedId) ?? null;

  return (
    <div className="rsip-master-detail">
      {/* Left: Formula List */}
      <div className="rsip-formula-list-panel">
        <div className="rsip-formula-list-header">
          <span>{items.length} 个定式</span>
          <span className="rsip-formula-list-sort">按风险排序</span>
        </div>
        <div className="rsip-formula-list-body">
          {items.map((item) => (
            <button
              key={item.formula.id}
              className={`rsip-formula-list-item ${selectedId === item.formula.id ? 'selected' : ''}`}
              onClick={() => onSelect(item.formula.id)}
            >
              <div className="rsip-formula-list-item-top">
                <div className="rsip-formula-list-item-info">
                  <span className="rsip-formula-list-kicker">{item.goalTitle ?? '未连接目标'}</span>
                  <span className="rsip-formula-list-title">{item.formula.title}</span>
                </div>
                <span className={`review-risk-badge review-risk-${item.tone}`}>{riskLabel(item.tone)}</span>
              </div>
              <div className="rsip-formula-list-metrics">
                <span>{item.activeChildCount}/{item.childCount} active</span>
                <span className={item.deactivationEvents > 0 ? 'metric-negative' : ''}>{item.deactivationEvents} 熄灭</span>
                <span className={item.rollbackEvents > 0 ? 'metric-negative' : ''}>{item.rollbackEvents} 回滚</span>
                <span>风险 {item.priorityScore}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Detail Panel */}
      <div className="rsip-formula-detail-panel">
        {!selected ? (
          <div className="empty-state compact">
            <p className="empty-title">选择一个定式</p>
            <p className="empty-desc">从左侧列表选择定式查看详细复盘数据。</p>
          </div>
        ) : (
          <FormulaDetail
            item={selected}
            editTitle={editTitle}
            editDescription={editDescription}
            setEditTitle={setEditTitle}
            setEditDescription={setEditDescription}
            onSave={onSave}
            saving={saving}
            error={error}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create FormulaDetail component**

This component shows the right-side detail panel with metrics, events, and editable title/description:

```tsx
function FormulaDetail({
  item,
  editTitle,
  editDescription,
  setEditTitle,
  setEditDescription,
  onSave,
  saving,
  error,
}: {
  item: RsipFormulaReviewItem;
  editTitle: string;
  editDescription: string;
  setEditTitle: (v: string) => void;
  setEditDescription: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string;
}) {
  const { formula } = item;
  // In a real implementation, we'd load detailed review data here
  // For now, use what we have from the review item

  return (
    <>
      <div className="rsip-detail-header">
        <span className={`formula-status status-${formula.status}`}>
          {formula.status === 'active' ? '点亮' : '未点亮'}
        </span>
        {item.goalTitle && <span className="rsip-detail-goal-kicker">{item.goalTitle}</span>}
      </div>

      <div className="rsip-detail-edit">
        <label className="form-field">
          <span>定式标题</span>
          <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
        </label>
        <label className="form-field">
          <span>执行说明</span>
          <textarea
            rows={3}
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="写清触发条件、完成标准和例外边界"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="rsip-detail-save-row">
          <button
            className="btn btn-primary"
            disabled={saving || !editTitle.trim()}
            onClick={onSave}
          >
            {saving ? '保存中...' : '保存定式'}
          </button>
        </div>
      </div>

      <div className="rsip-detail-metrics">
        <div className="review-metric review-metric-neutral">
          <span className="review-metric-value">{item.activeChildCount}/{item.childCount}</span>
          <span className="review-metric-label">依赖子定式 active</span>
        </div>
        <div className={`review-metric ${item.deactivationEvents > 0 ? 'review-metric-negative' : 'review-metric-neutral'}`}>
          <span className="review-metric-value">{item.deactivationEvents}</span>
          <span className="review-metric-label">熄灭次数</span>
        </div>
        <div className={`review-metric ${item.rollbackEvents > 0 ? 'review-metric-negative' : 'review-metric-neutral'}`}>
          <span className="review-metric-value">{item.rollbackEvents}</span>
          <span className="review-metric-label">回滚次数</span>
        </div>
        <div className={`review-metric ${item.priorityScore >= 6 ? 'review-metric-negative' : item.priorityScore > 0 ? 'review-metric-negative' : 'review-metric-positive'}`}>
          <span className="review-metric-value">{item.priorityScore}</span>
          <span className="review-metric-label">风险分</span>
        </div>
      </div>

      {formula.dependency_note && (
        <div className="rsip-review-note-line">
          <span>依赖说明</span>
          <p>{formula.dependency_note}</p>
        </div>
      )}

      {formula.description && (
        <div className="rsip-detail-desc-section">
          <span className="rsip-detail-section-label">执行说明</span>
          <p>{formula.description}</p>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Wire up save functionality**

Add `handleSaveDetail` function in the main component:

```tsx
async function handleSaveDetail() {
  if (!selectedFormulaId || !editTitle.trim()) return;
  setSavingDetail(true);
  setDetailError('');
  try {
    const updated = await updateRsipFormula(selectedFormulaId, {
      title: editTitle.trim(),
      description: editDescription.trim(),
    });
    // Refresh formulas data to update the list
    const refreshed = await getRsipFormulas();
    setFormulas(refreshed);
    setDetailError('');
  } catch (err) {
    setDetailError(String(err));
  } finally {
    setSavingDetail(false);
  }
}
```

Import `updateRsipFormula` from `../lib/db`.

- [ ] **Step 5: Update the tab rendering in main component**

Replace the `FormulaReviewList` usage with `FormulaMasterDetail`:

```tsx
{tab === 'formulas' && (
  <FormulaMasterDetail
    items={review.priorityFormulas}
    selectedId={selectedFormulaId}
    onSelect={(id) => {
      setSelectedFormulaId(id);
      setSearchParams({ formula: String(id) });
      const item = review.priorityFormulas.find(i => i.formula.id === id);
      if (item) {
        setEditTitle(item.formula.title);
        setEditDescription(item.formula.description);
      }
    }}
    onSave={handleSaveDetail}
    editTitle={editTitle}
    editDescription={editDescription}
    setEditTitle={setEditTitle}
    setEditDescription={setEditDescription}
    saving={savingDetail}
    error={detailError}
  />
)}
```

- [ ] **Step 6: Verify typecheck**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/pages/RSIPReview.tsx
git commit -m "feat: add master-detail layout to RSIPReview formulas tab"
```

---

### Task 3: Add CSS for Master-Detail Layout

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add RSIPReview master-detail styles**

Add the following CSS block after the existing `/* ===== RSIP Review Page ===== */` section (around line 3460):

```css
/* ===== RSIP Review Master-Detail ===== */

.rsip-master-detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 16px;
  align-items: start;
}

.rsip-formula-list-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  overflow: hidden;
}

.rsip-formula-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.rsip-formula-list-sort {
  font-size: 11px;
  color: var(--text-muted);
}

.rsip-formula-list-body {
  max-height: 600px;
  overflow-y: auto;
}

.rsip-formula-list-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 16px;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  border-left: 3px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.rsip-formula-list-item:hover {
  background: var(--bg-hover);
}

.rsip-formula-list-item.selected {
  border-left-color: var(--gold);
  background: var(--gold-subtle);
}

.rsip-formula-list-item-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.rsip-formula-list-item-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.rsip-formula-list-kicker {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.rsip-formula-list-title {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-display);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.rsip-formula-list-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.rsip-formula-list-metrics .metric-negative {
  color: var(--danger);
}

/* Detail Panel */

.rsip-formula-detail-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 20px;
  max-height: 600px;
  overflow-y: auto;
}

.rsip-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.rsip-detail-goal-kicker {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.rsip-detail-edit {
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.rsip-detail-save-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.rsip-detail-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.rsip-detail-desc-section {
  margin-top: 14px;
  padding: 10px 12px;
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.rsip-detail-section-label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.rsip-detail-desc-section p {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.55;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .rsip-master-detail {
    grid-template-columns: 1fr;
  }

  .rsip-formula-list-body {
    max-height: 360px;
  }

  .rsip-formula-detail-panel {
    max-height: none;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm.cmd run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "style: add RSIPReview master-detail layout CSS"
```

---

### Task 4: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `npm.cmd run typecheck`
Expected: PASS

- [ ] **Step 2: Run full build**

Run: `npm.cmd run build`
Expected: PASS

- [ ] **Step 3: Manual checklist**

- [ ] RSIP page loads without the 定式复盘 sidebar card
- [ ] Clicking "复盘" on a formula tree node navigates to `/rsip-review?formula=ID`
- [ ] RSIPReview page shows master-detail layout on 定式复盘 tab
- [ ] Clicking a formula in the left list selects it and shows detail on right
- [ ] Editing title/description and saving works
- [ ] 事件复盘 and 目标复盘 tabs still work
- [ ] Summary metrics at top unchanged
