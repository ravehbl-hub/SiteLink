-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'PARTNER', 'FOREMAN', 'WORKER');

-- CreateEnum
CREATE TYPE "Profession" AS ENUM ('IRONWORKER', 'MOLDER', 'CONCRETE_WORKER', 'GENERAL_LABORER', 'FOREMAN', 'MECHANIC', 'ELECTRICIAN', 'PLUMBER', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkerLevel" AS ENUM ('WEAK', 'MEDIUM', 'GOOD', 'EXCELLENT');

-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('ATTENDANCE', 'VACATION', 'DISEASE');

-- CreateEnum
CREATE TYPE "WorkerDocType" AS ENUM ('PASSPORT_ID', 'VISA', 'HEIGHT_PERMIT', 'ATTAT');

-- CreateEnum
CREATE TYPE "SalaryCalcMode" AS ENUM ('ISRAELI_LABOR_LAW', 'FIXED');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('HOURLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('VACATION', 'LOAN', 'ADVANCE');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('HE', 'EN', 'TR');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authUserId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isLockedOut" BOOLEAN NOT NULL DEFAULT false,
    "language" "Language" NOT NULL DEFAULT 'HE',
    "theme" "Theme" NOT NULL DEFAULT 'LIGHT',
    "lastLoginAt" TIMESTAMP(3),
    "primarySiteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "startedAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAssignment" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "country" TEXT,
    "address" TEXT,
    "profession" "Profession" NOT NULL,
    "level" "WorkerLevel" NOT NULL DEFAULT 'MEDIUM',
    "qualityOfWorks" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "personnelCompany" TEXT,
    "residence" TEXT,
    "startDate" TIMESTAMP(3),
    "imageStorageKey" TEXT,
    "imageFileName" TEXT,
    "imageMimeType" TEXT,
    "imageUploadedAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerDoc" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "type" "WorkerDocType" NOT NULL,
    "reference" TEXT,
    "expiresAt" TIMESTAMP(3),
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerSalaryData" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "hourlyWage" DECIMAL(12,2) NOT NULL,
    "rateType" "RateType" NOT NULL DEFAULT 'HOURLY',
    "workingConditions" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerSalaryData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "siteId" TEXT,
    "date" DATE NOT NULL,
    "type" "AttendanceType" NOT NULL,
    "hours" DECIMAL(6,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionWageRate" (
    "id" TEXT NOT NULL,
    "profession" "Profession" NOT NULL,
    "wage" DECIMAL(12,2) NOT NULL,
    "rateType" "RateType" NOT NULL DEFAULT 'HOURLY',
    "calcMode" "SalaryCalcMode" NOT NULL DEFAULT 'FIXED',
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionWageRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "date" DATE NOT NULL,
    "notes" TEXT,
    "outstanding" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvancePayment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "date" DATE NOT NULL,
    "notes" TEXT,
    "outstanding" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitLoss" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "salaryCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "loansCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advancesCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitLoss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerRequest" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "requestedById" TEXT,
    "type" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Billing" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'TRIALING',
    "plan" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Billing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfitLoss" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ILS',
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfitLoss_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authUserId_key" ON "User"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_authUserId_idx" ON "User"("authUserId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_primarySiteId_idx" ON "User"("primarySiteId");

-- CreateIndex
CREATE INDEX "Site_status_idx" ON "Site"("status");

-- CreateIndex
CREATE INDEX "Site_isArchived_idx" ON "Site"("isArchived");

-- CreateIndex
CREATE INDEX "SiteAssignment_workerId_idx" ON "SiteAssignment"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "SiteAssignment_siteId_workerId_key" ON "SiteAssignment"("siteId", "workerId");

-- CreateIndex
CREATE INDEX "Worker_profession_idx" ON "Worker"("profession");

-- CreateIndex
CREATE INDEX "Worker_level_idx" ON "Worker"("level");

-- CreateIndex
CREATE INDEX "Worker_isArchived_idx" ON "Worker"("isArchived");

-- CreateIndex
CREATE INDEX "WorkerDoc_workerId_idx" ON "WorkerDoc"("workerId");

-- CreateIndex
CREATE INDEX "WorkerDoc_type_idx" ON "WorkerDoc"("type");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerSalaryData_workerId_key" ON "WorkerSalaryData"("workerId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_siteId_date_idx" ON "AttendanceRecord"("siteId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRecord_date_idx" ON "AttendanceRecord"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_workerId_date_key" ON "AttendanceRecord"("workerId", "date");

-- CreateIndex
CREATE INDEX "ProfessionWageRate_profession_idx" ON "ProfessionWageRate"("profession");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionWageRate_profession_siteId_key" ON "ProfessionWageRate"("profession", "siteId");

-- CreateIndex
CREATE INDEX "Loan_workerId_idx" ON "Loan"("workerId");

-- CreateIndex
CREATE INDEX "Loan_date_idx" ON "Loan"("date");

-- CreateIndex
CREATE INDEX "AdvancePayment_workerId_idx" ON "AdvancePayment"("workerId");

-- CreateIndex
CREATE INDEX "AdvancePayment_date_idx" ON "AdvancePayment"("date");

-- CreateIndex
CREATE INDEX "ProfitLoss_siteId_periodStart_periodEnd_idx" ON "ProfitLoss"("siteId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "WorkerRequest_workerId_idx" ON "WorkerRequest"("workerId");

-- CreateIndex
CREATE INDEX "WorkerRequest_status_idx" ON "WorkerRequest"("status");

-- CreateIndex
CREATE INDEX "WorkerRequest_type_idx" ON "WorkerRequest"("type");

-- CreateIndex
CREATE INDEX "Customer_isArchived_idx" ON "Customer"("isArchived");

-- CreateIndex
CREATE INDEX "Billing_customerId_idx" ON "Billing"("customerId");

-- CreateIndex
CREATE INDEX "Billing_status_idx" ON "Billing"("status");

-- CreateIndex
CREATE INDEX "Usage_customerId_metric_idx" ON "Usage"("customerId", "metric");

-- CreateIndex
CREATE INDEX "BusinessProfitLoss_customerId_periodStart_periodEnd_idx" ON "BusinessProfitLoss"("customerId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_primarySiteId_fkey" FOREIGN KEY ("primarySiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAssignment" ADD CONSTRAINT "SiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAssignment" ADD CONSTRAINT "SiteAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerDoc" ADD CONSTRAINT "WorkerDoc_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerSalaryData" ADD CONSTRAINT "WorkerSalaryData_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionWageRate" ADD CONSTRAINT "ProfessionWageRate_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitLoss" ADD CONSTRAINT "ProfitLoss_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerRequest" ADD CONSTRAINT "WorkerRequest_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerRequest" ADD CONSTRAINT "WorkerRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfitLoss" ADD CONSTRAINT "BusinessProfitLoss_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

