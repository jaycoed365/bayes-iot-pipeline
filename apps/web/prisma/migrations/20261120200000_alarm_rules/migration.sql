-- Alarms now come from editable rules
ALTER TABLE "Alarm" ADD COLUMN "ruleId" TEXT;

-- CreateIndex
CREATE INDEX "Alarm_deviceUid_ruleId_clearedAt_idx" ON "Alarm"("deviceUid", "ruleId", "clearedAt");

-- CreateTable
CREATE TABLE "AlarmRule" (
    "id" TEXT NOT NULL,
    "deviceUid" TEXT,
    "channel" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowMin" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlarmRule_pkey" PRIMARY KEY ("id")
);

-- Start with the same four rules the fixed alarms used
INSERT INTO "AlarmRule" ("id", "deviceUid", "channel", "condition", "threshold", "windowMin", "sortOrder", "updatedAt") VALUES
  ('rule_freezer_level', 'dev:868531060198509', 'water', 'above',  -5,   5, 1, CURRENT_TIMESTAMP),
  ('rule_freezer_rate',  'dev:868531060198509', 'water', 'rising', 0.05, 5, 2, CURRENT_TIMESTAMP),
  ('rule_air_level',     NULL,                  'air',   'above',  30,   5, 3, CURRENT_TIMESTAMP),
  ('rule_air_rate',      NULL,                  'air',   'rising', 0.2,  5, 4, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Close any alarm opened by the old fixed rules
UPDATE "Alarm" SET "clearedAt" = CURRENT_TIMESTAMP WHERE "clearedAt" IS NULL AND "ruleId" IS NULL;
