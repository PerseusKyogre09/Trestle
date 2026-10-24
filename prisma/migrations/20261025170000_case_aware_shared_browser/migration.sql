ALTER TABLE "SharedBrowserSession" ADD COLUMN "selectedUrl" TEXT;
ALTER TABLE "SharedBrowserSession" ADD COLUMN "selectionSource" TEXT;
ALTER TABLE "SharedBrowserSession" ADD COLUMN "selectionReason" TEXT;
ALTER TABLE "SharedBrowserSession" ADD COLUMN "actionId" TEXT;
ALTER TABLE "SharedBrowserSession" ADD COLUMN "institution" TEXT;
ALTER TABLE "SharedBrowserSession" ADD COLUMN "allowedDomain" TEXT;
ALTER TABLE "SharedBrowserSession" ADD COLUMN "isTestMode" BOOLEAN NOT NULL DEFAULT false;
