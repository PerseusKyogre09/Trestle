import type { Evidence, ExecutionStatus, ProposedOperation } from "../../domain/types";

export interface ExecutionContext {
  caseId: string;
  actionId: string;
  approvalId?: string;
  operation: ProposedOperation;
  dryRun?: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  supportsOperation: boolean;
  reason?: string;
}

export interface ProviderExecutionResult {
  attemptId: string;
  status: ExecutionStatus;
  providerName: string;
  isSimulated: boolean;
  resultSummary: string;
  details?: Record<string, unknown>;
  evidence?: Evidence;
  uncertaintyReason?: string;
  canVerifyOutcome: boolean;
  rawOutput?: unknown;
}

export interface ExecutionProvider {
  readonly name: string;
  checkEligibility(context: ExecutionContext): Promise<EligibilityResult>;
  execute(context: ExecutionContext): Promise<ProviderExecutionResult>;
  getStatus(attemptId: string): Promise<ProviderExecutionResult | null>;
  cancel?(attemptId: string): Promise<boolean>;
}
