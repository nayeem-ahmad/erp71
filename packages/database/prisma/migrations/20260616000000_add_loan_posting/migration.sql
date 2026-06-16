-- Add loan event types and condition key to the posting-rules engine so loan
-- disbursements and repayments can post journal vouchers automatically.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'loan_disbursement';
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'loan_repayment';
ALTER TYPE "PostingRuleConditionKey" ADD VALUE IF NOT EXISTS 'loan_direction';
