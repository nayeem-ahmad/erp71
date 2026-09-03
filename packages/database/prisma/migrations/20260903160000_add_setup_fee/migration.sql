-- One-time setup fee, per the pricing architecture in
-- docs/subscription-pricing-architecture.md.
--
-- Two columns rather than one, because they answer different questions:
-- `setup_fee` is what a plan charges (catalogue data, editable by a platform
-- admin like every other price), and `setup_fee_paid_at` is whether a given
-- tenant has already paid it.
--
-- The second column is the one that matters for correctness. `createCheckout`
-- assembles its amount from the plan and the selected add-ons and keeps no
-- record of what a tenant has settled before, so without a paid-at stamp the
-- fee is charged again every time a subscription lapses to PAST_DUE and the
-- tenant re-subscribes. Renewals are safe either way: BillingSchedulerService
-- recomputes from plan.monthly_price rather than reusing the checkout amount,
-- so a setup line never recurs on its own.
--
-- Defaulting to 0 leaves every existing plan charging nothing, so this migration
-- changes no tenant's bill. Live values are set in the admin UI.
ALTER TABLE "SubscriptionPlan" ADD COLUMN "setup_fee" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Existing subscriptions are treated as having settled whatever onboarding was
-- agreed at the time. Stamping them rather than leaving NULL means nobody who
-- is already a customer is billed a setup fee retroactively on their next
-- checkout.
ALTER TABLE "TenantSubscription" ADD COLUMN "setup_fee_paid_at" TIMESTAMP(3);
UPDATE "TenantSubscription" SET "setup_fee_paid_at" = "current_period_start";
