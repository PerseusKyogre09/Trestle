import type {
  EligibilityResult,
  ExecutionContext,
  ExecutionProvider,
  ProviderExecutionResult,
} from "./types";

/**
 * Mock execution provider for local development and testing.
 * Strictly labels all outcomes as simulated.
 * Does not contact external websites or real-world APIs.
 */
export class MockExecutionProvider implements ExecutionProvider {
  public readonly name = "mock-provider";

  async checkEligibility(
    context: ExecutionContext,
  ): Promise<EligibilityResult> {
    if (context.operation.prohibitsAutomation) {
      return {
        eligible: false,
        supportsOperation: false,
        reason:
          "[SIMULATED] Destination service prohibits automation. User must act manually.",
      };
    }

    return {
      eligible: true,
      supportsOperation: true,
      reason:
        "[SIMULATED] Mock execution provider is ready for local simulation.",
    };
  }

  async execute(context: ExecutionContext): Promise<ProviderExecutionResult> {
    const attemptId = crypto.randomUUID();
    const payload = context.operation.payload;

    // Simulate uncertainty when instructed via payload flag
    if (payload.simulateUncertainty === true) {
      return {
        attemptId,
        status: "uncertain",
        providerName: this.name,
        isSimulated: true,
        resultSummary:
          "[SIMULATED] External service connection timed out before confirmation receipt.",
        uncertaintyReason:
          "[SIMULATED] Operation sent but mock provider did not receive final confirmation from destination. Outcome is uncertain; requires manual reconciliation.",
        canVerifyOutcome: false,
        details: {
          simulated: true,
          operationType: context.operation.operationType,
          destination: context.operation.destination,
        },
      };
    }

    // Simulate provider failure when instructed via payload flag
    if (payload.simulateFailure === true) {
      return {
        attemptId,
        status: "failed",
        providerName: this.name,
        isSimulated: true,
        resultSummary:
          "[SIMULATED] Mock execution failed: simulated remote validation error.",
        details: {
          simulated: true,
          error:
            "[SIMULATED] The simulated endpoint rejected the payload validation.",
        },
        canVerifyOutcome: true,
      };
    }

    // Normal simulated success
    return {
      attemptId,
      status: "succeeded",
      providerName: this.name,
      isSimulated: true,
      resultSummary:
        `[SIMULATED] Executed simulated operation: ${context.operation.description}`,
      details: {
        simulated: true,
        notice:
          "SIMULATED LOCAL RESULT: No real external actions were executed or websites contacted.",
        operationType: context.operation.operationType,
        destination: context.operation.destination ?? "local-mock",
      },
      evidence: {
        kind: "simulated",
        note:
          `[SIMULATED] Mock evidence: executed ${context.operation.description} for action ${context.actionId}.`,
        recordedAt: new Date().toISOString(),
      },
      canVerifyOutcome: true,
    };
  }

  async getStatus(): Promise<ProviderExecutionResult | null> {
    return null;
  }

  async cancel(): Promise<boolean> {
    return true;
  }
}
