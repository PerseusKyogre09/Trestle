CREATE TABLE "SharedBrowserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "encryptedConnection" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connecting',
    "controlOwner" TEXT NOT NULL DEFAULT 'agent',
    "commandClaimed" BOOLEAN NOT NULL DEFAULT false,
    "currentUrl" TEXT,
    "pageTitle" TEXT,
    "lastActivity" TEXT,
    "activeLock" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SharedBrowserSession_caseId_fkey"
        FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SharedBrowserSession_providerSessionId_key"
    ON "SharedBrowserSession"("providerSessionId");
CREATE UNIQUE INDEX "SharedBrowserSession_activeLock_key"
    ON "SharedBrowserSession"("activeLock");
CREATE INDEX "SharedBrowserSession_caseId_updatedAt_idx"
    ON "SharedBrowserSession"("caseId", "updatedAt");
