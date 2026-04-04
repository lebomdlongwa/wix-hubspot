-- CreateEnum
CREATE TYPE "SyncSource" AS ENUM ('WIX', 'HUBSPOT', 'FORM', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('WIX_TO_HS', 'HS_TO_WIX', 'BOTH');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'SKIPPED', 'ERROR');

-- CreateTable
CREATE TABLE "AppInstallation" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "hubspotPortalId" TEXT,
    "connectedAt" TIMESTAMP(3),

    CONSTRAINT "AppInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactIdMapping" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "wixContactId" TEXT NOT NULL,
    "hubspotContactId" TEXT NOT NULL,
    "lastSyncedBy" "SyncSource" NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactIdMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldMapping" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "wixField" TEXT NOT NULL,
    "hubspotProperty" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "direction" "SyncSource" NOT NULL,
    "wixId" TEXT,
    "hubspotId" TEXT,
    "status" "SyncStatus" NOT NULL,
    "skipReason" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmissionLog" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "wixSubmissionId" TEXT NOT NULL,
    "hubspotContactId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmTerm" TEXT,
    "utmContent" TEXT,
    "rawSubmission" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "FormSubmissionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppInstallation_instanceId_key" ON "AppInstallation"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactIdMapping_instanceId_wixContactId_key" ON "ContactIdMapping"("instanceId", "wixContactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactIdMapping_instanceId_hubspotContactId_key" ON "ContactIdMapping"("instanceId", "hubspotContactId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldMapping_instanceId_wixField_hubspotProperty_key" ON "FieldMapping"("instanceId", "wixField", "hubspotProperty");

-- CreateIndex
CREATE UNIQUE INDEX "FormSubmissionLog_wixSubmissionId_key" ON "FormSubmissionLog"("wixSubmissionId");

-- AddForeignKey
ALTER TABLE "ContactIdMapping" ADD CONSTRAINT "ContactIdMapping_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "AppInstallation"("instanceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldMapping" ADD CONSTRAINT "FieldMapping_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "AppInstallation"("instanceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "AppInstallation"("instanceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmissionLog" ADD CONSTRAINT "FormSubmissionLog_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "AppInstallation"("instanceId") ON DELETE RESTRICT ON UPDATE CASCADE;
