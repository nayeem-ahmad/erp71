ALTER TABLE "SubscriptionPlan"
ADD COLUMN "marketing_features_json" JSONB NOT NULL DEFAULT '[]';