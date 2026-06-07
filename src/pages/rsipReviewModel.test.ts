import { summarizeRsipReview } from './rsipReviewModel';
import type { FormulaEvent, RsipFormula, RsipGoal } from '../types';

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertArrayEqual<T>(actual: T[], expected: T[], message: string) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`${message}: expected ${expectedText}, got ${actualText}`);
  }
}

const formulas: RsipFormula[] = [
  {
    id: 1,
    parent_id: null,
    title: '晚饭后洗碗',
    description: '饭后十分钟内处理餐具',
    status: 'active',
    position: 0,
    created_at: '2026-06-01 08:00:00',
    updated_at: '2026-06-01 08:00:00',
    activated_at: '2026-06-01 08:00:00',
    deactivated_at: null,
    goal_id: 1,
    failure_path_id: 1,
    intervention_node_id: 'node-2',
    dependency_note: null,
  },
  {
    id: 2,
    parent_id: 1,
    title: '洗完立刻擦灶台',
    description: '依赖饭后洗碗启动',
    status: 'inactive',
    position: 0,
    created_at: '2026-06-02 08:00:00',
    updated_at: '2026-06-03 08:00:00',
    activated_at: '2026-06-02 08:00:00',
    deactivated_at: '2026-06-03 08:00:00',
    goal_id: 1,
    failure_path_id: 1,
    intervention_node_id: 'node-3',
    dependency_note: '父定式未启动时不会执行',
  },
  {
    id: 3,
    parent_id: null,
    title: '手机不上床',
    description: '睡前放到书桌充电',
    status: 'inactive',
    position: 1,
    created_at: '2026-06-03 08:00:00',
    updated_at: '2026-06-04 08:00:00',
    activated_at: null,
    deactivated_at: null,
    goal_id: 2,
    failure_path_id: 2,
    intervention_node_id: 'node-1',
    dependency_note: null,
  },
];

const goals: RsipGoal[] = [
  {
    id: 1,
    title: '稳定晚间收尾',
    description: '减少拖延和厨房堆积',
    status: 'active',
    created_at: '2026-06-01 08:00:00',
    updated_at: '2026-06-01 08:00:00',
    archived_at: null,
    formula_count: 2,
    failure_path_count: 1,
  },
  {
    id: 2,
    title: '早点睡',
    description: null,
    status: 'active',
    created_at: '2026-06-03 08:00:00',
    updated_at: '2026-06-03 08:00:00',
    archived_at: null,
    formula_count: 1,
    failure_path_count: 1,
  },
];

const events: FormulaEvent[] = [
  {
    id: 1,
    formula_id: 2,
    formula_title: '洗完立刻擦灶台',
    event_type: 'deactivated',
    note: '父定式失稳',
    created_at: '2026-06-03 08:00:00',
  },
  {
    id: 2,
    formula_id: 2,
    formula_title: '洗完立刻擦灶台',
    event_type: 'rollback_child_deactivated',
    note: '递归回滚',
    created_at: '2026-06-03 08:10:00',
  },
];

const review = summarizeRsipReview({ formulas, goals, events });

assertEqual(review.summary.totalFormulas, 3, 'counts total formulas');
assertEqual(review.summary.activeFormulas, 1, 'counts active formulas');
assertEqual(review.summary.inactiveFormulas, 2, 'counts inactive formulas');
assertEqual(review.summary.rollbackEvents, 1, 'counts rollback events');
assertEqual(review.summary.linkedGoals, 2, 'counts goals');
assertArrayEqual(
  review.priorityFormulas.map((item) => item.formula.id),
  [2, 3, 1],
  'sorts formula review priority',
);
assertEqual(review.priorityFormulas[0].goalTitle, '稳定晚间收尾', 'attaches goal title');
assertEqual(review.goals[0].activeFormulaCount, 1, 'counts active formulas per goal');
assertEqual(review.goals[1].inactiveFormulaCount, 1, 'counts inactive formulas per goal');
