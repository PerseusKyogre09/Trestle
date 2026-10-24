import { beforeEach, describe, expect, it } from "vitest";
import { RuleBasedWorkflowCompiler } from "../../domain/compiler";
import { prisma } from "../../server/db";
import { createCase } from "../../server/repository";
import { POST as requestApprovalRoute } from "./cases/[id]/actions/[actionId]/approval/route";
import { POST as executeRoute } from "./cases/[id]/actions/[actionId]/execute/route";
import { GET as getExecutionsRoute } from "./cases/[id]/actions/[actionId]/executions/route";
import { PATCH as patchActionRoute } from "./cases/[id]/actions/[actionId]/route";
import { POST as decideApprovalRoute } from "./cases/[id]/approvals/[approvalId]/decide/route";
import { GET as getApprovalsRoute } from "./cases/[id]/approvals/route";

describe("Route Handlers API Integration", () => {
  let caseId: string;
  let actionId: string;

  beforeEach(async () => {
    await prisma.executionAttempt.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.action.deleteMany();
    await prisma.case.deleteMany();

    const compiled = new RuleBasedWorkflowCompiler().compile(
      "I lost my wallet containing my debit card and driving licence.",
    );
    const created = await createCase(
      "I lost my wallet containing my debit card and driving licence.",
      compiled.workflow!,
    );
    caseId = created.id;
    actionId = created.actions.find((a) => a.id === "secure-cards")!.id;
  });

  it("prevents directly marking an action completed via PATCH if approval is required", async () => {
    const req = new Request(
      `http://localhost/api/cases/${caseId}/actions/${actionId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          evidence: {
            kind: "user_provided",
            note: "Attacker attempting to bypass approval",
            recordedAt: new Date().toISOString(),
          },
        }),
      },
    );

    const res = await patchActionRoute(req, {
      params: Promise.resolve({ id: caseId, actionId }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("cannot be directly marked completed");
  });

  it("requests approval, decides it, and executes via route handlers end-to-end", async () => {
    // 1. Request approval via API
    const approvalReq = new Request(
      `http://localhost/api/cases/${caseId}/actions/${actionId}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: {
            operationType: "enter_form_details",
            description: "Card lock request",
            destination: "https://bank.example/freeze",
            payload: { cardId: "card_4321" },
          },
        }),
      },
    );
    const approvalRes = await requestApprovalRoute(approvalReq, {
      params: Promise.resolve({ id: caseId, actionId }),
    });
    expect(approvalRes.status).toBe(201);
    const approvalData = await approvalRes.json();
    expect(approvalData.id).toBeTruthy();
    expect(approvalData.status).toBe("pending");

    // 2. List approvals via API
    const listReq = new Request(
      `http://localhost/api/cases/${caseId}/approvals`,
    );
    const listRes = await getApprovalsRoute(listReq, {
      params: Promise.resolve({ id: caseId }),
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.length).toBe(1);
    expect(listData[0].id).toBe(approvalData.id);

    // 3. Approve request via API
    const decideReq = new Request(
      `http://localhost/api/cases/${caseId}/approvals/${approvalData.id}/decide`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "approve",
          notes: "Approved by account holder",
        }),
      },
    );
    const decideRes = await decideApprovalRoute(decideReq, {
      params: Promise.resolve({ id: caseId, approvalId: approvalData.id }),
    });
    expect(decideRes.status).toBe(200);
    const decideData = await decideRes.json();
    expect(decideData.status).toBe("approved");

    // 4. Execute via API
    const executeReq = new Request(
      `http://localhost/api/cases/${caseId}/actions/${actionId}/execute`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: {
            operationType: "enter_form_details",
            description: "Card lock request",
            destination: "https://bank.example/freeze",
            payload: { cardId: "card_4321" },
          },
        }),
      },
    );
    const executeRes = await executeRoute(executeReq, {
      params: Promise.resolve({ id: caseId, actionId }),
    });
    expect(executeRes.status).toBe(200);
    const executeData = await executeRes.json();
    expect(executeData.status).toBe("succeeded");
    expect(executeData.isSimulated).toBe(true);

    // 5. Query execution history via API
    const getExecReq = new Request(
      `http://localhost/api/cases/${caseId}/actions/${actionId}/executions`,
    );
    const getExecRes = await getExecutionsRoute(getExecReq, {
      params: Promise.resolve({ id: caseId, actionId }),
    });
    expect(getExecRes.status).toBe(200);
    const getExecData = await getExecRes.json();
    expect(getExecData.length).toBe(1);
    expect(getExecData[0].isSimulated).toBe(true);
  });
});
