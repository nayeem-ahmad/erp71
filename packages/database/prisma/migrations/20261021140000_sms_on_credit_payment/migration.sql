-- Customer SMS for a credit sale and for a payment received.
-- Off for every existing workspace until an admin turns it on.

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "sms_on_credit_payment" BOOLEAN NOT NULL DEFAULT false;
