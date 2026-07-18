-- Add the asset_acquisition event type so buying a fixed asset posts a voucher.
--
-- createFixedAsset only registered the asset row; the acquisition
-- (Dr Fixed Assets / Cr Cash|Bank) never reached the GL, so the asset's cash
-- outflow was invisible and Fixed Assets on the balance sheet stayed empty.
ALTER TYPE "PostingRuleEventType" ADD VALUE IF NOT EXISTS 'asset_acquisition';
