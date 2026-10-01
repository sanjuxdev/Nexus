export interface AgentObservation {
  task_id: string;
  cycle_id: string;
  page_state_hash: string;
  origin: string;
  frame_id: string;
  url: string;
  timestamp: number;
  
  // The sanitized visual or semantic regions the agent is allowed to see
  regions: Array<{
    region_id: string;
    type: string;
    text: string | null;
    interactable: boolean;
    // Note: No bounding boxes or raw DOM info to preserve privacy boundary
  }>;
  
  // History of the agent's actions for context
  history: Array<{
    action_type: string;
    status: 'success' | 'failed';
    message?: string;
  }>;
}
