# Epic 85: CRM Lead Pipeline &amp; Marketing Campaigns

### Epic Goal
Give the business a way to work prospects before they become customers, keep staff on top of scheduled follow-ups, and run targeted SMS/WhatsApp/email blasts to existing customers — as distinct from Epic 80's post-conversion customer segmentation.

### Epic Description
This entire pipeline — leads, their conversation history, task reminders, and a campaign-sending engine — was built as a premium-tier feature (`premiumCrm`) with no PRD coverage. The campaign engine in particular has a real gap worth flagging: it has no working frontend.

### Stories

1. **Story 1: Lead Pipeline Management**
   * **Description:** Track prospects (`Lead`) through NEW → CONTACTED → QUALIFIED → CONVERTED/LOST, tagged by source/category/priority, with a "next step" field driving a personal action list. One-click conversion creates a real `Customer` record and locks the lead from further edits.
   * Status: Done, gated by `premiumCrm` plan feature — `apps/backend/src/crm-leads/`, `apps/frontend/src/app/(app)/crm/leads/`.

2. **Story 2: Lead Conversation Tracking**
   * **Description:** A timeline of every touchpoint (call/SMS/WhatsApp/email/visit/meeting/note) logged against a lead; each entry refreshes the lead's `last_contacted_at` and can push the next scheduled action.
   * Status: Done — `apps/backend/src/crm-lead-conversations/`, embedded in the lead detail page.

3. **Story 3: CRM Tasks &amp; Automated Reminders**
   * **Description:** Assignable follow-up/reminder tasks (FOLLOW_UP/COLLECTION/BIRTHDAY/REORDER_REMINDER) attachable to a customer or a lead, with a due-today/overdue summary widget. Two nightly cron jobs auto-generate BIRTHDAY tasks (customer's birthday today) and REORDER_REMINDER tasks (no contact in 60+ days).
   * Status: Done — `apps/backend/src/crm-tasks/`, surfaced as a "Tasks" tab on the customer detail page (the standalone `/crm/tasks` route is a redirect stub).

4. **Story 4: Marketing Campaign Engine**
   * **Description:** Draft an SMS/WhatsApp/email blast targeted at a customer segment or customer group, preview the recipient list, schedule or send immediately, track per-recipient delivery, and auto-attribute a customer's next purchase (within 30 days) back to the campaign that reached them.
   * Status: Done — as of 2026-07-05 the EMAIL channel now actually sends (`CrmCampaign.subject` + `EmailService.sendCustom()` in `crm-campaigns.service.ts`), and `/crm/campaigns` was rebuilt with a real list/create/preview/send/detail UI, replacing the former redirect stub.

5. **Story 5: Lead Scoring**
   * **Description:** Automatically score a lead so staff can prioritize outreach, independent of the manual `priority` field.
   * Status: Done — `crm-leads/lead-scoring.util.ts`, shipped 2026-07-05.

### Notes
Stories 1-3 were already fully implemented before this epic doc was written. Story 4 was Partial (no frontend, no email send) when this epic doc was first written, and was completed on 2026-07-05. Story 5 (lead scoring) was added the same day and had no prior story coverage.
