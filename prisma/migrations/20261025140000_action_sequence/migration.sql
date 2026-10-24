ALTER TABLE "Action"
ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

WITH ranked_actions AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "caseId"
            ORDER BY "createdAt" ASC, rowid ASC
        ) - 1 AS "workflowSequence"
    FROM "Action"
)
UPDATE "Action"
SET "sequence" = (
    SELECT ranked_actions."workflowSequence"
    FROM ranked_actions
    WHERE ranked_actions."id" = "Action"."id"
);
