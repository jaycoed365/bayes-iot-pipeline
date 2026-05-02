-- CreateTable
CREATE TABLE "EnvReading" (
    "id" TEXT NOT NULL,
    "deviceUid" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL,
    "tempC" DOUBLE PRECISION NOT NULL,
    "humidity" DOUBLE PRECISION NOT NULL,
    "pressureHpa" DOUBLE PRECISION,
    "vocOhms" DOUBLE PRECISION,

    CONSTRAINT "EnvReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" TEXT NOT NULL,
    "deviceUid" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "forecastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetAt" TIMESTAMP(3) NOT NULL,
    "tempC" DOUBLE PRECISION NOT NULL,
    "tempCLower" DOUBLE PRECISION,
    "tempCUpper" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "humidityLower" DOUBLE PRECISION,
    "humidityUpper" DOUBLE PRECISION,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anomaly" (
    "id" TEXT NOT NULL,
    "deviceUid" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "metric" TEXT NOT NULL,
    "observedValue" DOUBLE PRECISION NOT NULL,
    "expectedValue" DOUBLE PRECISION NOT NULL,
    "deviation" DOUBLE PRECISION NOT NULL,
    "severity" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,

    CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvReading_capturedAt_idx" ON "EnvReading"("capturedAt");

-- CreateIndex
CREATE INDEX "EnvReading_deviceUid_capturedAt_idx" ON "EnvReading"("deviceUid", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EnvReading_deviceUid_capturedAt_key" ON "EnvReading"("deviceUid", "capturedAt");

-- CreateIndex
CREATE INDEX "Forecast_deviceUid_targetAt_idx" ON "Forecast"("deviceUid", "targetAt");

-- CreateIndex
CREATE INDEX "Forecast_modelName_forecastAt_idx" ON "Forecast"("modelName", "forecastAt");

-- CreateIndex
CREATE UNIQUE INDEX "Forecast_deviceUid_modelName_modelVersion_targetAt_key" ON "Forecast"("deviceUid", "modelName", "modelVersion", "targetAt");

-- CreateIndex
CREATE INDEX "Anomaly_deviceUid_detectedAt_idx" ON "Anomaly"("deviceUid", "detectedAt");
