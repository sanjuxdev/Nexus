export type AgentActionType =
  | 'scroll'
  | 'click'
  | 'type'
  | 'select'
  | 'navigate'
  | 'wait'
  | 'read'
  | 'find'
  | 'back'
  | 'forward'
  | 'complete'
  | 'fail';

export interface AgentAction {
  id: string;
  type: AgentActionType;
  target_region_id?: string;
  params?: {
    direction?: 'up' | 'down' | 'left' | 'right';
    amount?: number;
    text?: string;
    url?: string;
    duration_ms?: number;
    option?: string;
  };
  rationale?: string;
}

export interface AgentActionResult {
  action_id: string;
  ok: boolean;
  message?: string;
  navigated?: boolean;
}
