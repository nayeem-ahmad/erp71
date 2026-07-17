-- Party dimension: turn the single Accounts Receivable / Purchase Payable
-- control accounts into subsidiary ledgers, one balance per customer/supplier/
-- employee, without an Account row per party (which autoPostFromRules could not
-- resolve, and which would grow the chart to thousands of rows).
--
-- Account.party_type marks a control account. VoucherDetail.party_type/party_id
-- tag each line hitting one with its party. party_id is polymorphic (Customer,
-- Supplier or Employee id) — no FK, on purpose. Mirrors the existing
-- cost_center_id dimension on voucher_details.

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "party_type" "PartyType";

-- AlterTable
ALTER TABLE "voucher_details" ADD COLUMN "party_type" "PartyType",
    ADD COLUMN "party_id" TEXT;

-- CreateIndex
CREATE INDEX "voucher_details_party_id_idx" ON "voucher_details"("party_id");
