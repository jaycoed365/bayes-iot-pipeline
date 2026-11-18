-- CreateTable
CREATE TABLE "Device" (
    "deviceUid" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "site" TEXT NOT NULL DEFAULT 'Lab bench',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("deviceUid")
);

-- Register the existing node so the dashboard shows it straight away
INSERT INTO "Device" ("deviceUid", "label", "site", "sortOrder")
VALUES ('dev:351077454469720', 'Room cup', 'Lab bench', 1)
ON CONFLICT ("deviceUid") DO NOTHING;
