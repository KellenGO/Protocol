export interface Chain {
  id: number;
  name: string;
  description: string;
  focus_duration_minutes: number;
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
  'id' | 'chain_id' | 'scope' | 'title' | 'description' | 'created_at'
>;

export interface ActiveReservationSession {
  id: number;
  chain_id: number;
  created_at: string;
  due_at: string;
}

export interface GlobalActiveFocusSession extends ActiveFocusSession {
  chain_name: string;
}

export interface GlobalActiveReservationSession extends ActiveReservationSession {
  chain_name: string;
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
  active_protocol_state: 'focus' | 'reservation_countdown' | 'reservation_due' | 'none';
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

export interface HistoryFilter {
  type_filter?: 'focus' | 'reservation' | null;
  result_filter?: 'success' | 'failed' | 'precedent' | null;
  chain_id?: number | null;
}

export interface AppSetting {
  key: string;
  value: string;
}
