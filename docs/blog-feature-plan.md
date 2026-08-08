# Blog — implementation plan

Status: **built, 2026-08-08.** Written as a proposal 2026-08-07; the plan below
is kept as the record of the decisions, with the corrections marked inline where
building it proved the plan wrong.

**Both halves shipped.** The plan scoped itself to option A (platform-authored)
and filed option B (tenant-authored storefront blog) as deliberately deferred;
in the event both were built, as separate model sets and separate services
exactly as §1 argued they would have to be. Sections below still read as
proposals — that is deliberate, they record why each choice was made — but the
scope decision in §1 no longer applies.

Goal: platform staff write posts once, and the same post can reach two
audiences — anonymous visitors on `erp71.com/blog` (SEO, launch announcements,
"how to run a shop in Bangladesh" content) and signed-in tenant users inside the
app (product updates, release notes).

---

## 1. Scope decision

"Platform admins/users" reads two ways, and they are different products:

**A. Platform-authored blog, tenant users + public read it.** One content store
owned by platform staff. This is what the plan below builds.

**B. Tenant-authored blog, one per shop, published on their storefront.** A
content module inside `(app)`, tenant-scoped, gated by a new `MANAGE_BLOG`
store permission, rendered under `/store/[slug]/blog`.

They share almost nothing. B is tenant-scoped (every row carries `tenant_id`,
every query goes through `TenantInterceptor`), needs a permission in the matrix,
needs per-tenant moderation and abuse handling, and lives on the storefront's
public surface where the tenant — not us — controls the copy. A is
platform-scoped, has no tenant column at all, and is guarded by
`PlatformAdminGuard`.

**This plan builds A.** B is a genuinely separate feature and is listed as
deferred in §10 with the reasons. If B is what was wanted, say so before Phase 1
lands — the schema is the part that would have to be redone.

Within A, "users" means *readers*, not authors. Tenant users do not write posts.

---

## 2. What already exists

Almost all the machinery this needs is in the repo already; very little of this
feature is new infrastructure.

| Piece | Location | Use here |
|---|---|---|
| `PlatformAdminGuard` (DB flag, email whitelist fallback) | `apps/backend/src/auth/platform-admin.guard.ts` | Guards every write endpoint |
| Platform-admin CRUD controller pattern | `apps/backend/src/short-links/short-links-admin.controller.ts` | Template for `admin/blog/*` |
| Unguarded public endpoint alongside a guarded one | `apps/backend/src/short-links/short-links.controller.ts:24-35` | Template for public read endpoints |
| Global `ThrottlerGuard` | `apps/backend/src/app.module.ts:225` | Rate-limits the public endpoints for free |
| Cloudinary uploads with a recoverable handle | `AssetsService.uploadBuffer()`, `apps/backend/src/assets/assets.service.ts:60` | Cover images |
| `storage_key` alongside `file_url` | `CrmContactAttachment`, `packages/database/prisma/schema.prisma:1918-1938` | Column shape to copy |
| Markdown renderer, HTML-stripping | `apps/frontend/src/components/ui/Markdown.tsx` | Base for the article renderer |
| `react-markdown` + `remark-gfm` | already in `apps/frontend/package.json` | No new dependency |
| Marketing chrome | `MarketingNav.tsx`, `MarketingFooter.tsx` | Public blog layout |
| Public marketing route precedent | `apps/frontend/src/app/pricing/`, `/contact`, `/terms` | Where `/blog` goes |
| Nav registry + layout seed | `packages/shared-types/navigation.ts:228-252, 401-405` | Admin sidebar entry |
| Trilingual catalog (`en`/`bn`/`ms`) | `apps/frontend/src/lib/localization/config.ts:4-34` | Post translations |
| `@nestjs/schedule` cron precedent | `apps/backend/src/notifications/notifications.service.ts` | Scheduled publishing |

Three things that **do not** exist and are part of the work:

1. **No `sitemap.ts`.** `apps/frontend/src/app/robots.ts` exists and allows `/`,
   but nothing emits a sitemap. A blog without one is the usual reason posts
   take weeks to get indexed.
2. **No server-side data fetching on any public page.** ~~Blog pages are the
   first server components in the marketing tree.~~ **Overstated — corrected
   while building.** Server components on public routes already existed:
   `/q/[token]` and `/store/[slug]/p/[productId]` are both server-rendered, and
   `publicApiBase()` exists precisely for them. The real gap was narrower and
   still real: every *marketing* page (`/`, `/pricing`, `/contact`, `/terms`,
   `/privacy`, `/refund`, `/sla`) is `'use client'`, and a client component
   cannot export `metadata` — so all seven shipped with the layout's default
   title and no description at all, which is what a search result and a shared
   link both read. Fixed by splitting each into a server `page.tsx` that exports
   metadata and renders the existing client component unchanged.
3. **Platform-admin mutations are not audited.** `AuditInterceptor` returned
   early when there was no tenant, so every `admin/*` route was invisible in
   `audit_log`, short-links included. **Fixed** — see §8 for what the fix turned
   out to require beyond the obvious change.

---

## 3. Data model

New models, no `tenant_id` anywhere — these are platform rows, like
`PlatformSetting` (`packages/database/prisma/schema.prisma:4338-4349`).

```prisma
model BlogPost {
  id       String @id @default(uuid())
  slug     String @unique

  /// DRAFT | SCHEDULED | PUBLISHED | ARCHIVED
  status   String @default("DRAFT")
  /// PUBLIC | IN_APP | BOTH — which surfaces may serve this post.
  audience String @default("BOTH")

  category_id String?

  cover_image_url String?
  /// Cloudinary's handle. Without it the row can be deleted and the image
  /// billed forever — the trap CrmContactAttachment already avoids.
  cover_storage_key String?
  cover_alt         String?

  author_user_id String?
  /// Byline shown to readers. Denormalised on purpose: the author may leave,
  /// and the post should keep its name.
  author_name  String?
  author_title String?

  published_at  DateTime?
  scheduled_for DateTime?
  /// Bumped by hand for a meaningful revision; drives "Updated on".
  edited_at     DateTime?

  reading_minutes Int @default(0)
  view_count      Int @default(0)

  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt
  deleted_at DateTime?

  category     BlogCategory?         @relation(fields: [category_id], references: [id])
  author       User?                 @relation(fields: [author_user_id], references: [id])
  translations BlogPostTranslation[]
  slugHistory  BlogPostSlug[]

  @@index([status, published_at])
  @@index([category_id, status, published_at])
  @@map("blog_posts")
}

model BlogPostTranslation {
  id      String @id @default(uuid())
  post_id String
  /// en | bn | ms — matches localeRegistry
  locale  String

  title    String
  excerpt  String?
  body_md  String

  seo_title       String?
  seo_description String?

  post BlogPost @relation(fields: [post_id], references: [id], onDelete: Cascade)

  @@unique([post_id, locale])
  @@map("blog_post_translations")
}

model BlogCategory {
  id         String  @id @default(uuid())
  slug       String  @unique
  name_en    String
  name_bn    String?
  name_ms    String?
  sort_order Int     @default(0)

  posts BlogPost[]

  @@map("blog_categories")
}

/// Every slug a post has ever had, so a rename 301s instead of 404ing.
model BlogPostSlug {
  id         String   @id @default(uuid())
  post_id    String
  slug       String   @unique
  created_at DateTime @default(now())

  post BlogPost @relation(fields: [post_id], references: [id], onDelete: Cascade)

  @@map("blog_post_slugs")
}
```

### Why the copy lives in a translation table and not on the post

The obvious alternative is `title`/`body_md` on `BlogPost` with a translation
table for the *other* locales. That is one table fewer and it is wrong: it
creates two places a post's English title can live, and every read has to decide
which wins. Putting **all** copy in `BlogPostTranslation` with an `en` row
required by the service keeps one answer to "what is this post's title in locale
X" — fall back to `en`, always.

This matters more here than in most modules. The customer base is Bangladeshi
retailers; a Bangla post is not a nice-to-have, and the public page needs to be
able to serve `bn` content at a `bn` URL with its own SEO description.

### Why a slug-history table

Editors rename posts. A renamed post whose old URL 404s loses whatever ranking
and inbound links it had, which is the entire point of publishing it. Four
columns and one lookup on the 404 path buys a permanent 301. `ShortLink` solves
a different problem and cannot be reused for this.

### Deliberately not in v1

- **Tags.** One category per post covers `/blog/category/<slug>` and is enough
  for the first few dozen posts. A many-to-many tag table is easy to add later
  and impossible to populate meaningfully now.
- **Comments.** Moderation is an ongoing staffing cost, not a feature.
- **Revision history.** `updated_at` plus git-less prose is a real gap, but a
  revisions table doubles the write path. Add it when someone has actually
  overwritten a post they wanted back.

Migration: `npm run db:migrate` in `packages/database` per CLAUDE.md. Note the
open TODO about production running `db push --accept-data-loss` rather than
`migrate deploy` — this feature only adds tables, so it is safe under either,
but it is one more reason to close that item.

---

## 4. Backend

New module `apps/backend/src/blog/`, following the short-links split:

```
blog/
  blog.module.ts
  blog.service.ts            # shared query/mutation logic
  blog.service.spec.ts
  blog.controller.ts         # public reads, no guard
  blog.controller.spec.ts
  blog-admin.controller.ts   # JwtAuthGuard + PlatformAdminGuard
  blog.dto.ts
  blog-slug.ts               # slugify + uniqueness suffix
  blog-slug.spec.ts
  reading-time.ts            # words / 200, floor 1
  reading-time.spec.ts
```

### Public endpoints (unguarded, `ThrottlerGuard` applies)

| Route | Notes |
|---|---|
| `GET /blog/posts?page&limit&category&locale` | `status=PUBLISHED`, `published_at <= now`, `audience in (PUBLIC, BOTH)`, `deleted_at is null`. Returns list projections — excerpt, not body. `limit` capped server-side the way `storefront.controller.ts:45` caps its page size. |
| `GET /blog/posts/:slug?locale` | Full body. Falls back through `BlogPostSlug` on a miss and returns `{ redirect_to }` so the frontend can 301. |
| `GET /blog/categories` | For the filter chips. |
| `POST /blog/posts/:slug/view` | Fire-and-forget increment. Separate from the GET so a crawler or an ISR revalidation does not inflate the count. |

### In-app endpoint (JWT, any authenticated tenant user)

| Route | Notes |
|---|---|
| `GET /blog/updates?since` | `audience in (IN_APP, BOTH)`. Same store, different filter. |

### Admin endpoints (`JwtAuthGuard` + `PlatformAdminGuard`)

`GET/POST/PATCH/DELETE /admin/blog/posts[/:id]`, plus:

- `POST /admin/blog/posts/:id/publish` and `/unpublish` — status transitions are
  their own endpoints, not a `PATCH status` field, so the service can enforce
  the rules in one place (see below) and so the audit trail names the action.
- `POST /admin/blog/posts/:id/cover` — multipart, goes through
  `AssetsService.uploadBuffer()` and stores **both** `cover_image_url` and
  `cover_storage_key`. Replacing or deleting a cover deletes the old asset
  first. Do not use `uploadFile()`: it returns only `secure_url`, and a URL
  cannot be turned back into a `public_id` — that is exactly the leak recorded
  in TODO.md for voucher and project attachments.
- `GET /admin/blog/posts/:id/preview-token` — see §7.
- `GET/POST/PATCH/DELETE /admin/blog/categories[/:id]`.

### Rules the service owns

1. **Publishing requires an `en` translation with a non-empty title and body.**
   A post with a blank body is not publishable; catching it at the API is the
   only place that holds for every caller.
2. **`published_at` is set once**, on first publish, and never moved by a later
   edit. `edited_at` carries revisions. Otherwise a corrected typo re-dates the
   post to the top of the list.
3. **Slug is generated from the `en` title, then frozen.** Editors can override
   it; on change, the previous slug is written to `BlogPostSlug`. Collisions get
   a `-2` suffix — `short-link-code.ts` is the precedent for keeping this in a
   tested pure helper rather than inline in the service.
4. **`reading_minutes` is computed on save**, not on read.
5. **Delete is soft** (`deleted_at`) and drops the Cloudinary asset.

### Scheduled publishing

One cron in `BlogService`, hourly, flipping `SCHEDULED` → `PUBLISHED` where
`scheduled_for <= now`, then calling the revalidation hook (§6).
`@nestjs/schedule` is already wired and `NotificationsService` is the pattern.

---

## 5. Admin UI

Route `apps/frontend/src/app/(app)/admin/blog/`:

- `page.tsx` — post list: status chip, audience, category, author, published
  date, view count. Filters by status. `PageShell` + `PageHeader` +
  `modulePageBreadcrumbs`, exactly like `admin/page.tsx:29-38`.
- `new/page.tsx` and `[id]/page.tsx` — the editor.
- `categories/page.tsx` — small CRUD table.

**Editor shape.** Two panes on desktop, tabbed on mobile: a markdown textarea on
the left, live `ArticleMarkdown` preview on the right. A locale switcher at the
top swaps which `BlogPostTranslation` is being edited, with an "untranslated"
badge for locales that have no row. A right-hand settings rail holds slug,
category, audience, cover, scheduling and SEO fields.

**Not a WYSIWYG.** A rich-text editor means a new dependency, an HTML sanitizer
on both ends, and a stored format that is harder to diff than markdown. The repo
already renders markdown safely; the authors are staff. Markdown plus a live
preview is the smaller and safer build. Revisit only if non-technical authors
are onboarded.

**Nav.** Add to `packages/shared-types/navigation.ts`:

```ts
'admin.blog': { id: 'admin.blog', kind: 'link', icon: 'Newspaper',
                labelKey: 'sidebar.items.blog', href: '/admin/blog' },
```

plus a `layoutNode('admin.blog', 'admin', <n>)` in the seed layout, then run
`packages/database/prisma/sync-nav-layout.ts` so existing installs pick it up —
a registry entry alone does not appear in a tenant that already has a stored
layout.

UI must follow `docs/ui-design-guidelines.md`: `PageShell`/`PageHeader`,
`ModalShell` for any dialog, `blue-600` only, toasts through the global store,
inline field errors, `text-sm`/`text-xs`, ≥44px touch targets.

---

## 6. Public UI

```
apps/frontend/src/app/blog/
  page.tsx                  # index, paginated
  [slug]/page.tsx           # article
  category/[slug]/page.tsx  # filtered index
  rss.xml/route.ts
apps/frontend/src/app/sitemap.ts      # new file, covers blog + static pages
```

**Server components.** These fetch from `process.env.BACKEND_URL` directly, not
through the `/api/v1/*` rewrite in `next.config.js:15-22` — the rewrite is a
browser-side path and a server component calling its own origin is a needless
round trip. `export const revalidate = 300` gives ISR; publishing calls a
revalidation route so a new post appears immediately rather than up to 5 minutes
later.

**Per article:** `generateMetadata` with title, description, canonical,
OpenGraph image (the cover) and Twitter card; JSON-LD `Article`; `MarketingNav`
+ `MarketingFooter`; author byline; reading time; category chip; prev/next.

**`ArticleMarkdown`** — a sibling of `Markdown.tsx`, not a reuse of it. The
existing component is documented as sized for the 380px AI chat panel: it
flattens every heading to one size and disallows `img` because its input is
partly tenant-controlled. An article needs a real `h2`/`h3` hierarchy and inline
images. What must carry over unchanged is `skipHtml` and the absence of
`rehype-raw` — raw HTML in post bodies stays unrendered even though authors are
trusted, because "trusted" is an account-compromise away from false.

**Locale.** The reader's locale picks the translation, falling back to `en`.
Emit `hreflang` alternates for the locales a post actually has.

**Entry points.** Add "Blog" to `MarketingNav` (its `active` prop is a union —
extend it to `'home' | 'pricing' | 'blog'`) and to `MarketingFooter`.

**`robots.ts` needs no change** — it allows `/` and disallows only `/q/` and
`/s/`. The new `sitemap.ts` should list the marketing pages as well as posts;
that is overdue independent of this feature.

---

## 7. In-app surface

Route `apps/frontend/src/app/(app)/whats-new/`, reading `GET /blog/updates`.
Sidebar entry, or a link in the existing help menu.

**Unread indicator — do not fan out notifications.** The obvious move is to
write a `Notification` row per user on publish. `Notification` is keyed
`(tenant_id, user_id)` (`packages/database/prisma/schema.prisma:3129-3145`), so
one post means one row for every user of every tenant on the platform, and a
mistaken publish means deleting all of them. Instead: store a
`blog_last_seen_at` timestamp per user and show the dot when the newest
published post is later than it. One column, one comparison, no fan-out, and
unpublishing a post silently un-dots everyone.

**Preview.** Draft posts must be viewable before publish without being public.
`GET /admin/blog/posts/:id/preview-token` mints a short-lived signed token; the
public article route accepts `?preview=<token>` and serves a non-published post
only for a valid, unexpired token, always with `noindex`. Reusing the admin JWT
would mean the preview only works in a logged-in browser, which defeats the
"send it to someone for review" use case.

---

## 8. Security notes

- **Draft leakage is the main risk.** Status/audience filtering lives in one
  service method that every read path calls; the spec pins it. A separate spec
  asserts the public controller has no `@UseGuards` *and* returns nothing
  unpublished — the two facts have to be tested together, because the guard's
  absence is deliberate.
- **XSS via post body** — mitigated by `skipHtml` and no `rehype-raw`. A test
  asserting a `<script>` in a body renders as text belongs in
  `ArticleMarkdown.test.tsx`.
- **Cover uploads** — validate mime type and size at the DTO, and store
  `storage_key` so deletes are possible.
- **Audit gap — fixed, via option (b).** The interceptor now records
  platform-scoped actions with a null tenant, which retrofits short-links,
  tenant admin, platform settings and plan edits at the same time. Two things
  the plan did not anticipate:

  *What admits a request.* The gate is `request.isPlatformAdmin === true`, set
  by `PlatformAdminGuard`, **not** the mere absence of a tenant. Storefront
  customers and portal users are authenticated and tenant-less too, and their
  order placements are not platform administration.

  *The entity derivation had to change with it.* Leaving `admin` in the path
  would have filed the blog, the tenant list and platform settings all under one
  `admin` entity, making the entity filter useless for exactly the rows that
  most need it. Stripping the prefix then exposed a latent trap: `OPAQUE_ID_RE`
  matches any `[A-Za-z0-9_-]{16,}`, and `platform-settings` is 17 characters of
  that — promoted to the entity segment it read as an opaque id, and
  `resolveAuditTarget` bails out entirely on those, so `PUT
  /admin/platform-settings/email` would have gone **unrecorded rather than
  merely mislabelled**. Fixed by never treating an all-lowercase hyphenated word
  as an id: uuid, cuid and nanoid all carry digits.

  Rows are read back through `GET /admin/audit-logs` — writing them without
  somewhere to read them would only have moved the gap, since `GET /audit-logs`
  filters strictly on `tenant_id`.
- Public list/detail endpoints are covered by the global throttler; the view
  counter should be throttled more tightly than the default.

---

## 9. Phases

**Phase 1 — content spine.** Schema + migration; `BlogModule` with the service,
admin controller and pure helpers; admin list + editor + categories; nav entry.
Nothing public. Ends with staff able to write and store a post. Specs: slug
generation and collisions, reading time, status transitions, publish validation,
`PlatformAdminGuard` coverage on every admin route.

**Phase 2 — public blog.** `/blog`, `/blog/[slug]`, category pages,
`ArticleMarkdown`, metadata + JSON-LD, `sitemap.ts`, `rss.xml`, marketing nav
and footer links, slug-history 301s. Ends with a post readable and indexable.

**Phase 3 — in-app updates.** `GET /blog/updates`, `/whats-new`,
`blog_last_seen_at` and the unread dot, sidebar entry.

**Phase 4 — editorial polish.** Scheduled publishing cron, preview tokens,
translation UI completeness (untranslated badges, per-locale SEO), view counts,
related posts, on-publish revalidation.

Phases 2 and 3 are independent of each other and can be built in either order.
Phase 1 blocks both.

**Testing per phase**, matching the repo's habits: backend service + controller
specs (`short-links.controller.spec.ts` is the template), frontend page tests
(`page.test.tsx` sits beside every marketing page), and one Playwright pass over
publish → read at the end of Phase 2.

---

## 10. Deferred, with reasons

- ~~**Tenant-authored blogs on storefronts** (option B in §1).~~ **Built.**
  Separate models (`TenantBlogPost`, `TenantBlogCategory`, `TenantBlogPostSlug`,
  `TenantBlogSettings`), a separate service, and three permissions rather than
  the one the plan guessed at: `VIEW_BLOG` / `MANAGE_BLOG` / `PUBLISH_BLOG`.
  Splitting publish out was not in the plan and is the better shape — drafting a
  post is ordinary content work, putting it on the shop's public page is the
  shop speaking in its own name, and an owner may want the second held by fewer
  people. Taking a live post *down* is `PUBLISH_BLOG` too, for the same reason.
  Slugs are unique per shop rather than globally: two shops may both write
  "eid-sale", and each owns that URL under its own storefront.
- **Comments** — recurring moderation cost, spam surface, and a GDPR-shaped
  data-retention question for a marketing blog that gets its discussion on
  social media anyway.
- **Newsletter / email digest on publish** — `EmailService` and Resend are
  already wired, so this is small, but it needs a subscriber list and an
  unsubscribe flow before it is legal to send.
- **Revision history and draft autosave** — add when an author has actually lost
  work.
- **Tags** — §3.
- **Rich-text editor** — §5.
