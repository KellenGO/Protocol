import { invoke } from '@tauri-apps/api/core';
import type {
  ActiveFocusSession,
  ActiveReservationSession,
  AppSetting,
  BackupFileInfo,
  Chain,
  ChainPrecedent,
  ChainReviewStats,
  CompleteFocusResult,
  DashboardSummary,
  DatabaseInfo,
  FailureDebugSummary,
  FailResetResult,
  FailPrecedentResult,
  FailReservationPrecedentResult,
  FailReservationResetResult,
  FulfillReservationResult,
  GlobalActiveFocusSession,
  GlobalActiveReservationSession,
  FormulaEvent,
  FormulaReview,
  GoalFormulaDraft,
  HistoryExport,
  PrecedentReviewItem,
  ProtocolEvent,
  ProtocolPrecedent,
  ProtocolTimelineEvent,
  ResetHistoryResult,
  RsipFailurePath,
  RsipFormula,
  RsipGoal,
  RsipSummary,
} from '../../types';

export interface PrecedentInput {
  title: string;
  description: string;
}

export async function getChains(): Promise<Chain[]> {
  return invoke('get_chains');
}

export async function getAppSettings(): Promise<AppSetting[]> {
  return invoke('get_app_settings');
}

export async function updateAppSetting(key: string, value: string): Promise<void> {
  return invoke('update_app_setting', { key, value });
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  return invoke('get_dashboard_summary');
}

export async function getRecentProtocolEvents(): Promise<ProtocolEvent[]> {
  return invoke('get_recent_protocol_events');
}

export async function getProtocolTimeline(filter: {
  typeFilter?: string | null;
  resultFilter?: string | null;
  chainId?: number | null;
  limit?: number | null;
}): Promise<ProtocolTimelineEvent[]> {
  return invoke('get_protocol_timeline', {
    typeFilter: filter.typeFilter ?? null,
    resultFilter: filter.resultFilter ?? null,
    chainId: filter.chainId ?? null,
    limit: filter.limit ?? null,
  });
}

export async function createChain(params: {
  name: string;
  description: string;
  triggerAction: string;
  completionCondition: string;
  focusDurationMinutes: number;
  auxiliaryTriggerAction: string;
  auxiliaryDelayMinutes: number;
  auxiliaryCompletionCondition: string;
}): Promise<Chain> {
  return invoke('create_chain', params);
}

export async function updateChain(
  id: number,
  params: {
    name: string;
    description: string;
    triggerAction: string;
    completionCondition: string;
    focusDurationMinutes: number;
    auxiliaryTriggerAction: string;
    auxiliaryDelayMinutes: number;
    auxiliaryCompletionCondition: string;
  },
): Promise<Chain> {
  return invoke('update_chain', { id, ...params });
}

export async function getChain(id: number): Promise<Chain> {
  return invoke('get_chain', { id });
}

export async function getGlobalActiveFocusSession(): Promise<GlobalActiveFocusSession | null> {
  return invoke('get_global_active_focus_session');
}

export async function getGlobalActiveReservationSession(): Promise<GlobalActiveReservationSession | null> {
  return invoke('get_global_active_reservation_session');
}

export async function setFocusSessionPendingRuling(sessionId: number): Promise<void> {
  return invoke('set_focus_session_pending_ruling', { sessionId });
}

export async function clearFocusSessionPendingRuling(sessionId: number): Promise<void> {
  return invoke('clear_focus_session_pending_ruling', { sessionId });
}

export async function startFocusSession(
  chainId: number,
): Promise<ActiveFocusSession> {
  return invoke('start_focus_session', { chainId });
}

export async function getActiveFocusSession(
  chainId: number,
): Promise<ActiveFocusSession | null> {
  return invoke('get_active_focus_session', { chainId });
}

export async function completeFocusSession(
  sessionId: number,
): Promise<CompleteFocusResult> {
  return invoke('complete_focus_session', { sessionId });
}

export async function failFocusSessionReset(
  sessionId: number,
  behaviorType?: string,
  debugCategory?: string,
  debugNote?: string,
): Promise<FailResetResult> {
  return invoke('fail_focus_session_reset', {
    sessionId,
    behaviorType: behaviorType ?? null,
    debugCategory: debugCategory ?? null,
    debugNote: debugNote ?? null,
  });
}

export async function failFocusSessionPrecedent(
  sessionId: number,
  input: PrecedentInput,
  debugCategory?: string,
  debugNote?: string,
): Promise<FailPrecedentResult> {
  return invoke('fail_focus_session_precedent', {
    sessionId,
    title: input.title,
    description: input.description,
    debugCategory: debugCategory ?? null,
    debugNote: debugNote ?? null,
  });
}

export async function getChainPrecedents(
  chainId: number,
): Promise<ChainPrecedent[]> {
  return invoke('get_chain_precedents', { chainId });
}

export async function getChainReservationPrecedents(
  chainId: number,
): Promise<ChainPrecedent[]> {
  return invoke('get_chain_reservation_precedents', { chainId });
}

export async function getPrecedent(id: number): Promise<ProtocolPrecedent> {
  return invoke('get_precedent', { id });
}

export async function updatePrecedent(
  id: number,
  input: PrecedentInput,
): Promise<ProtocolPrecedent> {
  return invoke('update_precedent', {
    id,
    title: input.title,
    description: input.description,
  });
}

export async function retirePrecedent(id: number): Promise<ProtocolPrecedent> {
  return invoke('retire_precedent', { id });
}

export async function startReservationSession(
  chainId: number,
): Promise<ActiveReservationSession> {
  return invoke('start_reservation_session', { chainId });
}

export async function fulfillReservationAndStartFocus(
  reservationId: number,
): Promise<FulfillReservationResult> {
  return invoke('fulfill_reservation_and_start_focus', { reservationId });
}

export async function expireReservationSession(
  reservationId: number,
): Promise<FailReservationResetResult> {
  return invoke('expire_reservation_session', { reservationId });
}

export async function failReservationSessionReset(
  reservationId: number,
  behaviorType?: string,
  debugCategory?: string,
  debugNote?: string,
): Promise<FailReservationResetResult> {
  return invoke('fail_reservation_session_reset', {
    reservationId,
    behaviorType: behaviorType ?? null,
    debugCategory: debugCategory ?? null,
    debugNote: debugNote ?? null,
  });
}

export async function failReservationSessionPrecedent(
  reservationId: number,
  input: PrecedentInput,
  debugCategory?: string,
  debugNote?: string,
): Promise<FailReservationPrecedentResult> {
  return invoke('fail_reservation_session_precedent', {
    reservationId,
    title: input.title,
    description: input.description,
    debugCategory: debugCategory ?? null,
    debugNote: debugNote ?? null,
  });
}

export async function createRsipFormula(params: {
  title: string;
  description: string;
  parentId?: number | null;
}): Promise<RsipFormula> {
  return invoke('create_rsip_formula', {
    title: params.title,
    description: params.description,
    parentId: params.parentId ?? null,
  });
}

export async function getRsipFormulas(): Promise<RsipFormula[]> {
  return invoke('get_rsip_formulas');
}

export async function createRsipGoal(params: {
  title: string;
  description: string;
}): Promise<RsipGoal> {
  return invoke('create_rsip_goal', params);
}

export async function getRsipGoals(includeArchived = false): Promise<RsipGoal[]> {
  return invoke('get_rsip_goals', { includeArchived });
}

export async function updateRsipGoal(
  id: number,
  params: {
    title: string;
    description: string;
    status?: 'active' | 'archived';
  },
): Promise<RsipGoal> {
  return invoke('update_rsip_goal', {
    id,
    title: params.title,
    description: params.description,
    status: params.status ?? null,
  });
}

export async function archiveRsipGoal(id: number): Promise<RsipGoal> {
  return invoke('archive_rsip_goal', { id });
}

export async function createFailurePath(params: {
  goalId: number;
  title: string;
  nodes: string[];
}): Promise<RsipFailurePath> {
  return invoke('create_failure_path', params);
}

export async function getFailurePaths(goalId: number): Promise<RsipFailurePath[]> {
  return invoke('get_failure_paths', { goalId });
}

export async function createFormulaFromGoal(params: GoalFormulaDraft): Promise<RsipFormula> {
  return invoke('create_formula_from_goal', {
    goalId: params.goalId,
    failurePathId: params.failurePathId,
    interventionNodeId: params.interventionNodeId,
    title: params.title,
    description: params.description,
    parentId: params.parentId ?? null,
    dependencyNote: params.dependencyNote ?? null,
  });
}

export async function getFormulasByGoal(goalId: number): Promise<RsipFormula[]> {
  return invoke('get_formulas_by_goal', { goalId });
}

export async function updateRsipFormula(
  id: number,
  params: {
    title: string;
    description: string;
  },
): Promise<RsipFormula> {
  return invoke('update_rsip_formula', {
    id,
    title: params.title,
    description: params.description,
  });
}

export async function activateRsipFormula(id: number): Promise<RsipFormula> {
  return invoke('activate_rsip_formula', { id });
}

export async function deactivateRsipFormula(
  id: number,
  note?: string,
): Promise<RsipFormula[]> {
  return invoke('deactivate_rsip_formula', { id, note: note ?? null });
}

export async function getFormulaEvents(limit = 20): Promise<FormulaEvent[]> {
  return invoke('get_formula_events', { limit });
}

export async function getRsipSummary(): Promise<RsipSummary> {
  return invoke('get_rsip_summary');
}

export async function getRsipFormulaReview(id: number): Promise<FormulaReview> {
  return invoke('get_rsip_formula_review', { id });
}

// ===== Data Management =====

export async function backupDatabase(destPath: string): Promise<string> {
  return invoke('backup_database', { destPath });
}

export async function restoreDatabase(backupPath: string): Promise<string> {
  return invoke('restore_database', { backupPath });
}

export async function inspectBackupFile(backupPath: string): Promise<BackupFileInfo> {
  return invoke('inspect_backup_file', { backupPath });
}

export async function discardRestorePreview(previewPath: string): Promise<void> {
  return invoke('discard_restore_preview', { previewPath });
}

export async function getDatabaseInfo(): Promise<DatabaseInfo> {
  return invoke('get_database_info');
}

export async function exportHistoryJson(): Promise<HistoryExport> {
  return invoke('export_history_json');
}

export async function resetHistoryAndProgress(): Promise<ResetHistoryResult> {
  return invoke('reset_history_and_progress');
}

export async function getDbVersion(): Promise<number> {
  return invoke('get_db_version');
}

// ===== Review System =====

export async function getChainReviewStats(since?: string | null): Promise<ChainReviewStats[]> {
  return invoke('get_chain_review_stats', { since: since ?? null });
}

export async function getFailureDebugSummary(since?: string | null): Promise<FailureDebugSummary[]> {
  return invoke('get_failure_debug_summary', { since: since ?? null });
}

export async function getPrecedentReviewList(since?: string | null): Promise<PrecedentReviewItem[]> {
  return invoke('get_precedent_review_list', { since: since ?? null });
}
