# Meeting minutes — design plan

Status: **agreed scope, 2026-10-30. Nothing here is built.** Written in answer to
"suggest a basic meeting minutes management module", then narrowed by the owner
to: *record meeting discussions and action points with assignee and deadline,
share and print the minutes in a good format, and email reminders to assignees.
The meeting platform itself is not the concern.*

The short version:

> **A meeting is a document: discussion points plus action points. Once
> finalized it is locked, printed, shared by link and emailed. Each action point
> has an assignee and a deadline, and a daily job sends that assignee email
> reminders until the point is done.**

---

## 1. Decisions taken

| Question | Decision |
|---|---|
| Who can be assigned an action point | **Team members and outsiders.** A team member gets in-app and email reminders and sees the point under *My action points*. An outsider (for example a supplier contact) is a name plus an email address and gets email only. |
| Who sees a meeting in the app | **Attendees and managers.** The organizer, the attendees and every action-point assignee can see it. A *view all meetings* permission shows everything. |
| Sharing | **Public link and email.** A read-only link that can be revoked, built like the quotation share (`/q/[token]`). There is also a one-click *Email minutes to attendees*. |
| Packaging | **Included for all tenants.** It is a core module with its own *Meetings* sidebar section, gated only by role permissions. It is not an add-on. |
| Video calls / meeting platform | **Out of scope.** Meet71 is a separate product. |

Also out of scope for v1, and can be added later: recurring meetings, sending
the agenda out beforehand, attendee sign-off or approval, AI drafting of minutes
from notes, file attachments, and turning an action point into a project task.

---

## 2. What it reuses

| Need | Existing piece |
|---|---|
| `MIN-2026-0012` numbering | `document-numbering` / `DocumentSequence` |
| Public read-only link | `Quotation.share_token` / `share_token_at` and the `/q/[token]` page; `short-links` for a short URL |
| Print layout | Browser print with an `@media print` stylesheet, as the invoice, quotation and Mushak documents do |
| Email | `EmailService.send…` with `tenantId` set, so the mail goes out under the shop's own sender identity. It does **not** set `billTenantId`: reminders are operational mail to the shop's own staff, not customer marketing. Outsider reminders are the one open question, see §7. |
| In-app and push notifications | `notifications` + `push` |
| Scheduled reminders | `@Cron(..., { timeZone: 'Asia/Dhaka' })`, the same pattern as the reminders in `notifications.service.ts` |
| Edit trail after finalization | `record-history` |
| Page chrome | `PageShell`, `PageHeader`, `ModalShell`, `DataTable` (see `docs/ui-design-guidelines.md`) |

---

## 3. Data model (Prisma)

Every model carries `tenant_id` and is scoped by `TenantInterceptor`.

```prisma
enum MeetingStatus     { DRAFT FINALIZED CANCELLED }
enum MeetingType       { MANAGEMENT STAFF CLIENT SUPPLIER OTHER }
enum MeetingAttendeeRole { CHAIR MINUTE_TAKER MEMBER GUEST }
enum ActionItemStatus  { OPEN IN_PROGRESS DONE CANCELLED }
enum ActionItemPriority { LOW NORMAL HIGH }

model Meeting {
  id              String        @id @default(uuid())
  tenant_id       String
  store_id        String?
  meeting_number  String                     // MIN-2026-0012
  title           String
  type            MeetingType   @default(OTHER)
  starts_at       DateTime
  ends_at         DateTime?
  venue           String?                    // free text: room, address or call link
  summary         String?       @db.Text
  status          MeetingStatus @default(DRAFT)
  organizer_id    String                     // User
  created_by      String
  finalized_at    DateTime?
  finalized_by    String?
  share_token     String?       @unique      // clearing it revokes every shared link
  share_token_at  DateTime?
  created_at      DateTime      @default(now())
  updated_at      DateTime      @updatedAt

  attendees    MeetingAttendee[]
  points       MeetingPoint[]
  actionItems  MeetingActionItem[]

  @@unique([tenant_id, meeting_number])
  @@index([tenant_id, starts_at])
  @@index([tenant_id, status])
}

model MeetingAttendee {
  id           String              @id @default(uuid())
  tenant_id    String
  meeting_id   String
  user_id      String?                       // set for a team member
  name         String                        // copied from the user, or typed for a guest
  email        String?
  organization String?
  role         MeetingAttendeeRole @default(MEMBER)
  attended     Boolean             @default(true)

  @@index([tenant_id, user_id])
}

model MeetingPoint {                         // one discussion point
  id          String  @id @default(uuid())
  tenant_id   String
  meeting_id  String
  position    Int
  topic       String
  notes       String? @db.Text
  decision    String? @db.Text               // shown highlighted in print

  @@index([meeting_id, position])
}

model MeetingActionItem {
  id                String             @id @default(uuid())
  tenant_id         String
  meeting_id        String
  point_id          String?                  // the discussion point it came from
  position          Int
  description       String             @db.Text
  assignee_user_id  String?                  // team member, OR …
  assignee_name     String                   // … outsider name (copied for team members too)
  assignee_email    String?                  // required when assignee_user_id is null
  due_date          DateTime           @db.Date
  priority          ActionItemPriority @default(NORMAL)
  status            ActionItemStatus   @default(OPEN)
  completed_at      DateTime?
  completed_by      String?
  completion_note   String?
  assigned_notified_at DateTime?             // "you have a new action point" sent
  due_soon_notified_at DateTime?             // the day-before reminder sent
  last_overdue_notified_at DateTime?         // last overdue reminder sent
  created_at        DateTime           @default(now())
  updated_at        DateTime           @updatedAt

  @@index([tenant_id, status, due_date])
  @@index([tenant_id, assignee_user_id, status])
}
```

Why these choices:

- **Assignee name and email are copied onto the row.** The printed minutes and
  the reminder must still say who it was after a team member is removed or
  renamed. This is the same reason sales documents copy the customer's name.
- **Action points belong to the meeting, not to the point.** `point_id` is
  optional, so an action point can be recorded with no discussion point
  attached. Deleting a discussion point sets `point_id` to null and keeps the
  action point.
- **The reminder timestamps live on the row.** The cron job is then
  idempotent: running it twice on the same day sends nothing extra, and a
  deploy during the job's window cannot send duplicates.

---

## 4. Permissions (`packages/shared-types/index.ts`)

Named after the existing `VIEW_PROJECTS` / `VIEW_ALL_PROJECTS` / `MANAGE_PROJECTS` set:

| Permission | Grants |
|---|---|
| `VIEW_MEETINGS` | See meetings you organized, attended or hold an action point in. See *My action points*. |
| `VIEW_ALL_MEETINGS` | See every meeting and *All action points*. |
| `MANAGE_MEETINGS` | Create meetings and edit your own drafts. Finalize, cancel, share and email meetings you organized. |

Rules that do not need a permission:

- An assignee can always update the status of **their own** action point,
  including after the meeting is finalized. Finalizing locks the minutes, not
  the follow-up.
- Only the organizer, or someone with `VIEW_ALL_MEETINGS` plus
  `MANAGE_MEETINGS`, can edit a finalized meeting. That edit is written to
  `record-history`.

Default role grants follow how `VIEW_PROJECTS` / `VIEW_ALL_PROJECTS` /
`MANAGE_PROJECTS` are granted in the role matrix. Owners and admins get all
three permissions, and every role that can sign in gets at least
`VIEW_MEETINGS`, so any team member can see the action points assigned to them.

---

## 5. Backend (`apps/backend/src/meetings/`)

```
GET    /meetings                       list (filters: type, status, date range, search)
POST   /meetings                       create draft (with attendees, points, action items)
GET    /meetings/:id
PATCH  /meetings/:id                   replace attendees/points/actions in one transaction
POST   /meetings/:id/finalize          lock, then notify every assignee who has not been told yet
POST   /meetings/:id/cancel
POST   /meetings/:id/share             create or return the share token (+ short link)
DELETE /meetings/:id/share             revoke
POST   /meetings/:id/email             email minutes to the selected attendees

GET    /meeting-actions                ?scope=mine|all, status, overdue, assignee, meeting
PATCH  /meeting-actions/:id            status, completion_note (assignee or manager)

GET    /public/meetings/:token         no auth; read-only minutes for the share page
```

**When reminders go out.** Times are Asia/Dhaka. One cron job runs at 09:00
every day.

1. **On assignment.** When a meeting is finalized, every open action point with
   no `assigned_notified_at` gets a *"New action point from <meeting>"* email.
   A team member also gets an in-app notification. An action point added to a
   meeting that is already finalized is notified when it is saved. Draft
   meetings send nothing, so half-written minutes never email anyone.
2. **Due soon.** The day before `due_date`, if the point is still open, send one
   reminder, then set `due_soon_notified_at`.
3. **Overdue.** The day after `due_date`, then every 7 days until the point is
   `DONE` or `CANCELLED`, using `last_overdue_notified_at`.
4. **Organizer digest.** Each Monday, an organizer with overdue action points in
   their meetings gets one email listing them. One email per organizer, not one
   per action point.

Each reminder email holds: the meeting title and date, the action text, the
deadline, the organizer's name, and a link. A team member's link opens the
action point in the app. An outsider's link opens the public minutes page,
which works only when the meeting has a share token. Without a token the email
carries no link.

A cancelled meeting stops all of its reminders.

---

## 6. Frontend

Sidebar: a new **Meetings** section with *Meetings*, *My action points* and
*All action points*. The last one is visible only with `VIEW_ALL_MEETINGS`. The
open overdue count for the viewer goes on *My action points* as a sidebar badge.

| Page | Contents |
|---|---|
| `/meetings` | `DataTable`: number, title, type, date, organizer, status, and open/overdue action counts. Secondary columns use `hideOnMobile`. |
| `/meetings/new`, `/meetings/[id]/edit` | One form with four sections: **Details**, **Attendees** (team picker + "add guest"), **Discussion points** (reorderable; topic, notes, decision), **Action points** (description, assignee picker that also accepts a typed name + email, due date, priority, optional link to a discussion point). Saves as draft. |
| `/meetings/[id]` | The minutes as read-only, with *Finalize*, *Print*, *Share*, *Email* and *Edit* in the `PageHeader` actions. Action points can be ticked off inline. |
| `/meetings/[id]/print` | The print layout, see below. |
| `/meetings/actions` | *My action points*, grouped Overdue / This week / Later / Done. |
| `/meetings/actions/all` | The same list with an assignee filter. |
| `/m/[token]` | The public share page, read-only, with the same layout as the print page and a *Print* button. |

**Print layout (A4).** It uses the tenant logo and business name in the
header, the same as other printed documents, and then:

1. Title, meeting number, date and time, venue, type
2. Attendees: present and absent, with the chair and minute-taker marked
3. Discussion points, numbered. Each decision appears in a bordered
   "Decision:" block so it stands out from the notes.
4. Action point table: **No. · Action · Assignee · Deadline · Status**
5. Signature lines for the chair and the minute-taker
6. Footer: "Finalized on <date> by <name>" and page numbers

A draft prints with a **DRAFT** watermark. Dates use the tenant's time zone and
date format. Strings go through i18n, with Bangla script rendering in the print
font.

---

## 7. Open questions (can be settled during the build)

- **Should outsider reminder emails spend messaging credits?** The proposed
  answer is no, because the volume is low and the mail is operational. Revisit
  if the volume turns out to be high.
- **Can an outsider mark their own action point done** through a tokenized link
  in the email? Not in v1: the organizer updates it for them.
- **Reminder lead time.** It is fixed at 1 day before for v1. A per-tenant
  setting can come later if asked for.

---

## 8. Build order

1. Schema + migration, permissions, nav entry (`sync:nav-layout` for saved layouts)
2. Backend CRUD + finalize/lock + visibility rules, with tests
3. Create/edit form, detail page, list
4. Print layout + public share page
5. Email minutes + reminder cron (assignment, due-soon, overdue, organizer digest), with tests
6. *My action points* / *All action points* pages, sidebar badge
7. i18n (all nine locales), user-manual page
