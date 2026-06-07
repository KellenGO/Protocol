import type { FormulaEvent, RsipFormula, RsipGoal } from '../types';

export interface RsipReviewInput {
  formulas: RsipFormula[];
  goals: RsipGoal[];
  events: FormulaEvent[];
}

export interface RsipReviewSummary {
  totalFormulas: number;
  activeFormulas: number;
  inactiveFormulas: number;
  rootFormulas: number;
  childFormulas: number;
  linkedGoals: number;
  failurePaths: number;
  deactivationEvents: number;
  rollbackEvents: number;
}

export interface RsipFormulaReviewItem {
  formula: RsipFormula;
  goalTitle: string | null;
  childCount: number;
  activeChildCount: number;
  deactivationEvents: number;
  rollbackEvents: number;
  priorityScore: number;
  tone: 'stable' | 'watch' | 'high';
}

export interface RsipGoalReviewItem {
  goal: RsipGoal;
  formulaCount: number;
  activeFormulaCount: number;
  inactiveFormulaCount: number;
}

export interface RsipEventSummary {
  created: number;
  activated: number;
  deactivated: number;
  rollback: number;
}

export interface RsipReviewModel {
  summary: RsipReviewSummary;
  eventSummary: RsipEventSummary;
  priorityFormulas: RsipFormulaReviewItem[];
  goals: RsipGoalReviewItem[];
}

export function summarizeRsipReview({
  formulas,
  goals,
  events,
}: RsipReviewInput): RsipReviewModel {
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  const childrenByParent = new Map<number, RsipFormula[]>();
  const eventsByFormula = new Map<number, FormulaEvent[]>();

  formulas.forEach((formula) => {
    if (formula.parent_id === null) return;
    const children = childrenByParent.get(formula.parent_id) ?? [];
    children.push(formula);
    childrenByParent.set(formula.parent_id, children);
  });

  events.forEach((event) => {
    const formulaEvents = eventsByFormula.get(event.formula_id) ?? [];
    formulaEvents.push(event);
    eventsByFormula.set(event.formula_id, formulaEvents);
  });

  const activeFormulas = formulas.filter((formula) => formula.status === 'active').length;
  const eventSummary = summarizeEvents(events);
  const priorityFormulas = formulas
    .map((formula) => buildFormulaReviewItem(formula, goalById, childrenByParent, eventsByFormula))
    .sort(sortFormulaReviewItems);

  return {
    summary: {
      totalFormulas: formulas.length,
      activeFormulas,
      inactiveFormulas: formulas.length - activeFormulas,
      rootFormulas: formulas.filter((formula) => formula.parent_id === null).length,
      childFormulas: formulas.filter((formula) => formula.parent_id !== null).length,
      linkedGoals: goals.length,
      failurePaths: goals.reduce((sum, goal) => sum + goal.failure_path_count, 0),
      deactivationEvents: eventSummary.deactivated,
      rollbackEvents: eventSummary.rollback,
    },
    eventSummary,
    priorityFormulas,
    goals: buildGoalReviewItems(goals, formulas),
  };
}

function summarizeEvents(events: FormulaEvent[]): RsipEventSummary {
  return events.reduce<RsipEventSummary>(
    (summary, event) => {
      if (event.event_type === 'created') summary.created += 1;
      if (event.event_type === 'activated') summary.activated += 1;
      if (event.event_type === 'deactivated') summary.deactivated += 1;
      if (event.event_type === 'rollback_child_deactivated') summary.rollback += 1;
      return summary;
    },
    { created: 0, activated: 0, deactivated: 0, rollback: 0 },
  );
}

function buildFormulaReviewItem(
  formula: RsipFormula,
  goalById: Map<number, RsipGoal>,
  childrenByParent: Map<number, RsipFormula[]>,
  eventsByFormula: Map<number, FormulaEvent[]>,
): RsipFormulaReviewItem {
  const children = childrenByParent.get(formula.id) ?? [];
  const formulaEvents = eventsByFormula.get(formula.id) ?? [];
  const deactivationEvents = formulaEvents.filter((event) => event.event_type === 'deactivated').length;
  const rollbackEvents = formulaEvents.filter((event) => event.event_type === 'rollback_child_deactivated').length;
  const priorityScore =
    deactivationEvents * 4 +
    rollbackEvents * 3 +
    (formula.status === 'inactive' ? 2 : 0) +
    children.length;
  const goalTitle = formula.goal_id ? goalById.get(formula.goal_id)?.title ?? null : null;

  return {
    formula,
    goalTitle,
    childCount: children.length,
    activeChildCount: children.filter((child) => child.status === 'active').length,
    deactivationEvents,
    rollbackEvents,
    priorityScore,
    tone: formulaTone(priorityScore),
  };
}

function formulaTone(priorityScore: number): RsipFormulaReviewItem['tone'] {
  if (priorityScore >= 6) return 'high';
  if (priorityScore > 0) return 'watch';
  return 'stable';
}

function sortFormulaReviewItems(a: RsipFormulaReviewItem, b: RsipFormulaReviewItem): number {
  if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
  if (a.formula.status !== b.formula.status) return a.formula.status === 'inactive' ? -1 : 1;
  return a.formula.position - b.formula.position || a.formula.id - b.formula.id;
}

function buildGoalReviewItems(goals: RsipGoal[], formulas: RsipFormula[]): RsipGoalReviewItem[] {
  return goals
    .map((goal) => {
      const goalFormulas = formulas.filter((formula) => formula.goal_id === goal.id);
      const activeFormulaCount = goalFormulas.filter((formula) => formula.status === 'active').length;
      return {
        goal,
        formulaCount: goalFormulas.length,
        activeFormulaCount,
        inactiveFormulaCount: goalFormulas.length - activeFormulaCount,
      };
    })
    .sort((a, b) => {
      if (b.inactiveFormulaCount !== a.inactiveFormulaCount) {
        return b.inactiveFormulaCount - a.inactiveFormulaCount;
      }
      if (b.formulaCount !== a.formulaCount) return b.formulaCount - a.formulaCount;
      return a.goal.title.localeCompare(b.goal.title, 'zh-Hans-CN');
    });
}
