-- Add the depreciation event type to the posting-rules engine so the monthly
-- depreciation run posts a voucher.
--
-- runDepreciation recorded an AssetDepreciationEntry and incremented
-- FixedAsset.accumulated_depreciation but never wrote a voucher — the
-- Dr Depreciation Expense / Cr Accumulated Depreciation entry the schema was
-- designed for (AssetDepreciationEntry.voucher_id, declared and never set) did
-- not exist, so depreciation never reached the P&L.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'depreciation';
