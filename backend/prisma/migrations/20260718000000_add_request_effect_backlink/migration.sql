-- Migration: add_request_effect_backlink
-- Owner: Savant (DB). Financial-integrity: SAFE reversal of a WorkerRequest's approval
-- side-effects on re-decide (APPROVED -> REJECTED).
--
-- When a request is APPROVED (applyApprovalEffect), the service creates a side-effect row:
--   VACATION -> AttendanceRecord(s), LOAN -> Loan, ADVANCE -> AdvancePayment.
-- Previously there was NO link back to the originating request, so reversal would have to
-- match by workerId+amount+date — which could delete a manually-created record of the same
-- shape (a financial-integrity hazard). This adds a nullable "requestId" back-link so an
-- approval's created rows are unambiguously tagged and can be reversed precisely by requestId.
--
-- Each new "requestId" column is:
--   - NULLABLE  — existing/manually-created rows have NO source request; only approval-created
--                 rows get tagged (Servio sets it on approval-create).
-- FK -> "WorkerRequest"(id) ON DELETE SET NULL: deleting a request must NOT cascade-delete
-- financial/attendance history — it unlinks (SetNull), preserving the ledger rows.
-- A "..._requestId_idx" is added on each table for efficient reversal lookup (WHERE requestId=?).
--
-- RLS: Loan, AdvancePayment, AttendanceRecord already carry deny-by-default RLS from
-- 20260713000000_enable_rls_defense_in_depth. Adding a column/FK/index does NOT change RLS,
-- and AttendanceRecord's UNIQUE(workerId, date) is untouched — so neither is re-stated here.

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN "requestId" TEXT;

-- AlterTable
ALTER TABLE "AdvancePayment" ADD COLUMN "requestId" TEXT;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN "requestId" TEXT;

-- CreateIndex
CREATE INDEX "Loan_requestId_idx" ON "Loan"("requestId");

-- CreateIndex
CREATE INDEX "AdvancePayment_requestId_idx" ON "AdvancePayment"("requestId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_requestId_idx" ON "AttendanceRecord"("requestId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkerRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvancePayment" ADD CONSTRAINT "AdvancePayment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkerRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WorkerRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
