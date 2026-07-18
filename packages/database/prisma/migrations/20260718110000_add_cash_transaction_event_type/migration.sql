-- Add the cash_transaction event type so a cashier PAYOUT/LOAN posts a voucher.
--
-- addCashTransaction created a CashTransaction (cash out of the till) but posted
-- nothing, so petty payouts and staff loans never reached the GL. DROP
-- (drawer→safe) and OTHER stay unposted — both sides are Cash in Hand.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'cash_transaction';
