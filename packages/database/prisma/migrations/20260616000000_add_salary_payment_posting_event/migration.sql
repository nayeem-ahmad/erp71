-- Add the salary_payment event type so salary disbursements can auto-post
-- journal vouchers via the rule-based posting engine.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'salary_payment';
