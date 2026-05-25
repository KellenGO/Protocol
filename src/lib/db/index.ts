import { invoke } from '@tauri-apps/api/core';
import type {
  ActiveFocusSession,
  ActiveReservationSession,
  AppSetting,
  Chain,
  ChainPrecedent,
  CompleteFocusResult,
  DashboardSummary,
  FailResetResult,
  FailPrecedentResult,
  FailReservationResetResult,
  FailReservationPrecedentResult,
  FulfillReservationResult,
  GlobalActiveFocusSession,
  GlobalActiveReservationSession,
  FormulaEvent,
  ProtocolEvent,
  ProtocolTimelineEvent,
  RsipFormula,
  RsipSummary,
} from '../../types';

export async function getDbStatus(): Promise<string> {
  return invoke('get_db_status');
}

export async function getChains(): Promise<Chain[]> {
  return invoke('get_chains');
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke('get_setting', { key });
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

export async function getProtocolHistory(filter: {
  typeFilter?: string | null;
  resultFilter?: string | null;
  chainId?: number | null;
}): Promise<ProtocolEvent[]> {
  return invoke('get_protocol_history', {
    typeFilter: filter.typeFilter ?? null,
    resultFilter: filter.resultFilter ?? null,
    chainId: filter.chainId ?? null,
  });
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
  focusDurationMinutes: number;
}): Promise<Chain> {
  return invoke('create_chain', params);
}

export async function updateChain(
  id: number,
  params: {
    name: string;
    description: string;
    focusDurationMinutes: number;
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

export async function startFocusSession(
  chainId: number,
  durationMinutes: number,
): Promise<ActiveFocusSession> {
  return invoke('start_focus_session', {
    chainId,
    durationMinutes,
  });
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
): Promise<FailResetResult> {
  return invoke('fail_focus_session_reset', { sessionId });
}

export async function failFocusSessionPrecedent(
  sessionId: number,
  title: string,
  description: string,
): Promise<FailPrecedentResult> {
  return invoke('fail_focus_session_precedent', { sessionId, title, description });
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

export async function startReservationSession(
  chainId: number,
  delayMinutes: number,
): Promise<ActiveReservationSession> {
  return invoke('start_reservation_session', { chainId, delayMinutes });
}

export async function getActiveReservationSession(
  chainId: number,
): Promise<ActiveReservationSession | null> {
  return invoke('get_active_reservation_session', { chainId });
}

export async function fulfillReservationAndStartFocus(
  reservationId: number,
): Promise<FulfillReservationResult> {
  return invoke('fulfill_reservation_and_start_focus', { reservationId });
}

export async function failReservationSessionReset(
  reservationId: number,
): Promise<FailReservationResetResult> {
  return invoke('fail_reservation_session_reset', { reservationId });
}

export async function precedentReservationSessionFailure(
  reservationId: number,
  title: string,
  description: string,
): Promise<FailReservationPrecedentResult> {
  return invoke('precedent_reservation_session_failure', { reservationId, title, description });
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
