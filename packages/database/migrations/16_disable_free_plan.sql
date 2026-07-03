-- Disable self-serve FREE plan (paid plans only until infrastructure is ready)

UPDATE subscription_plans
SET is_active = false,
    description = 'Legacy fallback plan — not offered for new signups'
WHERE code = 'FREE';