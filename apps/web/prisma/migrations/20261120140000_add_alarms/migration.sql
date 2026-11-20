-- Device role: "frozen" turns on the freezer-failure alarm for that node
ALTER TABLE "Device" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'room';

-- CreateTable
CREATE TABLE "Alarm" (
    "id" TEXT NOT NULL,
    "deviceUid" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "notified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Alarm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alarm_deviceUid_kind_clearedAt_idx" ON "Alarm"("deviceUid", "kind", "clearedAt");

-- CreateIndex
CREATE INDEX "Alarm_triggeredAt_idx" ON "Alarm"("triggeredAt");

-- The ice cup node holds the frozen sample
INSERT INTO "Device" ("deviceUid", "label", "site", "sortOrder", "role")
VALUES ('dev:868531060198509', 'Ice cup', 'Lab bench', 2, 'frozen')
ON CONFLICT ("deviceUid") DO UPDATE SET "role" = 'frozen';
