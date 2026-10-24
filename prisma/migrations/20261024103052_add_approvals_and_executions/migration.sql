-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "operationDescription" TEXT NOT NULL,
    "destination" TEXT,
    "payload" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "riskCategory" TEXT NOT NULL,
    "prohibitsAutomation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "decidedAt" DATETIME,
    "decisionReason" TEXT,
    "decisionAudit" TEXT,
    CONSTRAINT "Approval_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "approvalId" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "resultSummary" TEXT,
    "resultDetails" TEXT,
    "evidence" TEXT,
    "uncertaintyReason" TEXT,
    CONSTRAINT "ExecutionAttempt_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionAttempt_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExecutionAttempt_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "Approval" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Approval_caseId_idx" ON "Approval"("caseId");

-- CreateIndex
CREATE INDEX "Approval_actionId_idx" ON "Approval"("actionId");

-- CreateIndex
CREATE INDEX "Approval_payloadHash_idx" ON "Approval"("payloadHash");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_caseId_idx" ON "ExecutionAttempt"("caseId");

-- CreateIndex
CREATE INDEX "ExecutionAttempt_actionId_idx" ON "ExecutionAttempt"("actionId");
