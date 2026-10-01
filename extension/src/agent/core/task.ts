export type TaskStatus = 
  | 'CREATED' 
  | 'OBSERVING' 
  | 'PLANNING' 
  | 'ACTION_READY' 
  | 'WAITING_FOR_RESULT' 
  | 'COMPLETED' 
  | 'FAILED' 
  | 'CANCELLED';

export interface TaskState {
  id: string;
  instruction: string;
  status: TaskStatus;
  max_steps: number;
  current_step: number;
  last_error?: string;
  created_at: number;
  updated_at: number;
}
