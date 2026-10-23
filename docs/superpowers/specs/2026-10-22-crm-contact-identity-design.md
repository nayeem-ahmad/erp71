# CRM contact identity — a person, a company, and many leads

**Date:** 2026-10-22
**Status:** Draft pending review
**Asked as:** several leads need to share one email; a contact is the unique person (an individual, or one of several people at an organization); existing rows must stay intact.

---

## Problem

A lead stores its own copy of name, mobile, email, and LinkedIn, and Postgres refuses a second lead in the tenant with the same normalized mobile, email, or LinkedIn profile (`@@unique` on `mobile_norm`, `email_norm`, `linkedin_norm`). A shared inbox (`info@shop.com`) cannot be filed twice. A second deal for someone already in the pipeline cannot be filed at all.

`CrmContact` is a separate address book. `company` is a free-text string, not a company row. Nothing points a lead at a contact or a contact at a customer. `Customer` already knows `INDIVIDUAL` and `ORGANIZATION`, and its email is already not unique.

## Goals

- Many leads may share one email. Many leads may point at one contact, so one person can have a second deal.
- A contact is a person. Mobile and LinkedIn identify that person. Email does not.
- An organization is the company. Many contacts belong to one. An individual is a contact with no organization.
- A lead points at a contact when one is known, and at that contact's organization. Pipeline fields stay on the lead.
- Every existing lead, contact, customer, conversation, activity, and campaign recipient keeps its id and its current user-visible fields. The backfill only adds rows and fills new nullable columns.

## Non-goals (v1)

- Merging two contacts, two leads, or two customers, including ones that already share a mobile spelling.
- Deleting a row, or blanking `CrmContact.company`, `Lead.email`, `Lead.mobile`, or any other column a screen already shows.
- Dropping `@@unique([tenant_id, mobile])` on `CrmContact`.
- An Organization admin page, a new permission, or a new nav entry.
- A warning that blocks a second open lead for the same contact.
- Rewriting `Customer` rows, campaign-recipient history, or conversation history.
- Matching or grouping anyone by email during the backfill.

---

## Model

| Record | Role | Uniqueness per tenant |
|---|---|---|
| `CrmContact` | A person | `mobile_norm` and `linkedin_norm`. Raw `mobile` stays unique as well. Email is indexed only. |
| `Organization` | A company | `name_norm` (trim, lowercase, internal whitespace collapsed to one space). Display `name` keeps the spelling of the oldest contact's `company`. |
| `Lead` | One deal | None of mobile, email, or LinkedIn. It stores `contact_id` and `organization_id`. The snapshot columns stay and the list keeps reading them. |
| `Customer` | Who gets invoiced | Unchanged. `phone` stays unique. The backfill never updates a customer. |

`onDelete` for every new foreign key is `SetNull`. Deleting a contact or an organization must not delete a lead.

A lead may have a null `contact_id` only before the backfill has seen it. After the backfill, every existing lead has a contact: either an existing person matched by mobile or LinkedIn, or a new contact copied from that lead.

## What the backfill is allowed to write

Allowed:

- Insert `Organization` rows.
- Insert a `CrmContact` when a lead matches no existing contact by mobile or LinkedIn.
- Set null columns only: `CrmContact.organization_id`, `CrmContact.customer_id`, `CrmContact.mobile_norm`, `CrmContact.email_norm`, `CrmContact.linkedin_norm`, `Lead.contact_id`, `Lead.organization_id`, and a `Lead.*_norm` that is still null.

Not allowed:

- `UPDATE` of any other column on `Lead`, `CrmContact`, or `Customer`.
- `DELETE` of any row.
- A second contact for a mobile or LinkedIn profile that already has one.
- Joining two leads because they share an email.
- Choosing a customer when the leads that share a contact name two different `converted_customer_id` values. Leave `customer_id` null.

Re-running the backfill is a no-op: a column that is already set is left alone, and an organization `name_norm` that already exists is not inserted again.

### Link rules

Compare mobiles with `normalizeLeadMobile` and LinkedIn URLs with `normalizeProfileUrl` (`packages/shared-types/lead-identity.ts`). Also compare a contact's raw `mobile` / `linkedin_url`, not only the norm columns, so a contact whose norm was left null (a spelling collision) is still found.

1. A lead with a mobile matches the oldest contact in the tenant with that normalized mobile. Link it. Do not change either name. Record a name mismatch when the trimmed names differ.
2. A lead with no mobile and a LinkedIn URL matches the oldest contact with that normalized profile. Same rule.
3. Otherwise insert one contact copied from the lead (name, mobile, email, LinkedIn, address, and the three norms). Two leads that share only an email become two contacts.
4. When several leads share a mobile, the contact inserted for them is copied from the oldest lead. The other leads link to it and keep their own email on the lead row.
5. `Lead.organization_id` is copied from the linked contact when the lead's column is null.
6. `CrmContact.customer_id` is set when every converted lead linked to that contact names the same customer, and the column is null.

### Organizations

Group contacts with a non-blank `company` by `tenant_id` plus `name_norm`. One organization per group. `name` is the oldest contact's trimmed `company` string, original casing kept. Set `organization_id` on every contact in the group whose column is null. Leave the `company` string as stored.

"Karim Traders" and " karim traders " are one organization. "Karim Traders Ltd" is a different one.

### Lead norm columns

`sync-lead-identity` today leaves `email_norm` (and the other norms) null on every lead after the oldest one that shares a value, so the unique indexes can be created. Those indexes are dropped in this change. The sync then fills any still-null `mobile_norm`, `email_norm`, and `linkedin_norm` from the raw columns, including on leads that share a value. It still writes no display column.

### Contact norm columns

`mobile_norm` and `linkedin_norm` get a unique index. The columns are added null, so `db push` can create the indexes, and the sync then fills them. The oldest contact keeps a contested value. A later contact that normalizes to the same value keeps a null norm and keeps its raw mobile or URL. Nothing is deleted. `email_norm` is filled on every contact that has an email, and it is not unique.

## Forward behavior

**New or edited lead.** Find a contact by normalized mobile, then by normalized LinkedIn. If one exists, set `contact_id` and do not update that contact's name, email, mobile, company, or notes. If none exists, create one from the form. Shared email is saved. The lead still stores its own snapshot. Import `skip` / `upsert` still treats mobile and LinkedIn as the same lead, so re-importing a file does not mint a second deal. Email alone does not skip or merge a row. A second deal for someone already known is created from the lead form.

**Contact save.** Keep writing the `company` string. Find or create the organization by `name_norm` and set `organization_id`. Clearing the company string clears `organization_id` and leaves the organization row in place. A duplicate email is saved. A duplicate normalized mobile or LinkedIn profile is rejected. The raw mobile unique stays, so two different spellings that have not been normalized still cannot be inserted once they share a norm.

**Storefront enquiry.** A mobile that matches one contact logs the message on that contact's newest open lead, or creates a lead pointing at the contact when none is open. An email that matches exactly one contact does the same. An email that matches several contacts creates a new lead and a new contact. An existing lead's status, owner, and fields stay as they are.

**Campaign upload.** An address that matches more than one lead leaves `lead_id` null. An address that matches more than one contact leaves `contact_id` null. The campaign still sends once per address. Existing recipient rows are not rewritten.

**Convert.** Unchanged for the customer: the lead still creates or links a customer by mobile, as today. Also set `CrmContact.customer_id` from `converted_customer_id` when the contact's column is null.

## Deploy

Production applies schema with `prisma db push` inside `apps/backend/scripts/db-prepare.sh`, while the old backend is still serving. The migration file is dev history only.

This release is safe for that window:

- Every new column is nullable. The new table is empty until the sync inserts into it.
- No column the old backend reads is dropped or renamed. `CrmContact.company` stays. The raw contact mobile unique stays.
- The only destructive schema change is dropping the three lead unique indexes. That deletes no rows. The old process still refuses a duplicate in `assertIdentityFree` until the new process is swapped in.
- The sync that fills a second lead's `email_norm` runs after `db push` has dropped the unique index. Running it before the drop would throw and abort the deploy.

`db push` must not need `--accept-data-loss` for this change. The flag is already passed by the script; this release gives it nothing to drop.

## UI

No new page. The contact form keeps the company field and gains a read-only line naming the linked organization after save. The lead detail page names the linked contact (link to `/crm/contacts/:id`) and the organization when those ids are set. New strings go into all nine locales. UI rules in `CLAUDE.md` apply.

## Testing

Pure planners, no database, on the pattern of `planBackfill` in `lead-identity-backfill.spec.ts`:

- Two leads with one email both receive `email_norm`. No display column is in the update.
- Two contact mobiles that normalize together: both rows survive; only the oldest gets `mobile_norm`.
- Two company spellings that share a `name_norm` produce one organization and two links, and the link payload has no `company` key.
- Two leads that share only an email produce two contacts. Two leads that share a mobile produce one contact and two links. An existing contact with a different name is linked and not updated.
- A contact whose converted leads name two customers gets no `customer_id`.
- A second run against already-filled columns produces no inserts and no updates.

Service tests cover lead create linking an existing contact without calling `crmContact.update`, import not skipping on email, storefront logging onto the matched contact's open lead, and campaign resolution leaving `lead_id` null when two leads share the address.
