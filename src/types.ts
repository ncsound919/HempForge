export type COARecord = {
  id: string;
  batchId: string;
  strain: string;
  uploadDate: string;
  thca: number;
  d9thc: number;
  totalThc: number;
  status: 'Compliant' | 'At Risk' | 'Non-Compliant';
  recommendation?: string;
  userId?: string;
  tenantId?: string;
  complianceSignature?: string;
  certifiedBy?: string;
  certificationDate?: string;
  labCertificateNumber?: string;
  labName?: string;
};

export type AuditLog = any;
export type CsaValidationRun = any;

export type AgentMessage = {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  agentType?: 'Orchestrator' | 'Compliance' | 'Chemistry' | 'Intake';
  timestamp: string;
};
