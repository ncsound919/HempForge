export interface ResearchClawPipelineStartRequest {
  topic?: string;
  configOverrides?: Record<string, unknown>;
  autoApprove?: boolean;
}

export interface ResearchClawPipelineStartResponse {
  run_id: string;
  status: string;
  output_dir: string;
}

export interface ResearchClawPipelineStatus {
  run_id?: string;
  status: string;
  output_dir?: string;
  topic?: string;
  stages_done?: number;
  stages_failed?: number;
  error?: string;
}

export interface ResearchClawPipelineResults {
  run_id: string;
  metrics: Record<string, unknown>;
}

export interface ResearchClawProject {
  id: string;
  path: string;
  current_stage?: string;
  status?: string;
}

export interface ResearchClawRun {
  run_id: string;
  path: string;
  checkpoint?: Record<string, unknown>;
  stages_completed?: string[];
  has_md?: boolean;
  has_tex?: boolean;
  has_pdf?: boolean;
}

export interface ResearchClawChatMessage {
  message: string;
  client_id?: string;
}

export interface ResearchClawStage {
  number: number;
  name: string;
  label: string;
  phase: string;
}
