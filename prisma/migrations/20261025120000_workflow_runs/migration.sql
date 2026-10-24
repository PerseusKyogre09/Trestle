CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "mode" TEXT NOT NULL DEFAULT 'autonomous',
    "currentActionId" TEXT,
    "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "context" TEXT NOT NULL DEFAULT '{}',
    "events" TEXT NOT NULL DEFAULT '[]',
    "activeLock" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    CONSTRAINT "WorkflowRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkflowRun_activeLock_key" ON "WorkflowRun"("activeLock");
CREATE INDEX "WorkflowRun_caseId_createdAt_idx" ON "WorkflowRun"("caseId", "createdAt");
