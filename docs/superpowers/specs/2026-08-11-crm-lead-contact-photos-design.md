# CRM lead & contact profile photos — design

**Date:** 2026-08-11
**Status:** Approved, ready for implementation planning

## Problem

A leads list and a contacts list are walls of near-identical text rows. Salespeople
recognise the people they are working faster by face than by name, and a contact
captured from a business card at a trade fair is easier to place with a photo
attached to it. Neither `Lead` nor `CrmContact` can hold an image today.

## Scope

- An optional profile photo on `Lead` and on `CrmContact`.
- Set and changed from the **create and edit forms** for both entities.
- Shown in the **first column** of both list pages, inline beside the name.

Out of scope: photos on any other entity; bulk photo import; face detection or
auto-cropping beyond the manual crop described below; showing the photo anywhere
other than the two list pages and the two forms.

## Decisions taken during design

| Question | Decision | Why |
| --- | --- | --- |
| Where is the photo set? | Create and edit forms | Both pages already render one shared fields component per entity, so it is a single change each, and the photo can be set while the record is first created. |
| List presentation | Inline in the existing name cell | No new column, so nothing shifts, column widths and server-side sorting are untouched, and the wide tables do not lose horizontal space on mobile. |
| Cropping | Reuse `components/AvatarCropModal.tsx` | Already used by the profile page. Guarantees a square source so avatars never render stretched. |
| Upload timing | Upload on crop-confirm, before the record is saved | Keeps saving one-phase. See below. |

### Why upload on crop-confirm

At photo-pick time in a *create* form the record does not exist, so there are
three options:

1. **Upload immediately to a dedicated endpoint** that returns both the URL and
   the Cloudinary `public_id`; the form carries both into the create/update
   payload. Cost: a cropped-then-abandoned form leaves one orphaned file.
2. **Defer the upload until after the record is saved.** No orphans, but the
   save becomes two-phase and "contact created, photo failed" is a state that
   has to be handled and messaged. The business-card attachment flow already
   lives with exactly this and needed a comment explaining it.
3. **Reuse the generic `POST /assets/upload`.** Least code, but that endpoint
   returns only `secure_url`, and a URL cannot be turned back into a
   `public_id` — so every replaced or deleted photo is stranded in Cloudinary
   forever. This is a known, already-recorded defect for voucher and project
   attachments (see TODO.md, Infrastructure / Ops).

**Chosen: option 1.** One save, assets stay deletable, and the only cost is a
rare orphan from an abandoned form rather than a permanent leak on every edit.

## Data model

`packages/database/prisma/schema.prisma` — two nullable columns on **both**
`Lead` and `CrmContact`:

```prisma
photo_url         String?
/// Cloudinary's public_id for the photo. `photo_url` is a secure_url and cannot
/// be turned back into one, so without this a replaced photo is stranded.
photo_storage_key String?
```

Additive and nullable: one migration, no backfill, no index — the columns are
never filtered or sorted on.

**Migration mechanics.** The local dev database has no `_prisma_migrations`
table, so `prisma migrate dev` fails against it; write the migration directory
by hand, apply the SQL directly, and run `prisma generate`. Check the newest
existing migration's timestamp prefix before naming the new one — a colliding
timestamp has bitten this repo before.

## Backend

### New module: `apps/backend/src/crm-photos/`

A controller and a service, roughly 80 lines each. It is its own module rather
than living in `crm-contacts` or `crm-leads` because it serves both and must
work before either record exists.

`POST /crm/photos`

- Guards and interceptors identical to both CRM controllers:
  `JwtAuthGuard`, `SubscriptionAccessGuard`, `@RequiresFeature('premiumCrm')`,
  `TenantInterceptor`.
- `@Throttle({ default: { limit: 20, ttl: 60_000 } })` — matching
  `addAttachment`, because the body carries an image.
- Reuses `parseImageUpload()`, which already validates MIME type and size and
  accepts either a `data:` URL or a bare base64 string. It is currently exported
  from `crm-contacts.service.ts`; it moves to `common/image-upload.util.ts` so
  the photo module does not have to import the contacts service to get at it.
- Body DTO mirrors `AddContactAttachmentDto`'s shape and conventions:
  `{ imageBase64: string; mimeType?: string; fileName?: string }`. Base64 JSON
  rather than multipart for consistency with the rest of the CRM module; the
  cropper emits a bounded 512×512 JPEG, so the payload is roughly 50–100 KB.
- Uploads via `assets.uploadBuffer()` into folder `<tenantId>/crm-photos` with
  resource type `image`, sanitising the filename stem the same way
  `addAttachment` does. (`uploadBuffer` prefixes `retail/`, so the full
  Cloudinary folder is `retail/<tenantId>/crm-photos`.)
- Returns `{ url, storageKey }`.
- Returns a clear 400 when `assets.isEnabled()` is false, matching the message
  style used for the card-image path.

### DTO changes

`photo_url?` and `photo_storage_key?` added to `CreateLeadDto`, `UpdateLeadDto`,
`CreateContactDto`, `UpdateContactDto`, as optional strings. They follow the
module's existing rule that `''` means *clear this field* rather than being
transformed to `undefined` (which the services read as "leave it alone").

### Storage-key validation — required, not optional

`photo_storage_key` arrives from the client and the delete-on-replace path feeds
it to `cloudinary.destroy`. Left unvalidated, tenant A could set a lead's
storage key to a `public_id` belonging to tenant B and then delete B's asset
simply by changing the photo.

Both services therefore reject any `photo_storage_key` that is not prefixed
`retail/<tenantId>/crm-photos/`. This check is shared, lives next to the CRM
photo service, and is covered by a test.

### Service changes (`crm-leads.service.ts`, `crm-contacts.service.ts`)

- **On update:** if the incoming storage key differs from the stored one and a
  stored one exists, `assets.deleteFile(oldKey, 'image')` after the row is
  written. A failed delete is logged, not thrown — the update has succeeded.
- **On remove:** delete the record's asset before the row goes, the same shape
  as the existing contact-attachment cleanup in `crm-contacts.service.ts`.
- **Read paths need no change.** Both services fetch with Prisma `include`
  (`leadIncludes` / `contactIncludes`) rather than an enumerated `select`, so
  every scalar column — including both new ones — is returned by `findAll` and
  `findOne` already. Withholding `photo_storage_key` from list responses would
  mean converting `include` to a hand-listed `select` of ~30 lead columns, which
  is ongoing maintenance and a regression risk for no benefit: the key is
  tenant-scoped, validated on write, and the edit form needs it anyway.

## Frontend

### New shared components

**`components/Avatar.tsx`** — presentational only. Renders `photo_url` in a
circle with `object-cover`, or the name's initials on `bg-blue-50 text-blue-700`
when there is none. Two sizes: `sm` (`w-8 h-8`, list rows) and `lg`
(`w-16 h-16`, forms). This is the piece the list cells and the form control
share; it is the same initials pattern the profile page currently inlines.

**`components/PhotoField.tsx`** — the form control, sitting beside the existing
`AvatarCropModal`. Renders `<Avatar size="lg">` plus a **Choose photo** /
**Change** button, and a **Remove** button once a photo is set.

- Picking a file opens `AvatarCropModal`.
- On crop-confirm it POSTs to `/crm/photos` and calls
  `onChange({ url, storageKey })`.
- **Remove** calls `onChange({ url: '', storageKey: '' })` — it clears the field
  on the record; the Cloudinary asset is reclaimed by the service's
  delete-on-replace path when the form is saved.
- Client-side guards before the crop modal opens: image MIME types only, ≤5 MB,
  matching the limit the profile page already states.
- Upload failures surface through the global `toast` store, per the UI rules.
  Nothing blocks the rest of the form — a photo that fails to upload leaves the
  record saveable without one.

### Form wiring

`ContactFormState` and the lead form state each gain `photo_url` and
`photo_storage_key`. `emptyContactForm()`, `contactToFormState()` and
`contactFormToPayload()` (and the lead equivalents) carry them through
unchanged in spirit — including the "send blanks so a cleared field is
clearable" rule.

`PhotoField` renders as the first row of the existing field grid, spanning both
columns. `applyScannedCard` is untouched: a scanned business card does **not**
become the contact's profile photo — it remains an attachment.

Because `new/page.tsx` and `[id]/page.tsx` both render the shared
`ContactFormFields` / `LeadFormFields`, create and edit are covered by one
change per entity.

### List pages

In `crm/leads/page.tsx` and `crm/contacts/page.tsx` the `name` column's cell
becomes a flex row: `<Avatar size="sm">` followed by the existing `<Link>`. The
column keeps its `name` id, so the server-side sort key is unchanged. The `Lead`
and `Contact` row interfaces each gain `photo_url: string | null`.

### Supporting changes

- **`lib/api.ts`** — one addition:
  `uploadCrmPhoto({ imageBase64, mimeType, fileName })`.
- **i18n** — new keys in `lib/localization/messages/<locale>/crmHr.ts` for
  **en**, **bn** and **ms**: field label, choose/change/remove actions, the size
  hint, and the upload-failed message. Nothing hardcoded.

### UI-rules compliance

Single `blue-600` accent; `min-h-touch` on the photo buttons; no
`rounded-2xl`/`rounded-3xl`; `text-sm`/`text-xs` throughout; toast-only
notifications; no new hand-rolled overlay (`AvatarCropModal` is reused as-is).

## Testing

**Backend (Jest):**

- CRM photo service: returns `{ url, storageKey }` on success; throws a clear
  error when Cloudinary is not configured.
- Storage-key validation: a key outside `retail/<tenantId>/crm-photos/` is
  rejected, including one belonging to another tenant.
- `crm-leads.service` and `crm-contacts.service`: replacing a photo deletes the
  previous asset; deleting a record deletes its asset; an update that does not
  touch the photo deletes nothing.

**Frontend:**

- `PhotoField`: pick → crop → upload → `onChange` fires with url and key; the
  remove path clears both; an oversized or non-image file is rejected before the
  modal opens; an upload failure raises a toast and leaves the field unchanged.
- `Avatar`: renders the image when a URL is present, initials when it is not.
- `contact-form-fields.test.ts` extended for the new state round-trip
  (empty → populated → payload).
- Existing leads/contacts page tests must continue to pass; the list-cell change
  is presentational.

## Risks

- **Orphaned uploads** from abandoned create forms. Accepted, as reasoned above.
  A periodic sweep of `retail/<tenant>/crm-photos` against the two columns would
  reclaim them if it ever matters; not built now.
- **Cloudinary not configured** in an environment. Uploads fail with a clear
  message and every other part of both forms keeps working.
