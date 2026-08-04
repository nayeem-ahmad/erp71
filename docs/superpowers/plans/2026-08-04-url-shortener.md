# URL Shortener & Public Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user share a quotation or a storefront product as a short link that a customer can open with no login.

**Architecture:** Three layers. Public views (`/q/[token]`, `/store/[slug]/p/[productId]`) are what a customer actually opens. A share token on the quotation authorizes the view. A generic `ShortLink` table maps a 7-char code to a target URL, resolved by `/s/[code]`. The token is the authority and the code is only an alias, so clearing a token revokes every link ever sent for that quotation, short or long.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, Next.js 15 (App Router), Jest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-04-url-shortener-design.md`

## Global Constraints

- The Prisma model is **`Quotation`**, not `SalesQuotation`. The spec uses the wrong name throughout; the schema at `packages/database/prisma/schema.prisma:2404` is authoritative. Its fields are `id, tenant_id, store_id, customer_id, quote_number, total_amount, status, valid_until, version, original_quote_id, notes, created_at`.
- `QuotationItem` has only `id, quotation_id, product_id, quantity, unit_price`. There is no line-level discount or tax. Do not invent them.
- **Production never runs the migrations directory.** It reconciles schema with `prisma db push` on container start. Migration SQL files exist to keep history honest. Every migration must therefore be additive and idempotent (`IF NOT EXISTS`), matching the header comment style of `packages/database/prisma/migrations/20260804120000_add_referral_click_tracking/migration.sql`.
- Locally, `prisma migrate dev` fails (no `_prisma_migrations` table). Apply schema changes with `npx prisma db push` from `packages/database`, then `npx prisma generate`.
- After editing `packages/shared-types/`, rebuild it or the backend and frontend will not see the change: `cd packages/shared-types && npm run build`.
- Adding any key to `apps/frontend/src/lib/localization/messages/en/` **requires** the same key in `bn/` and `ms/`. `catalog.test.ts` asserts all three catalogs have an identical key set and will fail otherwise.
- Backend tests: `cd apps/backend && npx jest <path>`. Frontend tests: `cd apps/frontend && npx jest <path>`.
- **A green Jest run is not evidence that the backend compiles.** `apps/backend/jest.config.js` configures ts-jest with `diagnostics: { warnOnly: true }`, so type errors are printed as warnings and never fail the suite. Separately, `apps/backend/tsconfig.json` sets `"strictNullChecks": false`, which defeats discriminated-union narrowing on a negated discriminant — `if (!result.ok) { result.reason }` does **not** type-check, even though it reads as obviously correct and Jest goes green. Every backend task must therefore run `cd apps/backend && npx tsc --noEmit -p tsconfig.build.json` (the config `nest build` uses) and report its output before committing. Several unrelated files have pre-existing errors; note them, don't fix them.
- UI rules are non-negotiable: `PageShell` + `PageHeader` on every `(app)` page, `ModalShell` for every modal, `blue-600` as the only accent, `formatBDT()` for money, no `rounded-2xl`/`rounded-3xl`, no arbitrary hex classes. See `CLAUDE.md`.
- Backend code style is 4-space indent, `@Injectable()` services taking `DatabaseService` as `db`. Follow `apps/backend/src/crm-lead-taxonomy/` as the reference for a tenant-scoped module.
- Commit after every task. Branch is `claude/url-shortening-feature-da20e9`; do not commit to `main`.

---

## File Structure

**Created — backend**
- `apps/backend/src/short-links/is-safe-target.ts` — pure URL validation. No imports from the app.
- `apps/backend/src/short-links/is-safe-target.spec.ts`
- `apps/backend/src/short-links/short-link-code.ts` — base62 code generation.
- `apps/backend/src/short-links/short-links.service.ts`
- `apps/backend/src/short-links/short-links.service.spec.ts`
- `apps/backend/src/short-links/short-links.dto.ts`
- `apps/backend/src/short-links/short-links.controller.ts` — public resolver + tenant CRUD.
- `apps/backend/src/short-links/short-links-admin.controller.ts` — platform staff.
- `apps/backend/src/short-links/short-links.module.ts`
- `apps/backend/src/sales-quotations/public-quotation.dto.ts` — the sanitized allow-list.
- `apps/backend/src/sales-quotations/public-quotation.dto.spec.ts`
- `apps/backend/src/sales-quotations/public-quotations.controller.ts`

**Created — frontend**
- `apps/frontend/src/app/s/[code]/route.ts`
- `apps/frontend/src/app/s/[code]/leaving/page.tsx`
- `apps/frontend/src/app/q/[token]/page.tsx`
- `apps/frontend/src/app/q/[token]/PublicQuotationView.tsx`
- `apps/frontend/src/app/store/[slug]/p/[productId]/page.tsx`
- `apps/frontend/src/components/share/ShareModal.tsx`
- `apps/frontend/src/components/share/ShareModal.test.tsx`
- `apps/frontend/src/components/short-links/ShortLinkManager.tsx` — the form and table both shortener pages render.
- `apps/frontend/src/components/short-links/ShortLinkManager.test.tsx`
- `apps/frontend/src/app/(app)/admin/url-shortener/page.tsx`
- `apps/frontend/src/app/(app)/settings/url-shortener/page.tsx`

**Modified**
- `packages/database/prisma/schema.prisma` — `ShortLink`, two enums, two `Quotation` columns.
- `packages/shared-types/index.ts` — `MANAGE_SHORT_LINKS`.
- `packages/shared-types/navigation.ts` — two nav nodes + two default-layout entries.
- `apps/backend/src/app.module.ts` — register `ShortLinksModule`.
- `apps/backend/src/sales-quotations/sales-quotations.{service,controller,module}.ts` — share/revoke.
- `apps/backend/src/navigation/nav-layout-merge.spec.ts` — layout tests.
- `apps/frontend/src/lib/routes.ts`, `apps/frontend/src/lib/api.ts`
- `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts` and `settingsExtras.ts`
- `apps/frontend/src/app/(app)/settings/page.tsx` — hub card.
- `apps/frontend/src/app/(app)/sales/quotes/[id]/page.tsx` — Share button.

---

## Task 1: Target URL validation

The security-critical unit. Pure, no dependencies, tested first and heavily. An error here turns `app.erp71.com` into a phishing vector.

> **DONE — and the Step 3 code below is superseded. Read the shipped file, not this plan.**
>
> Review found four real bypasses in the reference implementation written here, closed over three fix rounds (`24df6c56`, `177fb556`, `ce4d0575`, `8641007c`). The code below still shows the vulnerable version; `apps/backend/src/short-links/is-safe-target.ts` is the truth. What changed and why it matters to anyone touching this function later:
>
> 1. **Control characters.** The protocol-relative guard checked the raw string while validation parsed the URL, and `new URL()` strips ASCII tab/CR/LF first — so `/\n/evil.com` passed as internal and resolved to `https://evil.com/`. Input is now rejected outright if it contains those characters.
> 2. **Percent-encoding.** `new URL().pathname` does not decode `%XX`, so `/%6c%6fgin` slipped the `/login` blocklist that a router would have decoded and matched. The path is now decoded (failing closed on a malformed escape) before the prefix check.
> 3. **IPv6, three times.** Enumerating bad forms failed in three successive rounds: `::ffff:` IPv4-mapped, then `fe80::/10` written as impossible 3-hex-digit prefixes, then `::127.0.0.1` / `::ffff:0:7f00:1` reaching an allow-by-default tail. The branch is now an **allow-list** — a bracketed IPv6 literal is accepted only when its first hextet is in `0x2000`–`0x3fff` (global unicast `2000::/3`), everything else rejected. That one rule subsumes all five special cases the earlier rounds accumulated.
>
> The lesson for later tasks: a blocklist has to be right about every form that exists, an allow-list only about the one that is safe. Prefer the allow-list wherever this codebase validates untrusted input.
>
> Known deferred gap: Teredo (`2001::/32`) sits inside `2000::/3` and can encode a tunneled private IPv4. Obscure; logged for final-review triage.

**Files:**
- Create: `apps/backend/src/short-links/is-safe-target.ts`
- Test: `apps/backend/src/short-links/is-safe-target.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isSafeTarget(raw: string): SafeTargetResult` where
  `type SafeTargetResult = { ok: true; kind: 'internal' | 'external'; url: string } | { ok: false; reason: string }`.
  Tasks 3, 4 and 11 depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/short-links/is-safe-target.spec.ts`:

```ts
import { isSafeTarget } from './is-safe-target';

/**
 * The shortener accepts external URLs, so this function is the only thing
 * standing between a link on our own domain and a credential-harvesting page.
 * The cases below are weighted to hostile input rather than happy paths.
 */
describe('isSafeTarget', () => {
    describe('accepts', () => {
        it('an internal absolute path', () => {
            expect(isSafeTarget('/q/aB3xK9mQ')).toEqual({
                ok: true,
                kind: 'internal',
                url: '/q/aB3xK9mQ',
            });
        });

        it('an internal path with a query string', () => {
            const result = isSafeTarget('/store/acme/shop?category=phones');
            expect(result).toMatchObject({ ok: true, kind: 'internal' });
        });

        it('an https URL', () => {
            expect(isSafeTarget('https://example.com/page')).toMatchObject({
                ok: true,
                kind: 'external',
            });
        });

        it('a plain http URL', () => {
            expect(isSafeTarget('http://example.com')).toMatchObject({
                ok: true,
                kind: 'external',
            });
        });

        it('trims surrounding whitespace before validating', () => {
            expect(isSafeTarget('  https://example.com  ')).toMatchObject({
                ok: true,
                url: 'https://example.com/',
            });
        });
    });

    describe('rejects dangerous schemes', () => {
        it.each([
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            'data:text/html;base64,PHNjcmlwdD4=',
            'file:///etc/passwd',
            'ftp://example.com',
            'vbscript:msgbox(1)',
        ])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });
    });

    describe('rejects protocol-relative URLs', () => {
        // "//evil.com" is a *path* to the naive check and a full URL to a browser.
        it('a bare protocol-relative URL', () => {
            expect(isSafeTarget('//evil.com')).toMatchObject({ ok: false });
        });

        it('a backslash-disguised protocol-relative URL', () => {
            expect(isSafeTarget('/\\evil.com')).toMatchObject({ ok: false });
        });
    });

    describe('rejects private and loopback hosts', () => {
        it.each([
            'http://localhost/admin',
            'http://LOCALHOST/admin',
            'http://127.0.0.1',
            'http://127.1.2.3',
            'http://10.0.0.5',
            'http://172.16.4.9',
            'http://172.31.255.255',
            'http://192.168.1.1',
            'http://169.254.169.254/latest/meta-data',
            'http://[::1]/',
            'http://[fd00::1]/',
            'http://box.local',
            'http://svc.internal',
        ])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });

        it('allows a public address in an adjacent range', () => {
            expect(isSafeTarget('http://172.32.0.1')).toMatchObject({ ok: true });
            expect(isSafeTarget('http://11.0.0.1')).toMatchObject({ ok: true });
        });
    });

    describe('rejects embedded credentials', () => {
        it('a URL with a userinfo section', () => {
            expect(isSafeTarget('https://apple.com@evil.com/')).toMatchObject({ ok: false });
        });
    });

    describe('rejects internal auth paths', () => {
        it.each([
            '/login',
            '/signup',
            '/reset-password?token=x',
            '/verify-email',
            '/accept-invitation',
            '/LOGIN',
        ])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });

        it('allows a path that merely starts with the same letters', () => {
            expect(isSafeTarget('/loginary')).toMatchObject({ ok: true });
        });
    });

    describe('rejects malformed input', () => {
        it.each(['', '   ', 'not a url', 'relative/path'])('%s', (input) => {
            expect(isSafeTarget(input)).toMatchObject({ ok: false });
        });

        it('rejects a target longer than 2048 characters', () => {
            expect(isSafeTarget(`https://example.com/${'a'.repeat(2100)}`)).toMatchObject({
                ok: false,
            });
        });
    });

    it('gives a reason on every rejection', () => {
        const result = isSafeTarget('javascript:alert(1)');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend && npx jest src/short-links/is-safe-target.spec.ts
```

Expected: FAIL — `Cannot find module './is-safe-target'`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/src/short-links/is-safe-target.ts`:

```ts
/**
 * Validates a short-link target.
 *
 * The shortener accepts external URLs, which means a link on our own domain can
 * point anywhere. This function is the control that keeps `app.erp71.com/s/...`
 * from becoming a clean phishing vector, so it fails closed: anything it cannot
 * confidently classify is rejected.
 *
 * It is deliberately free of NestJS and Prisma imports so it can be read and
 * tested as a unit.
 */

export type SafeTargetResult =
    | { ok: true; kind: 'internal' | 'external'; url: string }
    | { ok: false; reason: string };

const MAX_LENGTH = 2048;

/**
 * Shortening an auth path lets a link on our own domain walk someone into a
 * credential form from an untrusted context, which is the exact shape of a
 * phishing flow that a wary user would otherwise catch by reading the domain.
 */
const BLOCKED_INTERNAL_PREFIXES = [
    '/login',
    '/signup',
    '/reset-password',
    '/verify-email',
    '/accept-invitation',
];

function isBlockedInternalPath(pathname: string): boolean {
    const lower = pathname.toLowerCase();
    return BLOCKED_INTERNAL_PREFIXES.some(
        // Prefix match on a segment boundary, so `/loginary` stays allowed.
        (prefix) => lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`),
    );
}

function isPrivateIpv4(host: string): boolean {
    const parts = host.split('.');
    if (parts.length !== 4) return false;
    const octets = parts.map((part) => Number(part));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

    const [a, b] = octets;
    if (a === 127) return true;                      // loopback
    if (a === 10) return true;                       // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true;          // RFC1918
    if (a === 169 && b === 254) return true;          // link-local, incl. cloud metadata
    if (a === 0) return true;
    return false;
}

function isPrivateHost(rawHost: string): boolean {
    const host = rawHost.toLowerCase();

    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;

    // URL keeps IPv6 literals in brackets.
    if (host.startsWith('[') && host.endsWith(']')) {
        const inner = host.slice(1, -1);
        if (inner === '::1' || inner === '::') return true;
        // fc00::/7 — unique local addresses.
        if (inner.startsWith('fc') || inner.startsWith('fd')) return true;
        return false;
    }

    return isPrivateIpv4(host);
}

export function isSafeTarget(raw: string): SafeTargetResult {
    const value = (raw ?? '').trim();

    if (!value) return { ok: false, reason: 'Target URL is required.' };
    if (value.length > MAX_LENGTH) {
        return { ok: false, reason: `Target URL must be under ${MAX_LENGTH} characters.` };
    }

    if (value.startsWith('/')) {
        // `//host` is protocol-relative and `/\host` is the same thing to a
        // browser — both look like paths here and navigate off-site.
        if (value.startsWith('//') || value.startsWith('/\\')) {
            return { ok: false, reason: 'Protocol-relative URLs are not allowed.' };
        }

        let pathname = value;
        try {
            pathname = new URL(value, 'https://app.erp71.com').pathname;
        } catch {
            return { ok: false, reason: 'Target path is malformed.' };
        }

        if (isBlockedInternalPath(pathname)) {
            return { ok: false, reason: 'Authentication pages cannot be shortened.' };
        }

        return { ok: true, kind: 'internal', url: value };
    }

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { ok: false, reason: 'Enter a full URL starting with https:// or an internal path starting with /.' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'Only http and https links are allowed.' };
    }

    if (parsed.username || parsed.password) {
        return { ok: false, reason: 'URLs containing a username or password are not allowed.' };
    }

    if (isPrivateHost(parsed.hostname)) {
        return { ok: false, reason: 'Private and local network addresses are not allowed.' };
    }

    return { ok: true, kind: 'external', url: parsed.toString() };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend && npx jest src/short-links/is-safe-target.spec.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/short-links/is-safe-target.ts apps/backend/src/short-links/is-safe-target.spec.ts && git commit -m "feat(short-links): validate short-link targets against phishing and SSRF input"
```

---

## Task 2: Schema — ShortLink model and quotation share token

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260804200000_add_short_links/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma client models `shortLink` and the `Quotation.share_token` / `Quotation.share_token_at` fields, used by Tasks 3 and 5.

- [ ] **Step 1: Add the enums and model to the schema**

Append to `packages/database/prisma/schema.prisma`:

```prisma
enum ShortLinkKind {
  ENTITY
  MANUAL
}

enum ShortLinkEntity {
  QUOTATION
  STOREFRONT_PRODUCT
}

/// A code-to-URL alias. For entity links the token in `target_url` is the real
/// authority; this row is only an alias, which is why revoking a quotation's
/// token kills every link to it without touching this table.
model ShortLink {
  id            String    @id @default(uuid())
  /// Null for links minted by platform staff, who sit outside any tenant.
  tenant_id     String?
  code          String    @unique
  /// Internal path or absolute http(s) URL. Always validated by isSafeTarget().
  target_url    String
  /// Human label for the shortener list. Manual links only.
  label         String?
  kind          ShortLinkKind
  entity_type   ShortLinkEntity?
  entity_id     String?
  click_count   Int       @default(0)
  last_click_at DateTime?
  created_by    String?
  created_at    DateTime  @default(now())
  revoked_at    DateTime?

  tenant Tenant? @relation(fields: [tenant_id], references: [id], onDelete: Cascade)

  @@index([tenant_id, created_at])
  @@index([entity_type, entity_id])
}
```

- [ ] **Step 2: Add the relation to Tenant and the columns to Quotation**

In `model Tenant`, alongside the other relation lists, add:

```prisma
  shortLinks ShortLink[]
```

In `model Quotation` (`packages/database/prisma/schema.prisma:2404`), add after `notes`:

```prisma
  /// Unguessable secret authorizing the public view. Clearing it revokes every
  /// link ever shared for this quotation, short or long.
  share_token       String?  @unique
  share_token_at    DateTime?
```

- [ ] **Step 3: Write the migration SQL**

Create `packages/database/prisma/migrations/20260804200000_add_short_links/migration.sql`:

```sql
-- Short links and public quotation share tokens.
--
-- Sharing a quotation was blocked by there being nothing public to share, not
-- by link length: every quotation route is authenticated. `share_token` is the
-- authority for the public view and the short code is only an alias, so
-- clearing the token revokes every link ever sent for that quotation.
--
-- `tenant_id` is nullable because platform staff mint links while belonging to
-- no tenant.
--
-- Additive only. Production reconciles its schema with `prisma db push` on
-- container start and never runs this directory, so this file keeps the history
-- honest rather than being the mechanism that ships the change.

DO $$ BEGIN
    CREATE TYPE "ShortLinkKind" AS ENUM ('ENTITY', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "ShortLinkEntity" AS ENUM ('QUOTATION', 'STOREFRONT_PRODUCT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ShortLink" (
    "id"            TEXT NOT NULL,
    "tenant_id"     TEXT,
    "code"          TEXT NOT NULL,
    "target_url"    TEXT NOT NULL,
    "label"         TEXT,
    "kind"          "ShortLinkKind" NOT NULL,
    "entity_type"   "ShortLinkEntity",
    "entity_id"     TEXT,
    "click_count"   INTEGER NOT NULL DEFAULT 0,
    "last_click_at" TIMESTAMP(3),
    "created_by"    TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at"    TIMESTAMP(3),

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShortLink_code_key" ON "ShortLink"("code");
CREATE INDEX IF NOT EXISTS "ShortLink_tenant_id_created_at_idx" ON "ShortLink"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "ShortLink_entity_type_entity_id_idx" ON "ShortLink"("entity_type", "entity_id");

DO $$ BEGIN
    ALTER TABLE "ShortLink"
        ADD CONSTRAINT "ShortLink_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "share_token" TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "share_token_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_share_token_key" ON "Quotation"("share_token");
```

- [ ] **Step 4: Apply the schema locally and regenerate the client**

```bash
cd packages/database && npx prisma db push && npx prisma generate
```

Expected: "Your database is now in sync with your Prisma schema" and a regenerated client. Do **not** run `prisma migrate dev` — it fails on this database, which has no `_prisma_migrations` table.

- [ ] **Step 5: Verify the client exposes the new model**

```bash
cd packages/database && node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();console.log(typeof p.shortLink.findMany)"
```

Expected: `function`.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260804200000_add_short_links && git commit -m "feat(db): add ShortLink model and quotation share token"
```

---

## Task 3: Short-link code generation and service

**Files:**
- Create: `apps/backend/src/short-links/short-link-code.ts`
- Create: `apps/backend/src/short-links/short-links.service.ts`
- Test: `apps/backend/src/short-links/short-links.service.spec.ts`

**Interfaces:**
- Consumes: `isSafeTarget` from Task 1; the `shortLink` Prisma model from Task 2.
- Produces:
  - `generateShortCode(): string` — 7-char base62.
  - `ShortLinksService` with:
    - `createManual(tenantId: string | null, userId: string, dto: { target_url: string; label?: string }): Promise<ShortLinkView>`
    - `createForEntity(input: { tenantId: string; userId: string; entityType: 'QUOTATION' | 'STOREFRONT_PRODUCT'; entityId: string; targetUrl: string }): Promise<ShortLinkView>`
    - `resolve(code: string, countClick: boolean): Promise<{ target_url: string; kind: 'internal' | 'external' }>`
    - `list(tenantId: string | null): Promise<ShortLinkView[]>`
    - `revoke(id: string, tenantId: string | null): Promise<void>`
  - `type ShortLinkView = { id: string; code: string; target_url: string; label: string | null; click_count: number; last_click_at: Date | null; created_at: Date; revoked_at: Date | null }`
  - Tasks 4, 5 and 11 depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/short-links/short-links.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShortLinksService } from './short-links.service';

/**
 * The cases below concentrate on the three places a mistake is expensive:
 * rejecting an unsafe target before it is ever stored, keeping a revoked link
 * dead, and never leaking one tenant's links into another tenant's list.
 */
describe('ShortLinksService', () => {
    const db = {
        shortLink: {
            create: jest.fn(),
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
    } as any;

    let service: ShortLinksService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new ShortLinksService(db);
    });

    const row = (overrides: Record<string, unknown> = {}) => ({
        id: 'link-1',
        tenant_id: 'tenant-1',
        code: 'aB3xK9m',
        target_url: 'https://example.com/',
        label: 'Campaign',
        kind: 'MANUAL',
        entity_type: null,
        entity_id: null,
        click_count: 0,
        last_click_at: null,
        created_by: 'user-1',
        created_at: new Date('2026-08-04'),
        revoked_at: null,
        ...overrides,
    });

    describe('createManual', () => {
        it('rejects an unsafe target before touching the database', async () => {
            await expect(
                service.createManual('tenant-1', 'user-1', { target_url: 'javascript:alert(1)' }),
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(db.shortLink.create).not.toHaveBeenCalled();
        });

        it('stores the normalized URL returned by validation', async () => {
            db.shortLink.create.mockResolvedValue(row());
            await service.createManual('tenant-1', 'user-1', { target_url: '  https://example.com  ' });

            expect(db.shortLink.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        target_url: 'https://example.com/',
                        kind: 'MANUAL',
                        tenant_id: 'tenant-1',
                        created_by: 'user-1',
                    }),
                }),
            );
        });

        it('retries with a fresh code when the generated one collides', async () => {
            const collision = Object.assign(new Error('unique'), { code: 'P2002' });
            db.shortLink.create.mockRejectedValueOnce(collision).mockResolvedValueOnce(row());

            const result = await service.createManual('tenant-1', 'user-1', {
                target_url: 'https://example.com',
            });

            expect(db.shortLink.create).toHaveBeenCalledTimes(2);
            const first = db.shortLink.create.mock.calls[0][0].data.code;
            const second = db.shortLink.create.mock.calls[1][0].data.code;
            expect(first).not.toEqual(second);
            expect(result.code).toBe('aB3xK9m');
        });
    });

    describe('createForEntity', () => {
        it('reuses the existing live link rather than minting a second code', async () => {
            db.shortLink.findFirst.mockResolvedValue(row({ kind: 'ENTITY' }));

            const result = await service.createForEntity({
                tenantId: 'tenant-1',
                userId: 'user-1',
                entityType: 'QUOTATION',
                entityId: 'quote-1',
                targetUrl: '/q/token-1',
            });

            expect(db.shortLink.create).not.toHaveBeenCalled();
            expect(result.code).toBe('aB3xK9m');
        });

        it('mints a link when none exists', async () => {
            db.shortLink.findFirst.mockResolvedValue(null);
            db.shortLink.create.mockResolvedValue(row({ kind: 'ENTITY', target_url: '/q/token-1' }));

            await service.createForEntity({
                tenantId: 'tenant-1',
                userId: 'user-1',
                entityType: 'QUOTATION',
                entityId: 'quote-1',
                targetUrl: '/q/token-1',
            });

            expect(db.shortLink.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        kind: 'ENTITY',
                        entity_type: 'QUOTATION',
                        entity_id: 'quote-1',
                        target_url: '/q/token-1',
                    }),
                }),
            );
        });
    });

    describe('resolve', () => {
        it('returns the target and its kind', async () => {
            db.shortLink.findUnique.mockResolvedValue(row({ target_url: '/q/token-1' }));
            await expect(service.resolve('aB3xK9m', false)).resolves.toEqual({
                target_url: '/q/token-1',
                kind: 'internal',
            });
        });

        it('increments the click count only when asked', async () => {
            db.shortLink.findUnique.mockResolvedValue(row());
            await service.resolve('aB3xK9m', false);
            expect(db.shortLink.update).not.toHaveBeenCalled();

            await service.resolve('aB3xK9m', true);
            expect(db.shortLink.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'link-1' },
                    data: expect.objectContaining({ click_count: { increment: 1 } }),
                }),
            );
        });

        it('404s a revoked link', async () => {
            db.shortLink.findUnique.mockResolvedValue(row({ revoked_at: new Date() }));
            await expect(service.resolve('aB3xK9m', true)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('404s an unknown code', async () => {
            db.shortLink.findUnique.mockResolvedValue(null);
            await expect(service.resolve('nope123', true)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('404s a stored target that no longer validates', async () => {
            // Defence in depth: a row written before a rule tightened must not
            // start redirecting just because it is already in the table.
            db.shortLink.findUnique.mockResolvedValue(row({ target_url: 'javascript:alert(1)' }));
            await expect(service.resolve('aB3xK9m', true)).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('list', () => {
        it('scopes to the tenant', async () => {
            db.shortLink.findMany.mockResolvedValue([row()]);
            await service.list('tenant-1');
            expect(db.shortLink.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenant_id: 'tenant-1' } }),
            );
        });

        it('lists every tenant for platform staff', async () => {
            db.shortLink.findMany.mockResolvedValue([row()]);
            await service.list(null);
            expect(db.shortLink.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: {} }),
            );
        });
    });

    describe('revoke', () => {
        it('refuses to revoke another tenant’s link', async () => {
            db.shortLink.updateMany.mockResolvedValue({ count: 0 });
            await expect(service.revoke('link-1', 'tenant-2')).rejects.toBeInstanceOf(NotFoundException);
        });

        it('marks the link revoked', async () => {
            db.shortLink.updateMany.mockResolvedValue({ count: 1 });
            await service.revoke('link-1', 'tenant-1');
            expect(db.shortLink.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'link-1', tenant_id: 'tenant-1' },
                    data: expect.objectContaining({ revoked_at: expect.any(Date) }),
                }),
            );
        });
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend && npx jest src/short-links/short-links.service.spec.ts
```

Expected: FAIL — `Cannot find module './short-links.service'`.

- [ ] **Step 3: Write the code generator**

Create `apps/backend/src/short-links/short-link-code.ts`:

```ts
import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const LENGTH = 7;

/**
 * 62^7 ≈ 3.5 trillion codes. Random rather than sequential so a code carries no
 * information about how many links exist or what was created next to it.
 */
export function generateShortCode(): string {
    let out = '';
    for (let i = 0; i < LENGTH; i += 1) {
        out += ALPHABET[randomInt(ALPHABET.length)];
    }
    return out;
}
```

- [ ] **Step 4: Write the service**

Create `apps/backend/src/short-links/short-links.service.ts`:

```ts
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { isSafeTarget } from './is-safe-target';
import { generateShortCode } from './short-link-code';

export type ShortLinkView = {
    id: string;
    code: string;
    target_url: string;
    label: string | null;
    click_count: number;
    last_click_at: Date | null;
    created_at: Date;
    revoked_at: Date | null;
};

type EntityType = 'QUOTATION' | 'STOREFRONT_PRODUCT';

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class ShortLinksService {
    constructor(private readonly db: DatabaseService) {}

    async createManual(
        tenantId: string | null,
        userId: string,
        dto: { target_url: string; label?: string },
    ): Promise<ShortLinkView> {
        const checked = isSafeTarget(dto.target_url);
        if (!checked.ok) throw new BadRequestException(checked.reason);

        return this.insertWithCode({
            tenant_id: tenantId,
            target_url: checked.url,
            label: dto.label ?? null,
            kind: 'MANUAL',
            created_by: userId,
        });
    }

    async createForEntity(input: {
        tenantId: string;
        userId: string;
        entityType: EntityType;
        entityId: string;
        targetUrl: string;
    }): Promise<ShortLinkView> {
        const checked = isSafeTarget(input.targetUrl);
        if (!checked.ok) throw new BadRequestException(checked.reason);

        // Idempotent: reopening the share modal must not mint a second code for
        // the same quotation, or every reopen would leave another live link.
        const existing = await this.db.shortLink.findFirst({
            where: {
                tenant_id: input.tenantId,
                entity_type: input.entityType,
                entity_id: input.entityId,
                target_url: checked.url,
                revoked_at: null,
            },
        });
        if (existing) return this.toView(existing);

        return this.insertWithCode({
            tenant_id: input.tenantId,
            target_url: checked.url,
            label: null,
            kind: 'ENTITY',
            entity_type: input.entityType,
            entity_id: input.entityId,
            created_by: input.userId,
        });
    }

    async resolve(code: string, countClick: boolean): Promise<{ target_url: string; kind: 'internal' | 'external' }> {
        const link = await this.db.shortLink.findUnique({ where: { code } });
        if (!link || link.revoked_at) throw new NotFoundException('Link not found');

        // Re-validate on read. A row written before a rule tightened must not keep
        // redirecting simply because it is already stored.
        const checked = isSafeTarget(link.target_url);
        if (!checked.ok) throw new NotFoundException('Link not found');

        if (countClick) {
            await this.db.shortLink.update({
                where: { id: link.id },
                data: { click_count: { increment: 1 }, last_click_at: new Date() },
            });
        }

        return { target_url: checked.url, kind: checked.kind };
    }

    async list(tenantId: string | null): Promise<ShortLinkView[]> {
        const rows = await this.db.shortLink.findMany({
            where: tenantId ? { tenant_id: tenantId } : {},
            orderBy: { created_at: 'desc' },
            take: 200,
        });
        return rows.map((row) => this.toView(row));
    }

    async revoke(id: string, tenantId: string | null): Promise<void> {
        const result = await this.db.shortLink.updateMany({
            where: tenantId ? { id, tenant_id: tenantId } : { id },
            data: { revoked_at: new Date() },
        });
        // updateMany rather than update so a wrong-tenant id is a 404 rather than
        // a successful write against someone else's row.
        if (result.count === 0) throw new NotFoundException('Link not found');
    }

    private async insertWithCode(data: Record<string, unknown>): Promise<ShortLinkView> {
        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
            try {
                const created = await this.db.shortLink.create({
                    data: { ...data, code: generateShortCode() } as any,
                });
                return this.toView(created);
            } catch (error: any) {
                if (error?.code !== 'P2002') throw error;
            }
        }
        throw new InternalServerErrorException('Could not allocate a short code, please try again.');
    }

    private toView(row: any): ShortLinkView {
        return {
            id: row.id,
            code: row.code,
            target_url: row.target_url,
            label: row.label,
            click_count: row.click_count,
            last_click_at: row.last_click_at,
            created_at: row.created_at,
            revoked_at: row.revoked_at,
        };
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/backend && npx jest src/short-links/short-links.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/short-links && git commit -m "feat(short-links): add code generation and link service"
```

---

## Task 4: Short-link controllers, module and permission

**Files:**
- Create: `apps/backend/src/short-links/short-links.dto.ts`
- Create: `apps/backend/src/short-links/short-links.controller.ts`
- Create: `apps/backend/src/short-links/short-links-admin.controller.ts`
- Create: `apps/backend/src/short-links/short-links.module.ts`
- Modify: `packages/shared-types/index.ts`
- Modify: `apps/backend/src/app.module.ts`

**Interfaces:**
- Consumes: `ShortLinksService` from Task 3.
- Produces: HTTP surface used by Tasks 6, 11, 12:
  - `GET  /short-links/resolve/:code` — public, no click count.
  - `POST /short-links/resolve/:code` — public, counts the click.
  - `GET/POST /short-links`, `DELETE /short-links/:id` — tenant, `MANAGE_SHORT_LINKS`.
  - `GET/POST /admin/short-links`, `DELETE /admin/short-links/:id` — platform staff.
  - `StorePermission.MANAGE_SHORT_LINKS` exported from `@erp71/shared-types`.

- [ ] **Step 1: Add the permission to shared-types**

In `packages/shared-types/index.ts`, add to the `StorePermission` object (line 29 onward), following the existing key style:

```ts
  MANAGE_SHORT_LINKS: "MANAGE_SHORT_LINKS",
```

Then in `ROLE_DEFAULT_PERMISSIONS` (line 99 onward), add to the `MANAGER` array:

```ts
    StorePermission.MANAGE_SHORT_LINKS,
```

`OWNER` receives it automatically via `Object.values(StorePermission)`. Do not add it to `CASHIER` or `ACCOUNTANT`.

- [ ] **Step 2: Rebuild shared-types**

```bash
cd packages/shared-types && npm run build
```

Expected: clean `tsc` run. Without this the backend will not see the new permission.

- [ ] **Step 3: Write the DTOs**

Create `apps/backend/src/short-links/short-links.dto.ts`:

```ts
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateShortLinkDto {
    @IsString()
    @MinLength(1)
    @MaxLength(2048)
    target_url!: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    label?: string;
}
```

- [ ] **Step 4: Write the tenant and public controller**

Create `apps/backend/src/short-links/short-links.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ShortLinksService } from './short-links.service';
import { CreateShortLinkDto } from './short-links.dto';

@Controller('short-links')
export class ShortLinksController {
    constructor(private readonly service: ShortLinksService) {}

    /**
     * Public: peek at a target without counting a click. Used by the off-domain
     * interstitial, which re-resolves the code rather than trusting a query
     * param — otherwise anyone could craft an erp71.com link that displays one
     * destination and carries another.
     *
     * No auth guard by design. Covered by the global ThrottlerGuard.
     */
    @Get('resolve/:code')
    peek(@Param('code') code: string) {
        return this.service.resolve(code, false);
    }

    /** Public: resolve and count the click. Called by the /s/[code] handler. */
    @Post('resolve/:code')
    resolve(@Param('code') code: string) {
        return this.service.resolve(code, true);
    }

    @Get()
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    @RequireStorePermission(StorePermission.MANAGE_SHORT_LINKS)
    list(@Tenant() tenant: TenantContext) {
        return this.service.list(tenant.tenantId);
    }

    @Post()
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    @RequireStorePermission(StorePermission.MANAGE_SHORT_LINKS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateShortLinkDto) {
        return this.service.createManual(tenant.tenantId, tenant.userId, dto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, StorePermissionGuard)
    @UseInterceptors(TenantInterceptor)
    @RequireStorePermission(StorePermission.MANAGE_SHORT_LINKS)
    async revoke(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        await this.service.revoke(id, tenant.tenantId);
        return { success: true };
    }
}
```

- [ ] **Step 5: Write the platform-admin controller**

Create `apps/backend/src/short-links/short-links-admin.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ShortLinksService } from './short-links.service';
import { CreateShortLinkDto } from './short-links.dto';

/**
 * Platform staff sit outside any tenant, so these links are stored with a null
 * tenant_id and the list is deliberately unscoped.
 */
@Controller('admin/short-links')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class ShortLinksAdminController {
    constructor(private readonly service: ShortLinksService) {}

    @Get()
    list() {
        return this.service.list(null);
    }

    @Post()
    create(@Req() req: any, @Body() dto: CreateShortLinkDto) {
        return this.service.createManual(null, req.user?.userId, dto);
    }

    @Delete(':id')
    async revoke(@Param('id') id: string) {
        await this.service.revoke(id, null);
        return { success: true };
    }
}
```

- [ ] **Step 6: Write the module and register it**

Create `apps/backend/src/short-links/short-links.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ShortLinksService } from './short-links.service';
import { ShortLinksController } from './short-links.controller';
import { ShortLinksAdminController } from './short-links-admin.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [ShortLinksController, ShortLinksAdminController],
    providers: [ShortLinksService],
    exports: [ShortLinksService],
})
export class ShortLinksModule {}
```

In `apps/backend/src/app.module.ts`, import `ShortLinksModule` and add it to the `imports` array beside the other feature modules.

- [ ] **Step 7: Verify the app compiles and routes register**

```bash
cd apps/backend && npx tsc --noEmit -p tsconfig.json
```

Expected: no new errors. Note any pre-existing errors before you start so you can tell them apart.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/short-links apps/backend/src/app.module.ts packages/shared-types && git commit -m "feat(short-links): expose public resolver, tenant CRUD and admin endpoints"
```

---

## Task 5: Quotation share endpoints and the sanitized public DTO

The highest-risk task. The DTO must be an explicit allow-list, never a spread of the Prisma row.

**Files:**
- Create: `apps/backend/src/sales-quotations/public-quotation.dto.ts`
- Test: `apps/backend/src/sales-quotations/public-quotation.dto.spec.ts`
- Create: `apps/backend/src/sales-quotations/public-quotations.controller.ts`
- Modify: `apps/backend/src/sales-quotations/sales-quotations.service.ts`
- Modify: `apps/backend/src/sales-quotations/sales-quotations.controller.ts`
- Modify: `apps/backend/src/sales-quotations/sales-quotations.module.ts`

**Interfaces:**
- Consumes: `ShortLinksService.createForEntity` from Task 3.
- Produces:
  - `toPublicQuotation(row: any): PublicQuotation` and the `PublicQuotation` type.
  - `POST /sales-quotations/:id/share` → `{ code: string; path: string }` where `path` is `/s/<code>`.
  - `DELETE /sales-quotations/:id/share` → `{ success: true }`.
  - `GET /public/quotations/:token` → `PublicQuotation`.
  - Used by Tasks 7 and 9.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/sales-quotations/public-quotation.dto.spec.ts`:

```ts
import { toPublicQuotation } from './public-quotation.dto';

/**
 * This DTO is the boundary between a tenant's internal record and a page any
 * stranger with a link can open. The key-set assertions below are the point of
 * the file: a column added to Quotation later must fail this test rather than
 * silently appear on a customer-facing page.
 */
describe('toPublicQuotation', () => {
    const row = () => ({
        id: 'quote-1',
        tenant_id: 'tenant-1',
        store_id: 'store-1',
        customer_id: 'cust-1',
        quote_number: 'Q-1001',
        total_amount: '15000.00',
        status: 'SENT',
        valid_until: new Date('2026-09-01'),
        version: 2,
        original_quote_id: 'quote-0',
        notes: 'Delivery within 7 days',
        created_at: new Date('2026-08-01'),
        share_token: 'secret-token',
        share_token_at: new Date('2026-08-02'),
        customer: { id: 'cust-1', name: 'Rahim Traders', phone: '01710000000', email: 'a@b.com' },
        items: [
            {
                id: 'item-1',
                quotation_id: 'quote-1',
                product_id: 'prod-1',
                quantity: 3,
                unit_price: '5000.00',
                product: {
                    id: 'prod-1',
                    name: 'Ceiling Fan',
                    sku: 'CF-01',
                    price: '5200.00',
                    reorder_level: 4,
                    safety_stock: 2,
                    lead_time_days: 14,
                    tenant_id: 'tenant-1',
                },
            },
        ],
        store: { id: 'store-1', name: 'Main Branch' },
    });

    it('exposes exactly the agreed top-level keys', () => {
        expect(Object.keys(toPublicQuotation(row())).sort()).toEqual(
            [
                'created_at',
                'customer_name',
                'items',
                'notes',
                'quote_number',
                'seller_name',
                'status',
                'total_amount',
                'valid_until',
                'version',
            ].sort(),
        );
    });

    it('exposes exactly the agreed line-item keys', () => {
        expect(Object.keys(toPublicQuotation(row()).items[0]).sort()).toEqual(
            ['line_total', 'product_name', 'quantity', 'unit_price'].sort(),
        );
    });

    it('never leaks the share token', () => {
        expect(JSON.stringify(toPublicQuotation(row()))).not.toContain('secret-token');
    });

    it('never leaks internal identifiers', () => {
        const json = JSON.stringify(toPublicQuotation(row()));
        for (const secret of ['tenant-1', 'store-1', 'cust-1', 'prod-1', 'quote-1', 'quote-0']) {
            expect(json).not.toContain(secret);
        }
    });

    it('never leaks internal product planning fields', () => {
        const json = JSON.stringify(toPublicQuotation(row()));
        expect(json).not.toContain('reorder_level');
        expect(json).not.toContain('safety_stock');
        expect(json).not.toContain('lead_time_days');
    });

    it('computes the line total from quantity and unit price', () => {
        expect(toPublicQuotation(row()).items[0]).toMatchObject({
            product_name: 'Ceiling Fan',
            quantity: 3,
            unit_price: 5000,
            line_total: 15000,
        });
    });

    it('falls back to a placeholder when the quotation has no customer', () => {
        const anonymous = { ...row(), customer: null };
        expect(toPublicQuotation(anonymous).customer_name).toBe('');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend && npx jest src/sales-quotations/public-quotation.dto.spec.ts
```

Expected: FAIL — `Cannot find module './public-quotation.dto'`.

- [ ] **Step 3: Write the DTO**

Create `apps/backend/src/sales-quotations/public-quotation.dto.ts`:

```ts
/**
 * The customer-facing shape of a quotation.
 *
 * Built as an explicit allow-list, never a spread of the Prisma row: this object
 * is served to anyone holding the link, so a column added to Quotation later must
 * fail the accompanying test rather than quietly appear on a public page. That is
 * also why no internal identifier is included — a customer needs to read a quote,
 * not to learn our tenant, store, product or customer ids.
 */

export type PublicQuotationItem = {
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

export type PublicQuotation = {
    quote_number: string;
    version: number;
    status: string;
    created_at: Date;
    valid_until: Date | null;
    customer_name: string;
    seller_name: string;
    notes: string | null;
    items: PublicQuotationItem[];
    total_amount: number;
};

const money = (value: unknown): number => Number(value ?? 0);

export function toPublicQuotation(row: any): PublicQuotation {
    const items: PublicQuotationItem[] = (row.items ?? []).map((item: any) => {
        const quantity = Number(item.quantity ?? 0);
        const unit_price = money(item.unit_price);
        return {
            product_name: item.product?.name ?? '',
            quantity,
            unit_price,
            line_total: quantity * unit_price,
        };
    });

    return {
        quote_number: row.quote_number,
        version: row.version,
        status: row.status,
        created_at: row.created_at,
        valid_until: row.valid_until ?? null,
        customer_name: row.customer?.name ?? '',
        seller_name: row.store?.name ?? '',
        notes: row.notes ?? null,
        items,
        total_amount: money(row.total_amount),
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/backend && npx jest src/sales-quotations/public-quotation.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Add the service methods**

In `apps/backend/src/sales-quotations/sales-quotations.service.ts`, add `randomBytes` to the imports (`import { randomBytes } from 'node:crypto';`), inject `ShortLinksService` into the constructor as `private readonly shortLinks: ShortLinksService`, and append these methods:

```ts
    /**
     * Mints (or reuses) the public link for a quotation.
     *
     * The token is the authority and the short code is only an alias, so this is
     * safe to call repeatedly: a second call returns the same link rather than
     * leaving another live URL behind every time someone opens the share modal.
     */
    async share(tenantId: string, userId: string, id: string) {
        const quote = await this.db.quotation.findFirst({ where: { id, tenant_id: tenantId } });
        if (!quote) throw new NotFoundException('Quotation not found');

        let token = quote.share_token;
        if (!token) {
            token = randomBytes(16).toString('base64url'); // ~22 chars, URL-safe
            await this.db.quotation.update({
                where: { id },
                data: { share_token: token, share_token_at: new Date() },
            });
        }

        const link = await this.shortLinks.createForEntity({
            tenantId,
            userId,
            entityType: 'QUOTATION',
            entityId: id,
            targetUrl: `/q/${token}`,
        });

        return { code: link.code, path: `/s/${link.code}` };
    }

    /**
     * Clearing the token is the whole revocation. Every link ever sent for this
     * quotation resolves through it, so short and long URLs die together.
     */
    async revokeShare(tenantId: string, id: string) {
        const result = await this.db.quotation.updateMany({
            where: { id, tenant_id: tenantId },
            data: { share_token: null, share_token_at: null },
        });
        if (result.count === 0) throw new NotFoundException('Quotation not found');
        return { success: true };
    }

    /** Public read by token. No tenant context — the token is the authorization. */
    async findByShareToken(token: string) {
        const quote = await this.db.quotation.findFirst({
            where: { share_token: token },
            include: {
                customer: { select: { name: true } },
                store: { select: { name: true } },
                items: { include: { product: { select: { name: true } } } },
            },
        });
        if (!quote) throw new NotFoundException('This link is no longer available');
        return toPublicQuotation(quote);
    }
```

Add `import { toPublicQuotation } from './public-quotation.dto';` and ensure `NotFoundException` is imported from `@nestjs/common`.

Note the `select` clauses: the includes pull only the fields the DTO needs. Pulling whole relations would work today and would be the thing that leaks when someone adds a cost column later.

- [ ] **Step 6: Add the controller routes**

In `apps/backend/src/sales-quotations/sales-quotations.controller.ts`, add to the existing authenticated controller:

```ts
    @Post(':id/share')
    share(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.share(tenant.tenantId, tenant.userId, id);
    }

    @Delete(':id/share')
    revokeShare(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.revokeShare(tenant.tenantId, id);
    }
```

Declare `@Delete(':id/share')` **before** the existing `@Delete(':id')`, or the more general route captures it and deleting a share would delete the quotation.

Create `apps/backend/src/sales-quotations/public-quotations.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { SalesQuotationsService } from './sales-quotations.service';

/**
 * No guard and no TenantInterceptor by design — the unguessable token is the
 * authorization, and the service resolves the tenant from it rather than from
 * anything the caller supplies.
 */
@Controller('public/quotations')
export class PublicQuotationsController {
    constructor(private readonly service: SalesQuotationsService) {}

    @Get(':token')
    findByToken(@Param('token') token: string) {
        return this.service.findByShareToken(token);
    }
}
```

In `apps/backend/src/sales-quotations/sales-quotations.module.ts`, add `ShortLinksModule` to `imports` and `PublicQuotationsController` to `controllers`.

- [ ] **Step 7: Verify compilation and the full backend suite**

```bash
cd apps/backend && npx tsc --noEmit -p tsconfig.json && npx jest src/sales-quotations src/short-links
```

Expected: no new type errors; all specs pass.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/sales-quotations && git commit -m "feat(quotations): add share link, revocation and sanitized public view"
```

---

## Task 6: Short-link resolver route and off-domain interstitial

**Files:**
- Create: `apps/frontend/src/app/s/[code]/route.ts`
- Create: `apps/frontend/src/app/s/[code]/leaving/page.tsx`

**Interfaces:**
- Consumes: `POST /short-links/resolve/:code` and `GET /short-links/resolve/:code` from Task 4.
- Produces: the `/s/<code>` URL that every share link uses.

- [ ] **Step 1: Write the resolver route**

Create `apps/frontend/src/app/s/[code]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';

/**
 * Short link: `/s/<code>` counts the click and forwards to the target.
 *
 * A server-side route handler rather than a client page, for the same reasons as
 * the referral route it mirrors: the redirect does not depend on JavaScript, and
 * a visitor who bounces immediately still counts.
 *
 * Internal targets redirect straight through, so a customer opening a shared
 * quotation sees no extra click. Off-domain targets go via an interstitial —
 * app.erp71.com must never silently bounce someone to a third-party site.
 *
 * Resolution is not best-effort (there is nowhere to go without it), but the
 * click count is: a tracking failure must never cost someone their destination.
 */
export const dynamic = 'force-dynamic';

const RESOLVE_TIMEOUT_MS = 3000;

function apiBase(): string {
    const configured = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'http://localhost:4000/api/v1';
}

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
    const { code } = await context.params;
    const notFound = new URL('/not-found', request.nextUrl.origin);

    if (!code) return NextResponse.redirect(notFound, { status: 302 });

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
        const response = await fetch(`${apiBase()}/short-links/resolve/${encodeURIComponent(code)}`, {
            method: 'POST',
            signal: controller.signal,
            cache: 'no-store',
        });
        clearTimeout(timeout);

        if (!response.ok) return NextResponse.redirect(notFound, { status: 302 });

        const body = await response.json();
        const data = body?.data ?? body;

        if (data?.kind === 'internal') {
            return NextResponse.redirect(new URL(data.target_url, request.nextUrl.origin), { status: 302 });
        }

        // The interstitial re-resolves the code itself rather than taking the
        // destination from a query param — otherwise anyone could craft an
        // erp71.com URL that displays one host and sends you to another.
        return NextResponse.redirect(
            new URL(`/s/${encodeURIComponent(code)}/leaving`, request.nextUrl.origin),
            { status: 302 },
        );
    } catch {
        return NextResponse.redirect(notFound, { status: 302 });
    }
}
```

- [ ] **Step 2: Write the interstitial page**

Create `apps/frontend/src/app/s/[code]/leaving/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, ShieldAlert } from 'lucide-react';

export const dynamic = 'force-dynamic';

function apiBase(): string {
    const configured = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'http://localhost:4000/api/v1';
}

/**
 * Shown before leaving app.erp71.com for a third-party site. The destination is
 * re-resolved from the code here rather than passed in the URL, so what the page
 * displays is always what the link actually stored.
 */
export default async function LeavingPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;

    const response = await fetch(`${apiBase()}/short-links/resolve/${encodeURIComponent(code)}`, {
        cache: 'no-store',
    });
    if (!response.ok) notFound();

    const body = await response.json();
    const data = body?.data ?? body;
    if (data?.kind !== 'external') notFound();

    const target: string = data.target_url;
    const host = new URL(target).host;

    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-amber-600">
                    <ShieldAlert className="h-5 w-5" />
                    <h1 className="text-sm font-semibold">You are leaving ERP71</h1>
                </div>
                <p className="mt-3 text-sm text-gray-600">This link goes to an external website:</p>
                <p className="mt-2 break-all rounded-md bg-gray-50 p-3 text-sm font-medium text-gray-900">
                    {host}
                </p>
                <p className="mt-3 text-xs text-gray-500 break-all">{target}</p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <a
                        href={target}
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-touch flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        <ExternalLink className="h-4 w-4" />
                        Continue
                    </a>
                    <Link
                        href="/"
                        className="inline-flex min-h-touch flex-1 items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                        Cancel
                    </Link>
                </div>
            </div>
        </main>
    );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/s && git commit -m "feat(short-links): add /s resolver route and off-domain interstitial"
```

---

## Task 7: Public quotation view

**Files:**
- Create: `apps/frontend/src/app/q/[token]/page.tsx`
- Create: `apps/frontend/src/app/q/[token]/PublicQuotationView.tsx`

**Interfaces:**
- Consumes: `GET /public/quotations/:token` from Task 5.
- Produces: the `/q/<token>` page that entity short links point at.

- [ ] **Step 1: Write the client view component**

Create `apps/frontend/src/app/q/[token]/PublicQuotationView.tsx`:

```tsx
'use client';

import { Printer } from 'lucide-react';
import { formatBDT } from '@/lib/format';

type Item = { product_name: string; quantity: number; unit_price: number; line_total: number };

export type PublicQuotation = {
    quote_number: string;
    version: number;
    status: string;
    created_at: string;
    valid_until: string | null;
    customer_name: string;
    seller_name: string;
    notes: string | null;
    items: Item[];
    total_amount: number;
};

const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * Print rather than a server-generated PDF: the internal quotation page already
 * produces its PDF through the browser print dialog, so this reuses the same
 * mechanism instead of adding a rendering dependency for one page.
 */
export default function PublicQuotationView({ quotation }: { quotation: PublicQuotation }) {
    return (
        <main className="min-h-screen bg-gray-50 p-3 md:p-4 print:bg-white print:p-0">
            <div className="mx-auto max-w-3xl space-y-4">
                <div className="flex items-center justify-between print:hidden">
                    <h1 className="text-sm font-semibold text-gray-900">Quotation {quotation.quote_number}</h1>
                    <button
                        onClick={() => window.print()}
                        className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                        <Printer className="h-4 w-4" />
                        Print / Save as PDF
                    </button>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-4 print:border-0 print:shadow-none">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
                        <div>
                            <p className="text-base font-semibold text-gray-900">{quotation.seller_name}</p>
                            <p className="text-xs text-gray-500">Quotation for {quotation.customer_name || 'Customer'}</p>
                        </div>
                        <div className="text-right text-xs text-gray-600">
                            <p className="font-semibold text-gray-900">
                                {quotation.quote_number}
                                {quotation.version > 1 ? ` (v${quotation.version})` : ''}
                            </p>
                            <p>Issued {formatDate(quotation.created_at)}</p>
                            <p>Valid until {formatDate(quotation.valid_until)}</p>
                        </div>
                    </div>

                    <table className="mt-3 w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 text-left text-xs uppercase text-gray-500">
                                <th className="py-2">Item</th>
                                <th className="py-2 text-right">Qty</th>
                                <th className="py-2 text-right">Unit price</th>
                                <th className="py-2 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {quotation.items.map((item, index) => (
                                <tr key={index} className="border-b border-gray-50">
                                    <td className="py-2 text-gray-900">{item.product_name}</td>
                                    <td className="py-2 text-right text-gray-700">{item.quantity}</td>
                                    <td className="py-2 text-right text-gray-700">{formatBDT(item.unit_price)}</td>
                                    <td className="py-2 text-right font-medium text-gray-900">
                                        {formatBDT(item.line_total)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <div className="mt-3 flex justify-end">
                        <div className="w-full max-w-xs space-y-1 text-sm">
                            <div className="flex justify-between border-t border-gray-200 pt-2 font-semibold text-gray-900">
                                <span>Total</span>
                                <span>{formatBDT(quotation.total_amount)}</span>
                            </div>
                        </div>
                    </div>

                    {quotation.notes && (
                        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-600">{quotation.notes}</p>
                    )}
                </div>
            </div>
        </main>
    );
}
```

If `formatBDT` is not exported from `@/lib/format`, locate it first with `grep -rn "export function formatBDT" apps/frontend/src` and import from the path you find. Do not write a literal `৳` or `$`.

- [ ] **Step 2: Write the page**

Create `apps/frontend/src/app/q/[token]/page.tsx`:

```tsx
import PublicQuotationView, { type PublicQuotation } from './PublicQuotationView';

export const dynamic = 'force-dynamic';

function apiBase(): string {
    const configured = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'http://localhost:4000/api/v1';
}

/**
 * A missing token and a revoked one render the same message on purpose. Telling
 * them apart would confirm to someone guessing tokens that a given quotation
 * exists.
 */
function Unavailable() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h1 className="text-sm font-semibold text-gray-900">This link is no longer available</h1>
                <p className="mt-2 text-xs text-gray-600">
                    Please ask the sender for an up-to-date link.
                </p>
            </div>
        </main>
    );
}

export default async function PublicQuotationPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;

    const response = await fetch(`${apiBase()}/public/quotations/${encodeURIComponent(token)}`, {
        cache: 'no-store',
    });
    if (!response.ok) return <Unavailable />;

    const body = await response.json();
    const quotation: PublicQuotation = body?.data ?? body;
    if (!quotation?.quote_number) return <Unavailable />;

    return <PublicQuotationView quotation={quotation} />;
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/q && git commit -m "feat(quotations): add public quotation view page"
```

---

## Task 8: Public storefront product page

The storefront currently has no per-product URL — `/store/[slug]/shop` is one filtered page. This adds the first one.

**Files:**
- Create: `apps/frontend/src/app/store/[slug]/p/[productId]/page.tsx`
- Modify: `apps/backend/src/storefront/storefront.controller.ts` and `storefront.service.ts` if no single-product public endpoint exists.

**Interfaces:**
- Consumes: the storefront's public product data.
- Produces: `/store/<slug>/p/<productId>`, the target for `STOREFRONT_PRODUCT` short links.

- [ ] **Step 1: Check whether a single-product public endpoint already exists**

```bash
cd /Users/bs01621/Projects/nayeem/erp71/.claude/worktrees/gifted-maxwell-19c487 && grep -nE "@Get\(|products" apps/backend/src/storefront/storefront.controller.ts
```

If a route returning one product by id already exists, use it and skip Step 2.

- [ ] **Step 2: Add the endpoint if it does not exist**

In `apps/backend/src/storefront/storefront.service.ts`, add a method that returns a single active product for a storefront slug, selecting only customer-facing fields:

```ts
    /**
     * Public single-product read. Selected field-by-field: `Product` also carries
     * reorder_level, safety_stock and lead_time_days, which are planning data and
     * none of a shopper's business.
     */
    async getPublicProduct(slug: string, productId: string) {
        const tenant = await this.db.tenant.findFirst({ where: { storefront_slug: slug } });
        if (!tenant) throw new NotFoundException('Storefront not found');

        const product = await this.db.product.findFirst({
            where: { id: productId, tenant_id: tenant.id, deleted_at: null },
            select: {
                id: true,
                name: true,
                sku: true,
                price: true,
                compare_at_price: true,
                description: true,
                image_url: true,
                images_gallery: true,
                unit_type: true,
            },
        });
        if (!product) throw new NotFoundException('Product not found');
        return product;
    }
```

Confirm the tenant's slug field name first — run `grep -n "storefront_slug\|slug" packages/database/prisma/schema.prisma | head` and use whatever the `Tenant` model actually calls it.

In `apps/backend/src/storefront/storefront.controller.ts`, add the public route, declared **after** any more specific `@Get` routes:

```ts
    /** Public: one product, for a shareable product page. */
    @Get(':slug/products/:productId')
    getPublicProduct(@Param('slug') slug: string, @Param('productId') productId: string) {
        return this.storefrontService.getPublicProduct(slug, productId);
    }
```

- [ ] **Step 3: Write the page**

Create `apps/frontend/src/app/store/[slug]/p/[productId]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatBDT } from '@/lib/format';

export const dynamic = 'force-dynamic';

function apiBase(): string {
    const configured = process.env.NEXT_PUBLIC_API_BASE || process.env.NEXT_PUBLIC_API_URL;
    if (configured) return configured.replace(/\/+$/, '');
    return 'http://localhost:4000/api/v1';
}

type PublicProduct = {
    id: string;
    name: string;
    sku: string | null;
    price: number;
    compare_at_price: number | null;
    description: string | null;
    image_url: string | null;
};

export default async function PublicProductPage({
    params,
}: {
    params: Promise<{ slug: string; productId: string }>;
}) {
    const { slug, productId } = await params;

    const response = await fetch(
        `${apiBase()}/storefront/${encodeURIComponent(slug)}/products/${encodeURIComponent(productId)}`,
        { cache: 'no-store' },
    );
    if (!response.ok) notFound();

    const body = await response.json();
    const product: PublicProduct = body?.data ?? body;
    if (!product?.id) notFound();

    return (
        <main className="min-h-screen bg-gray-50 p-3 md:p-4">
            <div className="mx-auto max-w-3xl space-y-4">
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {product.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={product.image_url}
                            alt={product.name}
                            className="max-h-96 w-full object-contain bg-gray-50"
                        />
                    )}
                    <div className="p-4">
                        <h1 className="text-base font-semibold text-gray-900">{product.name}</h1>
                        {product.sku && <p className="mt-1 text-xs text-gray-500">SKU: {product.sku}</p>}
                        <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-lg font-semibold text-gray-900">{formatBDT(product.price)}</span>
                            {product.compare_at_price ? (
                                <span className="text-sm text-gray-400 line-through">
                                    {formatBDT(product.compare_at_price)}
                                </span>
                            ) : null}
                        </div>
                        {product.description && (
                            <p className="mt-3 text-sm text-gray-600">{product.description}</p>
                        )}
                        <Link
                            href={`/store/${slug}/shop`}
                            className="mt-5 inline-flex min-h-touch items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                        >
                            Shop all products
                        </Link>
                    </div>
                </div>
            </div>
        </main>
    );
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd apps/backend && npx tsc --noEmit -p tsconfig.json && cd ../frontend && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/store apps/backend/src/storefront && git commit -m "feat(storefront): add shareable public product page"
```

---

## Task 9: Share modal and its call sites

**Files:**
- Create: `apps/frontend/src/components/share/ShareModal.tsx`
- Test: `apps/frontend/src/components/share/ShareModal.test.tsx`
- Modify: `apps/frontend/src/lib/api.ts`
- Modify: `apps/frontend/src/app/(app)/sales/quotes/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /sales-quotations/:id/share` from Task 5.
- Produces: `<ShareModal title shortPath onClose />` and `api.shareQuotation(id)`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/share/ShareModal.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import ShareModal from './ShareModal';

describe('ShareModal', () => {
    const original = window.location.origin;

    it('shows the absolute short URL', () => {
        render(<ShareModal title="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);
        expect(screen.getByDisplayValue(`${original}/s/aB3xK9m`)).toBeInTheDocument();
    });

    it('offers a WhatsApp share containing the link', () => {
        render(<ShareModal title="Quotation Q-1001" shortPath="/s/aB3xK9m" onClose={() => {}} />);
        const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
        expect(whatsapp).toHaveAttribute('href', expect.stringContaining('wa.me'));
        expect(whatsapp.getAttribute('href')).toContain(encodeURIComponent(`${original}/s/aB3xK9m`));
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/frontend && npx jest src/components/share/ShareModal.test.tsx
```

Expected: FAIL — cannot find `./ShareModal`.

- [ ] **Step 3: Write the modal**

Create `apps/frontend/src/components/share/ShareModal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Check, Copy, MessageCircle, X } from 'lucide-react';
import ModalShell from '@/components/ModalShell';

type Props = {
    title: string;
    /** Path form, e.g. "/s/aB3xK9m". Made absolute against the current origin. */
    shortPath: string;
    onClose: () => void;
};

/**
 * WhatsApp gets first-class placement because that is how these links are
 * actually sent in Bangladesh; copy is the fallback for everything else.
 */
export default function ShareModal({ title, shortPath, onClose }: Props) {
    const [copied, setCopied] = useState(false);
    const url = typeof window === 'undefined' ? shortPath : `${window.location.origin}${shortPath}`;

    const copy = async () => {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <div className="flex items-center justify-between border-b border-gray-100 p-4">
                <h2 className="text-sm font-semibold text-gray-900">Share {title}</h2>
                <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="space-y-3 p-4">
                <p className="text-xs text-gray-600">
                    Anyone with this link can view the quotation. No login required.
                </p>

                <div className="flex gap-2">
                    <input
                        readOnly
                        value={url}
                        className="min-h-touch flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900"
                    />
                    <button
                        onClick={copy}
                        className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>

                <a
                    href={`https://wa.me/?text=${encodeURIComponent(`${title}: ${url}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                    <MessageCircle className="h-4 w-4" />
                    Share on WhatsApp
                </a>
            </div>
        </ModalShell>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/frontend && npx jest src/components/share/ShareModal.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add the API client methods**

In `apps/frontend/src/lib/api.ts`, beside the other quotation methods, add:

```ts
    shareQuotation: (id: string) => fetchWithAuth(`/sales-quotations/${id}/share`, { method: 'POST' }),
    revokeQuotationShare: (id: string) => fetchWithAuth(`/sales-quotations/${id}/share`, { method: 'DELETE' }),
    getShortLinks: () => fetchWithAuth('/short-links'),
    createShortLink: (data: { target_url: string; label?: string }) =>
        fetchWithAuth('/short-links', { method: 'POST', body: JSON.stringify(data) }),
    revokeShortLink: (id: string) => fetchWithAuth(`/short-links/${id}`, { method: 'DELETE' }),
    getAdminShortLinks: () => fetchWithAuth('/admin/short-links'),
    createAdminShortLink: (data: { target_url: string; label?: string }) =>
        fetchWithAuth('/admin/short-links', { method: 'POST', body: JSON.stringify(data) }),
    revokeAdminShortLink: (id: string) => fetchWithAuth(`/admin/short-links/${id}`, { method: 'DELETE' }),
```

Match the surrounding `fetchWithAuth` call style — check whether existing POST helpers set `headers: { 'Content-Type': 'application/json' }` explicitly and follow suit.

- [ ] **Step 6: Wire the Share button into the quotation detail page**

In `apps/frontend/src/app/(app)/sales/quotes/[id]/page.tsx`, add `Share2` to the `lucide-react` import, add state and a handler, and place the button beside the existing Print button around line 274:

```tsx
const [sharePath, setSharePath] = useState<string | null>(null);

const handleShare = async () => {
    const result = await api.shareQuotation(id);
    setSharePath((result?.data ?? result).path);
};
```

```tsx
<button
    onClick={handleShare}
    className="bg-white border border-gray-200 text-gray-900 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center hover:bg-gray-50 shadow-sm transition-all"
>
    <Share2 className="w-4 h-4 mr-2 text-gray-400" />
    Share
</button>
```

And render the modal near the end of the component:

```tsx
{sharePath && (
    <ShareModal
        title={`Quotation ${quote.quote_number}`}
        shortPath={sharePath}
        onClose={() => setSharePath(null)}
    />
)}
```

Use the page's existing error-surfacing pattern for a failed share — the global Toaster store, never `alert()`. Check how the surrounding handlers report failures and match them.

- [ ] **Step 7: Run the quotation page tests**

```bash
cd apps/frontend && npx jest src/components/share src/app/\(app\)/sales/quotes
```

Expected: PASS. If an existing quote page test breaks because of the new button, update the test rather than removing the button.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/components/share apps/frontend/src/lib/api.ts "apps/frontend/src/app/(app)/sales/quotes" && git commit -m "feat(sales): add share modal to quotation detail page"
```

---

## Task 10: Navigation, routes and translations

**Files:**
- Modify: `packages/shared-types/navigation.ts`
- Modify: `apps/backend/src/navigation/nav-layout-merge.spec.ts`
- Modify: `apps/frontend/src/lib/routes.ts`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `routes.admin.urlShortener`, `routes.settings.urlShortener`, and the nav nodes `admin.url-shortener` and `account-settings.url-shortener`. Tasks 11 and 12 use these.

- [ ] **Step 1: Write the failing nav test**

Add to `apps/backend/src/navigation/nav-layout-merge.spec.ts`:

```ts
    /**
     * admin.referrals was in NAV_REGISTRY but in no layout at all, which left the
     * platform referral screens registered, rendered, and reachable only by typing
     * the URL. These two assertions exist so the shortener does not repeat it.
     */
    it('ships admin.url-shortener in the platform admin layout under the admin module', () => {
        const defaults = getDefaultNavLayout(NavScope.PLATFORM_ADMIN);
        const node = defaults.find((n) => n.id === 'admin.url-shortener');
        expect(node).toEqual(expect.objectContaining({ parentId: 'admin', visible: true }));
    });

    it('does not collide sort order with its siblings under admin', () => {
        const defaults = getDefaultNavLayout(NavScope.PLATFORM_ADMIN);
        const siblings = defaults.filter((n) => n.parentId === 'admin').map((n) => n.sortOrder);
        expect(new Set(siblings).size).toBe(siblings.length);
    });
```

Match the import list and `layoutNode`/`getDefaultNavLayout` usage already at the top of that spec file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/backend && npx jest src/navigation/nav-layout-merge.spec.ts
```

Expected: FAIL — the node is undefined.

- [ ] **Step 3: Register the nav nodes**

In `packages/shared-types/navigation.ts`, add to `NAV_REGISTRY` after `admin.referrals` (line 231):

```ts
  'admin.url-shortener': { id: 'admin.url-shortener', kind: 'link', icon: 'Link2', labelKey: 'sidebar.items.urlShortener', href: '/admin/url-shortener' },
```

and after `account-settings.discount-codes` (line 217):

```ts
  'account-settings.url-shortener': { id: 'account-settings.url-shortener', kind: 'link', icon: 'Link2', labelKey: 'sidebar.items.urlShortener', href: '/settings/url-shortener' },
```

In `DEFAULT_PLATFORM_ADMIN_NAV_LAYOUT` (line 406), insert after `admin.referrals` and renumber the entries below it so no two siblings share a sort order:

```ts
  layoutNode('admin.url-shortener', 'admin', 7),
  layoutNode('admin.platform-settings', 'admin', 8),
```

`DEFAULT_TENANT_NAV_LAYOUT` carries its own `admin` block with different sort numbers (`admin.feedback` sits at 3 there, not 7). Append `layoutNode('admin.url-shortener', 'admin', N)` to that block using the next free integer in *that* block — do not copy the platform layout's number, or two siblings collide and the sort-order test fails.

The tenant Settings page is reached through the `/settings` hub grid rather than the sidebar — the tenant default layout ships only four `account-settings` children — so `account-settings.url-shortener` needs a registry entry but no tenant layout node. Task 12 adds the hub card.

Confirm `Link2` is a valid icon in the frontend's nav icon map before using it: `grep -rn "Link2\|iconMap\|NAV_ICONS" apps/frontend/src/lib/nav-resolver.ts`. If the map is explicit, add `Link2` to it.

- [ ] **Step 4: Rebuild shared-types and run the test**

```bash
cd packages/shared-types && npm run build && cd ../../apps/backend && npx jest src/navigation/nav-layout-merge.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Add the routes**

In `apps/frontend/src/lib/routes.ts`, add `urlShortener: '/admin/url-shortener',` to the `admin` object (line 208) and `urlShortener: '/settings/url-shortener',` to the `settings` object (line 188).

- [ ] **Step 6: Add translations to all three locales**

In `apps/frontend/src/lib/localization/messages/en/core.ts`, add to the `sidebar.items` object (near line 361):

```ts
            urlShortener: 'URL Shortener',
```

and to the settings hub card labels (near line 544), following the shape of the neighbouring entries:

```ts
                urlShortener: 'URL Shortener',
```

Add the same keys at the same paths in `bn/core.ts` and `ms/core.ts` with translated values (Bengali: `'ইউআরএল শর্টনার'`; Malay: `'Pemendek URL'`). Missing either one fails `catalog.test.ts`.

- [ ] **Step 7: Verify the catalog test passes**

```bash
cd apps/frontend && npx jest src/lib/localization/messages/catalog.test.ts
```

Expected: PASS for en, bn and ms.

- [ ] **Step 8: Commit**

```bash
git add packages/shared-types apps/backend/src/navigation apps/frontend/src/lib && git commit -m "feat(nav): register URL shortener in admin nav and settings routes"
```

---

## Task 11: Shared short-link manager and the platform admin page

Both shortener pages render the same form and table over different endpoints, so the table lives in one component from the start. The component owns all presentation; each page supplies copy and three callbacks.

**Files:**
- Create: `apps/frontend/src/components/short-links/ShortLinkManager.tsx`
- Test: `apps/frontend/src/components/short-links/ShortLinkManager.test.tsx`
- Create: `apps/frontend/src/app/(app)/admin/url-shortener/page.tsx`

**Interfaces:**
- Consumes: `api.getAdminShortLinks`, `api.createAdminShortLink`, `api.revokeAdminShortLink` from Task 9; `routes.admin.urlShortener` from Task 10.
- Produces:
  - `type ShortLinkRow = { id: string; code: string; target_url: string; label: string | null; click_count: number; created_at: string; revoked_at: string | null }`
  - `<ShortLinkManager description? placeholder? fetchLinks createLink revokeLink />` where
    `fetchLinks: () => Promise<unknown>`,
    `createLink: (data: { target_url: string; label?: string }) => Promise<unknown>`,
    `revokeLink: (id: string) => Promise<unknown>`.
  - Task 12 renders this same component.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/components/short-links/ShortLinkManager.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShortLinkManager from './ShortLinkManager';

const link = (overrides = {}) => ({
    id: 'link-1',
    code: 'aB3xK9m',
    target_url: 'https://example.com/',
    label: 'Campaign',
    click_count: 4,
    created_at: '2026-08-04T00:00:00.000Z',
    revoked_at: null,
    ...overrides,
});

describe('ShortLinkManager', () => {
    it('lists links returned by fetchLinks', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([link()])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText('/s/aB3xK9m')).toBeInTheDocument();
        expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('unwraps a { data } envelope', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue({ data: [link()] })}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText('/s/aB3xK9m')).toBeInTheDocument();
    });

    it('shows an empty state when there are no links', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText(/no short links yet/i)).toBeInTheDocument();
    });

    it('creates a link and reloads the list', async () => {
        const createLink = jest.fn().mockResolvedValue({});
        const fetchLinks = jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([link()]);

        render(<ShortLinkManager fetchLinks={fetchLinks} createLink={createLink} revokeLink={jest.fn()} />);
        await screen.findByText(/no short links yet/i);

        await userEvent.type(screen.getByPlaceholderText(/https/i), 'https://example.com');
        await userEvent.click(screen.getByRole('button', { name: /shorten/i }));

        await waitFor(() => expect(createLink).toHaveBeenCalledWith({ target_url: 'https://example.com' }));
        expect(await screen.findByText('/s/aB3xK9m')).toBeInTheDocument();
    });

    it('shows the rejection reason inline when the target is refused', async () => {
        // isSafeTarget names the rule it rejected on, and that reason is the only
        // thing telling the user why a URL they consider fine was refused.
        const createLink = jest.fn().mockRejectedValue(new Error('Only http and https links are allowed.'));

        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([])}
                createLink={createLink}
                revokeLink={jest.fn()}
            />,
        );
        await screen.findByText(/no short links yet/i);

        await userEvent.type(screen.getByPlaceholderText(/https/i), 'javascript:alert(1)');
        await userEvent.click(screen.getByRole('button', { name: /shorten/i }));

        expect(await screen.findByText('Only http and https links are allowed.')).toBeInTheDocument();
    });

    it('revokes a link and reloads', async () => {
        const revokeLink = jest.fn().mockResolvedValue({});
        const fetchLinks = jest
            .fn()
            .mockResolvedValueOnce([link()])
            .mockResolvedValueOnce([link({ revoked_at: '2026-08-05T00:00:00.000Z' })]);

        render(<ShortLinkManager fetchLinks={fetchLinks} createLink={jest.fn()} revokeLink={revokeLink} />);
        await screen.findByText('/s/aB3xK9m');

        await userEvent.click(screen.getByRole('button', { name: /revoke/i }));

        await waitFor(() => expect(revokeLink).toHaveBeenCalledWith('link-1'));
        expect(await screen.findByText(/revoked/i)).toBeInTheDocument();
    });

    it('offers no revoke control on an already-revoked link', async () => {
        render(
            <ShortLinkManager
                fetchLinks={jest.fn().mockResolvedValue([link({ revoked_at: '2026-08-05T00:00:00.000Z' })])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );
        await screen.findByText('/s/aB3xK9m');

        expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    });

    it('renders the description when one is given', async () => {
        render(
            <ShortLinkManager
                description="Shared across your business."
                fetchLinks={jest.fn().mockResolvedValue([])}
                createLink={jest.fn()}
                revokeLink={jest.fn()}
            />,
        );

        expect(await screen.findByText('Shared across your business.')).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/frontend && npx jest src/components/short-links/ShortLinkManager.test.tsx
```

Expected: FAIL — cannot find `./ShortLinkManager`.

- [ ] **Step 3: Write the component**

Create `apps/frontend/src/components/short-links/ShortLinkManager.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

export type ShortLinkRow = {
    id: string;
    code: string;
    target_url: string;
    label: string | null;
    click_count: number;
    created_at: string;
    revoked_at: string | null;
};

type Props = {
    /** Optional line above the form, e.g. who else can see these links. */
    description?: string;
    placeholder?: string;
    fetchLinks: () => Promise<unknown>;
    createLink: (data: { target_url: string; label?: string }) => Promise<unknown>;
    revokeLink: (id: string) => Promise<unknown>;
};

/**
 * The form and table behind both shortener pages. The platform-admin page and the
 * tenant Settings page differ only in which endpoints they call and what the copy
 * says, so those are props and everything else lives here once.
 */
export default function ShortLinkManager({
    description,
    placeholder = 'https://example.com/page',
    fetchLinks,
    createLink,
    revokeLink,
}: Props) {
    const [links, setLinks] = useState<ShortLinkRow[]>([]);
    const [target, setTarget] = useState('');
    const [label, setLabel] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        const result: any = await fetchLinks();
        setLinks((result?.data ?? result ?? []) as ShortLinkRow[]);
    }, [fetchLinks]);

    useEffect(() => {
        void load();
    }, [load]);

    const create = async () => {
        setError(null);
        setSaving(true);
        try {
            const trimmed = target.trim();
            await createLink(label.trim() ? { target_url: trimmed, label: label.trim() } : { target_url: trimmed });
            setTarget('');
            setLabel('');
            await load();
        } catch (err: any) {
            // The backend rejection names the rule that refused the URL, and that
            // reason is the only thing explaining why a link the user considers
            // fine was turned down. Inline on the field, never a toast.
            setError(err?.message ?? 'Could not create the link.');
        } finally {
            setSaving(false);
        }
    };

    const revoke = async (id: string) => {
        await revokeLink(id);
        await load();
    };

    return (
        <div className="space-y-4">
            {description && <p className="text-xs text-gray-600">{description}</p>}

            <div className="rounded-lg border border-gray-200 bg-white p-3 md:p-4">
                <div className="flex flex-col gap-2 md:flex-row">
                    <div className="flex-1">
                        <input
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                            placeholder={placeholder}
                            className="min-h-touch w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                    </div>
                    <input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Label (optional)"
                        className="min-h-touch rounded-lg border border-gray-200 px-3 py-2 text-sm md:w-56"
                    />
                    <button
                        onClick={create}
                        disabled={saving || !target.trim()}
                        className="min-h-touch rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        Shorten
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                        <tr>
                            <th className="p-3">Short link</th>
                            <th className="p-3">Target</th>
                            <th className="p-3 text-right">Clicks</th>
                            <th className="p-3" />
                        </tr>
                    </thead>
                    <tbody>
                        {links.map((link) => (
                            <tr key={link.id} className="border-t border-gray-100">
                                <td className="p-3 font-medium text-gray-900">
                                    /s/{link.code}
                                    {link.revoked_at && <span className="ml-2 text-xs text-red-600">revoked</span>}
                                </td>
                                <td className="p-3 max-w-md truncate text-gray-600">{link.target_url}</td>
                                <td className="p-3 text-right text-gray-700">{link.click_count}</td>
                                <td className="p-3 text-right">
                                    {!link.revoked_at && (
                                        <button
                                            onClick={() => revoke(link.id)}
                                            aria-label="Revoke"
                                            className="text-gray-400 hover:text-red-600"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {links.length === 0 && (
                            <tr>
                                <td colSpan={4} className="p-6 text-center text-sm text-gray-500">
                                    No short links yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/frontend && npx jest src/components/short-links/ShortLinkManager.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write the admin page**

Create `apps/frontend/src/app/(app)/admin/url-shortener/page.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import { Link2 } from 'lucide-react';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import ShortLinkManager from '@/components/short-links/ShortLinkManager';
import { api } from '@/lib/api';

export default function AdminUrlShortenerPage() {
    const fetchLinks = useCallback(() => api.getAdminShortLinks(), []);
    const createLink = useCallback(
        (data: { target_url: string; label?: string }) => api.createAdminShortLink(data),
        [],
    );
    const revokeLink = useCallback((id: string) => api.revokeAdminShortLink(id), []);

    return (
        <PageShell>
            <PageHeader title="URL Shortener" icon={Link2} />
            <ShortLinkManager
                description="Links created here belong to the platform, not to any tenant. This list spans every tenant."
                placeholder="https://example.com/page or /settings/branding"
                fetchLinks={fetchLinks}
                createLink={createLink}
                revokeLink={revokeLink}
            />
        </PageShell>
    );
}
```

The `useCallback` wrappers matter: `ShortLinkManager`'s load effect depends on `fetchLinks`, so an inline arrow would give it a new identity every render and re-fetch in a loop.

Check the real `PageHeader` and `PageShell` prop signatures before writing — open `apps/frontend/src/components/ui/compact/PageHeader.tsx` and match its actual props (it may take `breadcrumbs`, `actions`, or a `subtitle`). Follow the neighbouring `/admin/referrals` page for the exact shape.

- [ ] **Step 6: Verify compilation and tests**

```bash
cd apps/frontend && npx tsc --noEmit && npx jest src/components/short-links
```

Expected: no new type errors; tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/short-links "apps/frontend/src/app/(app)/admin/url-shortener" && git commit -m "feat(admin): add shared short-link manager and platform shortener page"
```

---

## Task 12: Tenant settings shortener page and hub card

**Files:**
- Create: `apps/frontend/src/app/(app)/settings/url-shortener/page.tsx`
- Modify: `apps/frontend/src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `ShortLinkManager` from Task 11; `api.getShortLinks`, `api.createShortLink`, `api.revokeShortLink` from Task 9; `routes.settings.urlShortener` from Task 10.

- [ ] **Step 1: Write the tenant page**

Create `apps/frontend/src/app/(app)/settings/url-shortener/page.tsx`:

```tsx
'use client';

import { useCallback } from 'react';
import { Link2 } from 'lucide-react';
import PageShell from '@/components/ui/compact/PageShell';
import PageHeader from '@/components/ui/compact/PageHeader';
import ShortLinkManager from '@/components/short-links/ShortLinkManager';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function SettingsUrlShortenerPage() {
    const { t } = useI18n();
    const fetchLinks = useCallback(() => api.getShortLinks(), []);
    const createLink = useCallback(
        (data: { target_url: string; label?: string }) => api.createShortLink(data),
        [],
    );
    const revokeLink = useCallback((id: string) => api.revokeShortLink(id), []);

    return (
        <PageShell>
            <PageHeader title={t.sidebar.items.urlShortener} icon={Link2} />
            <ShortLinkManager
                description="Short links are shared across your business — anyone who can manage short links sees every link created here."
                fetchLinks={fetchLinks}
                createLink={createLink}
                revokeLink={revokeLink}
            />
        </PageShell>
    );
}
```

Match `PageShell`/`PageHeader` props to a neighbouring settings page such as `/settings/discount-codes`.

- [ ] **Step 2: Add the settings hub card**

In `apps/frontend/src/app/(app)/settings/page.tsx`, add `Link2` to the `lucide-react` import and add a card to the `advanced` section of `SECTIONS`:

```ts
    { href: routes.settings.urlShortener, key: 'urlShortener', icon: Link2, accent: 'bg-primary-light text-blue-700 border-primary-border' },
```

The `key` must match the settings-hub label key added in Task 10 Step 6, or the card renders with a missing string.

- [ ] **Step 3: Verify compilation and the hub test**

```bash
cd apps/frontend && npx tsc --noEmit && npx jest src/app/\(app\)/settings src/lib/localization
```

Expected: no new type errors; tests pass.

- [ ] **Step 4: Run the full test suites**

```bash
cd apps/backend && npx jest && cd ../frontend && npx jest
```

Expected: no new failures. Record any pre-existing failures before starting so you can distinguish them.

- [ ] **Step 5: Update TODO.md**

Move the URL shortener roadmap entry to the `## COMPLETED` section with today's date and a short note on what shipped, per `CLAUDE.md`.

- [ ] **Step 6: Commit**

```bash
git add "apps/frontend/src/app/(app)/settings" TODO.md && git commit -m "feat(settings): add tenant URL shortener page and hub card"
```

---

## Manual verification

After Task 12, verify the whole path by hand — the unit tests cover the pieces, not the journey:

1. Start backend and frontend. Open a quotation, click Share, copy the link.
2. Open the link in a private window with no session. The quotation must render with no login prompt.
3. Confirm the page shows no cost price, no margin, and no internal ids (check the network response, not just the rendering).
4. Print / Save as PDF produces a clean page with the on-screen controls hidden.
5. Revoke the share, reload the link, confirm the unavailable message.
6. In `/admin/url-shortener`, shorten `https://example.com`, open `/s/<code>`, confirm the interstitial names `example.com`.
7. Try to shorten `javascript:alert(1)` and `http://169.254.169.254/latest/meta-data`; both must be rejected inline with a reason.
8. Confirm URL Shortener appears in the platform admin sidebar and on the tenant `/settings` hub.
9. At 360px width, confirm no horizontal body scroll on the public quotation page.
