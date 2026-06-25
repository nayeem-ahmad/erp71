-- Posting rules for customer payment receive / payout flows
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'customer_payment';
ALTER TYPE "PostingRuleConditionKey" ADD VALUE IF NOT EXISTS 'payment_direction';