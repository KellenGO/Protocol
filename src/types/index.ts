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
  auxiliary_current_length: number;
  auxiliary_best_length: number;
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

interface Precedent {
  id: number;
  chain_id: number;
  scope: 'main_chain' | 'reservation_chain';
  title: string;
  description: string;
  created_from_session_id: number | null;
  created_from_session_type: 'focus' | 'reservation' | null;
  status: 'active' | 'retired';
  created_at: string;
  updated_at: string | null;
  retired_at: string | null;
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
  | 'created_from_session_id'
  | 'created_from_session_type'
  | 'status'
  | 'created_at'
  | 'updated_at'
  | 'retired_at'
>;

export type ProtocolPrecedent = Precedent;

export interface ActiveReservationSession {
  id: number;
  chain_id: number;
  created_at: string;
  due_at: string;
  confirmation_due_at: string | null;
  trigger_action: string;
  completion_condition: string;
  phase: 'countdown' | 'confirming' | 'pending_ruling';
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
  session: {
    id: number;
    chain_id: number;
    created_at: string;
    due_at: string;
    confirmation_due_at: string | null;
    fulfilled_at: string | null;
    result: 'fulfilled' | 'failed_reset' | 'failed_precedent' | null;
    failure_note: string | null;
    trigger_action: string;
    completion_condition: string;
    debug_category: string | null;
    debug_note: string | null;
  };
  chain: Chain;
}

export interface FailReservationPrecedentResult {
  session: FailReservationResetResult['session'];
  chain: Chain;
  precedent: ProtocolPrecedent;
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

export interface RsipFormula {
  id: number;
  parent_id: number | null;
  title: string;
  description: string;
  status: 'inactive' | 'active';
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
  event_type:
    | 'created'
    | 'activated'
    | 'deactivated'
    | 'rollback_child_deactivated';
  note: string;
  created_at: string;
}

export interface FormulaReview {
  formula: RsipFormula;
  events: FormulaEvent[];
  child_count: number;
  active_child_count: number;
  rollback_event_count: number;
  latest_deactivation_note: string | null;
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

export interface AppSetting {
  key: string;
  value: string;
}

// ===== Data Management =====

export interface DatabaseInfo {
  db_path: string;
  file_size_bytes: number;
  version: number;
  tables: {
    chains: number;
    focus_sessions: number;
    reservation_sessions: number;
    precedents: number;
    rsip_formulas: number;
    formula_events: number;
  };
}

export interface BackupFileInfo {
  path: string;
  file_size_bytes: number;
  version: number;
  tables: {
    chains: number | string;
    focus_sessions: number | string;
    reservation_sessions: number | string;
    precedents: number | string;
    app_settings: number | string;
    rsip_formulas: number | string;
    formula_events: number | string;
  };
}

export interface HistoryExport {
  export_version: number;
  app_version: string;
  exported_at: string;
  database_user_version: number;
  tables: {
    chains: Record<string, string>[];
    focus_sessions: Record<string, string>[];
    reservation_sessions: Record<string, string>[];
    precedents: Record<string, string>[];
    formula_events: Record<string, string>[];
    app_settings: Record<string, string>[];
  };
}

export interface ResetHistoryResult {
  deleted_records: number;
  remaining: {
    chains: number;
    precedents: number;
    rsip_formulas: number;
  };

/** 按主链复盘：单条链的汇总指标 */
export interface ChainReviewStats {
  chain_id: number;
  chain_name: string;
  status: 'active' | 'archived';
  completed_count: number;
  failed_reset_count: number;
  failed_precedent_count: number;
  reservation_fulfilled_count: number;
  reservation_failed_reset_count: number;
  reservation_failed_precedent_count: number;
  current_length: number;
  auxiliary_current_length: number;
  best_length: number;
  auxiliary_best_length: number;
}

/** 失败模式复盘：debug_category 聚合 */
export interface FailureDebugSummary {
  category: string;
  count: number;
  recent_notes: string[];
  last_occurred_at: string | null;
  chain_names: string[];
}

/** 判例复盘：判例 + 关联链名 */
export interface PrecedentReviewItem {
  id: number;
  chain_id: number;
  chain_name: string;
  scope: 'main_chain' | 'reservation_chain';
  title: string;
  description: string;
  created_from_session_id: number | null;
  created_from_session_type: 'focus' | 'reservation' | null;
  status: 'active' | 'retired';
  created_at: string;
  updated_at: string | null;
  retired_at: string | null;
}
