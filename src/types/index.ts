export interface Chain {
  id: number;
  name: string;
  description: string;
  trigger_action: string;
  completion_condition: string;
  focus_duration_minutes: number;
  auxiliary_trigger_action: string;
  auxiliary_delay_minutes: number;
  auxiliary_completion_condition: string;
  current_length: number;
  best_length: number;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface FocusSession {
  id: number;
  chain_id: number;
  started_at: string;
  expected_end_at: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
  result: 'completed' | 'failed_reset' | 'failed_precedent' | null;
  failure_note: string | null;
  trigger_action: string;
  completion_condition: string;
  debug_category: string | null;
  debug_note: string | null;
  created_at: string;
}

export interface ReservationSession {
  id: number;
  chain_id: number;
  created_at: string;
  due_at: string;
  fulfilled_at: string | null;
  result: 'fulfilled' | 'failed_reset' | 'failed_precedent' | null;
  failure_note: string | null;
  trigger_action: string;
  completion_condition: string;
  debug_category: string | null;
  debug_note: string | null;
}

export interface Precedent {
  id: number;
  chain_id: number;
  scope: 'main_chain' | 'reservation_chain';
  title: string;
  description: string;
  created_from_session_id: number | null;
  created_from_session_type: 'focus' | 'reservation' | null;
  created_at: string;
}

export interface ActiveFocusSession {
  id: number;
  chain_id: number;
  started_at: string;
  expected_end_at: string | null;
  duration_minutes: number | null;
  trigger_action: string;
  completion_condition: string;
}

export interface CompleteFocusResult {
  session: FocusSession;
  chain: Chain;
}

export interface FailResetResult {
  session: FocusSession;
  chain: Chain;
}

export interface FailPrecedentResult {
  session: FocusSession;
  chain: Chain;
  precedent: Precedent;
}

export type ChainPrecedent = Pick<
  Precedent,
  | 'id'
  | 'chain_id'
  | 'scope'
  | 'title'
  | 'description'
  | 'created_at'
>;

export interface ActiveReservationSession {
  id: number;
  chain_id: number;
  created_at: string;
  due_at: string;
  trigger_action: string;
  completion_condition: string;
}

export interface GlobalActiveFocusSession extends ActiveFocusSession {
  chain_name: string;
  pending_ruling: boolean;
}

export interface GlobalActiveReservationSession extends ActiveReservationSession {
  chain_name: string;
  pending_ruling: boolean;
}

export interface FulfillReservationResult {
  focus_session: ActiveFocusSession;
  chain_id: number;
}

export interface FailReservationResetResult {
  session: ReservationSession;
  chain: Chain;
}

export interface FailReservationPrecedentResult {
  session: ReservationSession;
  chain: Chain;
  precedent: Precedent;
}

export interface DashboardSummary {
  chain_count: number;
  max_current_chain_length: number;
  today_completed_focus_count: number;
  total_completed_focus_count: number;
  active_protocol_state:
    | 'focus'
    | 'focus_pending_ruling'
    | 'reservation_countdown'
    | 'reservation_due'
    | 'reservation_pending_ruling'
    | 'none';
  active_chain_id: number | null;
  active_chain_name: string | null;
}

export interface ProtocolEvent {
  event_type: 'focus' | 'reservation';
  id: number;
  chain_id: number;
  chain_name: string;
  event_time: string;
  ended_at: string | null;
  result: string;
  duration_minutes: number | null;
}

export type FormulaStatus = 'inactive' | 'active';

export type FormulaEventType =
  | 'created'
  | 'activated'
  | 'deactivated'
  | 'rollback_child_deactivated';

export interface RsipFormula {
  id: number;
  parent_id: number | null;
  title: string;
  description: string;
  status: FormulaStatus;
  position: number;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  deactivated_at: string | null;
}

export interface FormulaEvent {
  id: number;
  formula_id: number;
  formula_title: string;
  event_type: FormulaEventType;
  note: string;
  created_at: string;
}

export interface RsipSummary {
  total_formulas: number;
  active_formulas: number;
  inactive_formulas: number;
  latest_event: FormulaEvent | null;
}

export interface ProtocolTimelineEvent {
  event_type: 'focus' | 'reservation' | 'rsip';
  id: number;
  chain_id: number | null;
  chain_name: string | null;
  formula_id: number | null;
  formula_title: string | null;
  event_time: string;
  ended_at: string | null;
  result: string;
  duration_minutes: number | null;
  note: string | null;
  precedent_id: number | null;
  precedent_title: string | null;
}

export interface HistoryFilter {
  type_filter?: 'focus' | 'reservation' | 'rsip' | null;
  result_filter?: 'success' | 'failed' | 'precedent' | null;
  chain_id?: number | null;
}

export interface AppSetting {
  key: string;
  value: string;
}
