# Epic 08: Messaging Channels &amp; AI-Powered Features

### Epic Goal
Give tenants paid-usage access to SMS, WhatsApp, and AI-powered assistance on top of the core email channel already covered by Epic 05 — each metered and billable independently of the subscription plan itself.

### Epic Description
Three separate monetized channels grew up alongside the core platform without a PRD entry: SMS (Bangladesh-specific segment billing), WhatsApp (via Meta's Graph API, used today only by CRM campaigns), and AI (report narration, message drafting, voice-to-entry parsing — a metered, plan-gated feature).

**Integration Points:**
* SMS and AI credits are both sellable by platform admins from the Platform Operations Console (Epic 07, Story 3).
* WhatsApp and AI credentials/config live in the shared `PlatformSetting` table, not per-tenant.
* AI features are additionally gated by the `premiumAi` plan entitlement; voice features further require `premiumVoice`.

### Stories

1. **Story 1: SMS Credit/Package Billing**
   * **Description:** Tenants hold a prepaid `sms_credits` balance, debited atomically per send using Bangladesh-specific segment-length billing (GSM-03.38 vs. Unicode/Bangla). Every debit/credit writes an immutable `SmsTransaction` ledger row. Tenants self-serve top-ups from an `SmsPackage` catalog via a purchase→confirm flow; platform admins can alternatively grant credits directly.
   * Status: Done — `apps/backend/src/sms/sms-credit.service.ts`, `apps/frontend/src/app/(app)/sms-credits/page.tsx`.

2. **Story 2: WhatsApp Business Messaging**
   * **Description:** Outbound WhatsApp messages via Meta's Graph API, with Bangladesh phone-number normalization. Credentials are platform-wide (`PlatformSetting` group `whatsapp`), not per-tenant. The only current trigger is the CRM marketing campaign engine (Epic 85); there is no credit/billing gate on WhatsApp the way there is on SMS.
   * Status: Done (as a sending capability) — `apps/backend/src/whatsapp/whatsapp.service.ts`, admin config/test at `apps/frontend/src/app/(app)/admin/platform-settings/whatsapp/page.tsx`.

3. **Story 3: AI-Powered Features &amp; Usage Credits**
   * **Description:** AI report narration, customer-message drafting, and voice-to-structured-entry parsing (sales/purchases/orders/returns), routed through OpenRouter. Every call logs actual token usage to `AiUsageLog` and converts tokens to "credits" against a monthly plan allowance (`resolveAiCreditsMonthly` + `Tenant.ai_credits_bonus`); calls are blocked once the allowance is exhausted. Requires the `premiumAi` plan entitlement (voice features additionally require `premiumVoice`).
   * Status: Done — `apps/backend/src/ai/ai.service.ts`, `apps/frontend/src/app/(app)/ai-credits/page.tsx`.

### Notes
All three stories were already implemented before this epic doc was written. This file only closes the documentation gap — no functional changes accompany it.
