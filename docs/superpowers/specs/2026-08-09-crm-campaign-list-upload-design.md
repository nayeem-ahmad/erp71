# CRM Campaigns: uploaded recipient lists

Date: 2026-08-09
Branch: `feat/crm-campaign-list-upload` (from `dev`)

## Problem

A CRM campaign today can only target a **customer segment**, and every recipient
gets the same subject and body. Users need to email a list that lives in a
spreadsheet, where each row carries its own subject and message, and to schedule
that send for a future date and time.

Two things block this:

- `CrmCampaignRecipient` requires `customer_id` and `phone`, so an arbitrary
  email address cannot be a recipient.
- `CrmCampaign` holds one `subject` and one `message` for the whole campaign.

Scheduling already exists (`scheduled_at` plus a `*/5 * * * *` cron), but it is
unusable in practice: the picked time is sent with no UTC offset, and a
scheduled campaign cannot be cancelled.

## Approach

Extend the existing campaign models in place rather than adding a parallel
"list campaign" model. Uploaded campaigns then reuse the campaigns list page,
the status lifecycle, the scheduling cron and sale attribution unchanged.

Two alternatives were rejected:

- **A parallel `CrmListCampaign` model and page.** No risk to existing
  campaigns, but it duplicates listing, statuses, scheduling and attribution,
  and splits "campaigns" across two places in the UI.
- **Rows stored as JSON on the campaign, materialised at send.** Smallest
  migration, but there is no per-row status or error, so a user cannot see
  which of 800 emails failed.

## Data model

`CrmCampaign` gains:

| Column             | Type     | Notes                                              |
| ------------------ | -------- | -------------------------------------------------- |
| `recipient_source` | `String` | `SEGMENT` (default, today's behaviour) or `UPLOAD` |
| `body_format`      | `String` | `TEXT` (default) or `HTML`                         |

`message` becomes nullable. An `UPLOAD` campaign has no campaign-level body;
DTO validation requires `message` only when `recipient_source` is `SEGMENT`.

`CrmCampaignRecipient` gains:

| Column        | Type      | Notes                                                    |
| ------------- | --------- | -------------------------------------------------------- |
| `customer_id` | `String?` | **was required** — now nullable                          |
| `phone`       | `String?` | **was required** — now nullable                          |
| `lead_id`     | `String?` | set when the row resolved to a `Lead`                    |
| `contact_id`  | `String?` | set when the row resolved to (or created) a `CrmContact` |
| `email`       | `String?` | the row's address; the address actually sent to          |
| `name`        | `String?` | resolved display name                                    |
| `subject`     | `String?` | the row's own subject                                    |
| `message`     | `String?` | the row's own body                                       |

Constraints: keep `@@unique([campaign_id, customer_id])` and add
`@@unique([campaign_id, email])`. Postgres treats NULLs as distinct, so segment
campaigns (which set no `email`) and upload campaigns (which may set no
`customer_id`) are each unaffected by the other's constraint.

Migration is applied as direct SQL plus `prisma generate`; `prisma migrate dev`
does not work against the local database, which has no `_prisma_migrations`
history.

## Upload flow

The file is parsed in the browser using the existing papaparse/xlsx path, then
validated and previewed before anything is posted. Template columns:

```text
Email, Name, Subject, Message
```

Column mapping is offered, auto-matched on header name, so a file whose headers
differ still imports.

### Row validation

Applied in the browser and re-applied server-side on the posted rows. Both
report the same messages so the preview never disagrees with the result.

| Rule                                 | Outcome                                               |
| ------------------------------------ | ----------------------------------------------------- |
| `Email` blank or not a valid address | row rejected, reported with its line                  |
| `Subject` blank                      | row rejected, reported with its line                  |
| `Message` blank                      | row rejected, reported with its line                  |
| `Name` blank                         | accepted; name falls back to the email local part     |
| Email repeated within the file       | first kept; later rows reported as skipped duplicates |
| More than 1,000 valid rows           | whole file rejected                                   |
| Zero valid rows                      | whole file rejected                                   |

Duplicate detection and email matching are case-insensitive on the whole
address, and addresses are trimmed and lower-cased before storage.

### Recipient resolution

Each email is resolved tenant-scoped and case-insensitively, in this order:

1. `Customer` with that email
2. `Lead` with that email
3. `CrmContact` with that email

First match wins; the recipient links to that record via `customer_id`,
`lead_id` or `contact_id`, and takes that record's real name regardless of what
the Name cell said. Matching a customer is what keeps sale attribution working
for uploaded campaigns.

No match creates a `CrmContact`, named from the Name cell or the email local
part when blank, with `capture_source` marking it as a campaign import.
Contacts dedupe on `mobile` and these have none, so re-uploading the same file
would duplicate them — except that step 3 matches the contacts the first upload
created, so it does not.

Resolution and contact creation happen at **create** time, not send time, so
the campaign detail view shows exactly who will be emailed before the user
commits to sending. A created contact survives deleting the draft; these are
real people the user intended to contact.

## Sending

`send()` stops dispatching inline for every channel. It marks the campaign
`SENDING` and returns. A drain worker sends at most **200 recipients per pass**,
claiming each batch by flipping `PENDING → SENDING` with a conditional
`updateMany` before dispatching, so an overlapping pass cannot double-send.

- The existing `*/5 * * * *` cron drains, alongside its current job of flipping
  due `SCHEDULED` campaigns.
- `send()` also kicks one pass immediately, so a small campaign still goes out
  at once rather than waiting for the next tick.
- When no `PENDING` recipients remain, the campaign becomes `COMPLETED` with its
  delivered and failed counts.

This makes a mid-send restart resumable — today it strands a campaign in
`SENDING` with no way to finish it — and paces a 1,000-row list across roughly
25 minutes instead of hammering the provider in one burst.

Segment campaigns route through the same drain. `send()` still resolves the
segment into `CrmCampaignRecipient` rows first; an `UPLOAD` campaign already has
its rows from create time, so it skips straight to `SENDING`. Segment recipients
carry no per-row `subject`/`message`, so the dispatcher falls back to the
campaign-level values.

### Body rendering

Per `body_format`:

- `TEXT` — HTML-escape the cell, then convert newlines to `<br>`. What was typed
  in the spreadsheet is what arrives, and a stray `<` or `&` cannot break or
  inject into the email.
- `HTML` — pass the cell through untouched, for senders who want links and
  formatting.

The current EMAIL path escapes nothing, so `TEXT` also closes that hole for
existing segment campaigns.

## Scheduling

Reuses `scheduled_at` and the existing cron, with two fixes and one addition.

**Timezone.** The `datetime-local` input posts a wall-clock string with no
offset, which the UTC container parses as UTC — so a campaign scheduled for
2:30 PM currently fires six hours late. The picked time is stamped as
`Asia/Dhaka` (+06:00) before posting, matching the convention already used in
`apps/backend/src/ai/chat.service.ts`, and the modal echoes back the resolved
send time so the user can see what was understood.

**Cancel.** `POST /crm/campaigns/:id/cancel`:

- from `SCHEDULED` — campaign becomes `CANCELLED`, nothing is sent
- from `SENDING` — remaining `PENDING` recipients become `CANCELLED`, the drain
  stops, and the campaign becomes `CANCELLED` with its delivered and failed
  counts recorded; already-sent emails stay sent

Cancelling from any other status is a `400`.

**Reschedule.** `PATCH /crm/campaigns/:id` already accepts `scheduled_at`; the
detail modal gains a control for it. Rescheduling is allowed from `DRAFT` and
`SCHEDULED` only, matching the existing edit guard.

## API

| Method | Path                        | Change                                                               |
| ------ | --------------------------- | -------------------------------------------------------------------- |
| `POST` | `/crm/campaigns`            | accepts `recipient_source`, `body_format`, and `rows[]` for uploads  |
| `POST` | `/crm/campaigns/:id/cancel` | new                                                                  |
| `GET`  | `/crm/campaigns/:id`        | recipients now include `email`, `name`, `subject`, `status`, `error` |
| `POST` | `/crm/campaigns/:id/send`   | unchanged shape; now queues rather than dispatching inline           |

`rows[]` is `{ email, name?, subject, message }[]`, capped at 1,000 entries. All
routes keep the existing `premiumCrm` feature gate and tenant scoping.

## UI

One **New Campaign** button, unchanged. Inside the modal, a Recipients choice:

- **Customer segment** — today's segment and message fields
- **Upload list** — drag-drop, column mapping, validated preview, and a
  downloadable template, inline in the same modal

Name, description and schedule are shared across both. The Text/HTML radio
appears for the EMAIL channel.

`parseFile` is extracted from `apps/frontend/src/components/import-dialog.tsx`
into a shared util so the wizard and this modal use one parser rather than two.

The detail modal gains a recipient table with per-row status and error, a
sent/total progress line while `SENDING`, and the Cancel and Reschedule
actions.

All strings go through the `crmCampaigns` i18n namespace. `PageShell`,
`ModalShell` and `@/components/ui` primitives throughout, `blue-600` accent,
44px touch targets, no horizontal body scroll at 360px.

## Testing

Backend service specs:

- resolution order — customer beats lead beats contact; unmatched creates a contact
- a second upload of the same file matches, and does not duplicate, contacts
- each row validation rule, including the 1,000-row and empty-file rejections
- in-file duplicate emails keep the first row
- batch claim: two overlapping drain passes send each recipient exactly once
- completion sets `COMPLETED` with correct delivered and failed counts
- cancel from `SCHEDULED` and from `SENDING`
- a schedule picked as Dhaka wall-clock fires at the right instant
- `TEXT` escapes HTML and converts newlines; `HTML` passes through

Frontend unit tests cover the extracted parse and validate util.

Existing segment-campaign specs must pass unchanged against the drain-based
dispatcher.

## Out of scope

Merge tags and placeholder substitution, per-recipient send windows,
attachments, open and click tracking, unsubscribe handling.
