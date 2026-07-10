# Simplified Signup + Store Rename + Configurable Default Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce signup to three required fields (org name, email, password), auto-create the first store as "Main Store", make mobile optional and non-unique, keep an admin-configurable default plan, and add a store-rename capability.

**Architecture:** NestJS backend (`apps/backend`) + Next.js frontend (`apps/frontend`) + Prisma (`packages/database`) + shared permission matrix (`packages/shared-types`). Backend changes are unit-tested with plain Jest specs that instantiate services with mocked `db` objects (no Nest TestingModule). Frontend uses React Testing Library specs alongside pages.

**Tech Stack:** NestJS, Next.js 15, Prisma/PostgreSQL, Jest, React Testing Library, Tailwind.

## Global Constraints

- Multi-tenancy: every business query is scoped to `tenantId` (via `TenantInterceptor` / `@Tenant()` context). Copy verbatim from CLAUDE.md.
- New permissions must be added to `packages/shared-types/index.ts` first.
- DB changes require a Prisma migration (hand-authored SQL folder under `packages/database/prisma/migrations/`).
- No real personal names in placeholder/sample copy. Use generic-but-meaningful text (e.g. "Dhaka Retail Co.").
- Password minimum stays 8 characters.
- Self-serve plans only: `BASIC`, `ACCOUNTING`, `STANDARD` (never `FREE`/`PREMIUM` for signup).
- Backend tests run with `npm test` in `apps/backend`; frontend tests with `npm test` in `apps/frontend`.

---

## File Structure

**Backend**
- `apps/backend/src/platform-settings/platform-settings.service.ts` — add `default_signup_plan` setting (modify).
- `apps/backend/src/auth/auth.dto.ts` — make `storeName` + `mobile` optional (modify).
- `apps/backend/src/auth/auth.service.ts` — signup logic, `getSignupDefaults()`, plan-default resolution, drop mobile uniqueness (modify).
- `apps/backend/src/auth/auth.controller.ts` — add `GET /auth/signup-defaults` (modify).
- `apps/backend/src/auth/auth.service.spec.ts` — new/extended unit tests (create or modify).
- `apps/backend/src/stores/stores.service.ts` — rename logic (create).
- `apps/backend/src/stores/stores.controller.ts` — `PATCH /stores/:id` (create).
- `apps/backend/src/stores/stores.module.ts` — module (create).
- `apps/backend/src/stores/update-store.dto.ts` — `UpdateStoreDto` (create).
- `apps/backend/src/stores/stores.service.spec.ts` — unit tests (create).
- `apps/backend/src/app.module.ts` — register `StoresModule` (modify).

**Shared types**
- `packages/shared-types/index.ts` — add `MANAGE_STORES` permission (modify).

**Database**
- `packages/database/prisma/schema.prisma` — drop `@unique` on `User.mobile` (modify).
- `packages/database/prisma/migrations/20260710120000_drop_user_mobile_unique/migration.sql` — drop index (create).

**Frontend**
- `apps/frontend/src/lib/api.ts` — add `getSignupDefaults`, `updateStore` (modify).
- `apps/frontend/src/app/signup/page.tsx` — remove name/store fields, optional mobile, default plan from API (modify).
- `apps/frontend/src/app/signup/page.test.tsx` — update tests (modify).
- `apps/frontend/src/app/(app)/settings/stores/page.tsx` — store rename UI (create).
- `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts` — signup copy + store-settings strings (modify).

---

## Task 1: Configurable default signup plan (backend)

**Files:**
- Modify: `apps/backend/src/platform-settings/platform-settings.service.ts` (SETTINGS_SCHEMA `general` group, ~line 50-59)
- Modify: `apps/backend/src/auth/auth.service.ts` (add `getSignupDefaults()` near `getPlans()`, ~line 245-268)
- Modify: `apps/backend/src/auth/auth.controller.ts` (add route after `getPlans`, ~line 44)
- Test: `apps/backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Produces: `AuthService.getSignupDefaults(): Promise<{ defaultPlanCode: 'BASIC' | 'ACCOUNTING' | 'STANDARD' }>`; HTTP `GET /auth/signup-defaults` (unauthenticated).
- Consumes: `PlatformSettingsService.getRawValue('general', 'default_signup_plan')`, `isSelfServeSubscriptionPlan` from `@erp71/shared-types`.

- [ ] **Step 1: Add the platform setting key**

In `platform-settings.service.ts`, add to the `general` group (after `manufacturing_enabled`):

```ts
    general: {
        platform_name:    { isSecret: false, default: 'ERP71' },
        support_email:    { isSecret: false, default: 'support@erp71.com' },
        maintenance_mode: { isSecret: false, default: 'false' },
        feedback_enabled: { isSecret: false, default: 'false' },
        support_enabled:  { isSecret: false, default: 'false' },
        help_enabled:     { isSecret: false, default: 'false' },
        voice_enabled:    { isSecret: false, default: 'false' },
        manufacturing_enabled: { isSecret: false, default: 'true' },
        default_signup_plan:   { isSecret: false, default: 'STANDARD' },
    },
```

- [ ] **Step 2: Write the failing test for `getSignupDefaults`**

Add to `apps/backend/src/auth/auth.service.spec.ts` (create the file if absent — see the constructor arg pattern in Step 4). Minimal harness:

```ts
import { AuthService } from './auth.service';

describe('AuthService.getSignupDefaults', () => {
    const platformSettings = { getRawValue: jest.fn() };
    const service = new AuthService(
        {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, platformSettings as any, {} as any, {} as any,
    );

    beforeEach(() => jest.clearAllMocks());

    it('returns the configured self-serve plan', async () => {
        platformSettings.getRawValue.mockResolvedValue('STANDARD');
        await expect(service.getSignupDefaults()).resolves.toEqual({ defaultPlanCode: 'STANDARD' });
    });

    it('falls back to STANDARD when the setting is not a self-serve plan', async () => {
        platformSettings.getRawValue.mockResolvedValue('FREE');
        await expect(service.getSignupDefaults()).resolves.toEqual({ defaultPlanCode: 'STANDARD' });
    });
});
```

> Note: the constructor has 9 params in this order: `db, jwtService, email, audit, totp, assets, platformSettings, referrals, planEntitlements` (see `auth.service.ts:40-50`). Pass `{}` casts for the ones this test does not exercise.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx jest src/auth/auth.service.spec.ts -t getSignupDefaults`
Expected: FAIL with "service.getSignupDefaults is not a function".

- [ ] **Step 4: Implement `getSignupDefaults`**

In `auth.service.ts`, add after `getPlans()` (after line 268):

```ts
    async getSignupDefaults(): Promise<{ defaultPlanCode: 'BASIC' | 'ACCOUNTING' | 'STANDARD' }> {
        const configured = await this.platformSettings.getRawValue('general', 'default_signup_plan');
        const code = configured && isSelfServeSubscriptionPlan(configured as any) ? configured : 'STANDARD';
        return { defaultPlanCode: code as 'BASIC' | 'ACCOUNTING' | 'STANDARD' };
    }
```

`isSelfServeSubscriptionPlan` is already imported in this file (line 20).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx jest src/auth/auth.service.spec.ts -t getSignupDefaults`
Expected: PASS (both cases).

- [ ] **Step 6: Expose the public endpoint**

In `auth.controller.ts`, add after the `getPlans` handler (after line 44):

```ts
    @Get('signup-defaults')
    async getSignupDefaults() {
        return this.authService.getSignupDefaults();
    }
```

- [ ] **Step 7: Build to confirm wiring**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/platform-settings/platform-settings.service.ts apps/backend/src/auth/auth.service.ts apps/backend/src/auth/auth.controller.ts apps/backend/src/auth/auth.service.spec.ts
git commit -m "feat(auth): admin-configurable default signup plan via /auth/signup-defaults"
```

---

## Task 2: Slim SignupDto + signup() logic

**Files:**
- Modify: `apps/backend/src/auth/auth.dto.ts:20-21,35-36`
- Modify: `apps/backend/src/auth/auth.service.ts:52-96` (signup)
- Test: `apps/backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `AuthService.getSignupDefaults()` (Task 1); `normalizeMobileToE164`, `DEFAULT_MOBILE_COUNTRY_CODE` (already imported).
- Produces: `signup(dto)` that succeeds with only `email`, `password`, `tenantName`; auto-defaults store name to `"Main Store"`, `User.name` to the email local-part, and plan to the configured default.

- [ ] **Step 1: Make `storeName` and `mobile` optional in the DTO**

In `auth.dto.ts`, change the `SignupDto` fields:

```ts
    @IsOptional()
    @IsString()
    storeName?: string;
```

and

```ts
    @IsOptional()
    @IsString()
    mobile?: string;
```

(`name` is already `@IsOptional`.) Leave `tenantName` required.

- [ ] **Step 2: Write failing tests for the new signup behavior**

Add a `describe('AuthService.signup')` block to `auth.service.spec.ts`. To keep the test focused on signup's own logic (name default, mobile handling, store-name default, plan default), **spy on the private `provisionTenant`** so the full provisioning chain (roles, subscription, accounting, referrals) does not run. Capture the created user via the transaction mock:

```ts
describe('AuthService.signup', () => {
    let createdUser: any;

    const tx = {
        user: { create: jest.fn(async ({ data }: any) => { createdUser = { id: 'u1', ...data }; return createdUser; }) },
    };
    const db = {
        user: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null) },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const email = { sendWelcome: jest.fn(async () => {}) };
    const audit = { log: jest.fn(async () => {}) };
    const platformSettings = { getRawValue: jest.fn(async () => 'STANDARD') };

    const makeService = () => {
        const svc = new AuthService(
            db as any, {} as any, email as any, audit as any, {} as any,
            {} as any, platformSettings as any, {} as any, {} as any,
        );
        // Isolate signup(): stub provisioning and post-signup side effects.
        jest.spyOn(svc as any, 'provisionTenant').mockResolvedValue({ tenant: { id: 't1' } });
        jest.spyOn(svc as any, 'generateAuthResponse').mockResolvedValue({ access_token: 'x', tenants: [] });
        jest.spyOn(svc as any, 'sendVerificationEmail').mockResolvedValue(undefined);
        return svc;
    };

    beforeEach(() => { jest.clearAllMocks(); createdUser = undefined; });

    it('creates account with only org name + email + password', async () => {
        const svc = makeService();
        await svc.signup({ email: 'owner@shop.com', password: 'password1', tenantName: 'Dhaka Retail Co.' } as any);
        expect(createdUser.name).toBe('owner');            // email local-part
        expect(createdUser.mobile).toBeNull();             // no mobile provided
        expect(db.user.findFirst).not.toHaveBeenCalled();  // no mobile uniqueness lookup
        // store-name default is passed into provisioning
        expect((svc as any).provisionTenant).toHaveBeenCalledWith(
            expect.anything(), 'u1',
            expect.objectContaining({ storeName: 'Main Store', planCode: 'STANDARD' }),
        );
    });

    it('accepts a duplicate mobile (no uniqueness check)', async () => {
        const svc = makeService();
        await svc.signup({ email: 'a@b.com', password: 'password1', tenantName: 'Org', mobile: '01712345678' } as any);
        expect(createdUser.mobile).toBe('+8801712345678');
        expect(db.user.findFirst).not.toHaveBeenCalled();
    });
});
```

> `jest.spyOn(svc as any, 'provisionTenant')` works on the private method at runtime. The constructor arg order is `db, jwtService, email, audit, totp, assets, platformSettings, referrals, planEntitlements` (see `auth.service.ts:40-50`).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/backend && npx jest src/auth/auth.service.spec.ts -t "AuthService.signup"`
Expected: FAIL (store name is currently required to provision; name is not defaulted; mobile uniqueness lookup fires).

- [ ] **Step 4: Rewrite the signup mobile + name + provisioning logic**

In `auth.service.ts`, replace the body of `signup()` from the mobile block through the transaction (current lines 61-96) with:

```ts
        let normalizedMobile: string | null = null;
        let mobileCountryCode: string | null = null;
        if (dto.mobile?.trim()) {
            mobileCountryCode = dto.mobile_country_code?.trim() || DEFAULT_MOBILE_COUNTRY_CODE;
            normalizedMobile = normalizeMobileToE164(mobileCountryCode, dto.mobile);
            if (!normalizedMobile) {
                throw new BadRequestException('Please enter a valid mobile number including country code.');
            }
            // Duplicate mobiles are allowed (one person may own multiple businesses) — no uniqueness check.
        }

        const passwordHash = await bcrypt.hash(dto.password, 10);
        const displayName = dto.name?.trim() || dto.email.split('@')[0];
        const defaultPlan = dto.planCode ?? (await this.getSignupDefaults()).defaultPlanCode;

        const user = await this.db.$transaction(async (tx) => {
            const createdUser = await tx.user.create({
                data: {
                    email: dto.email,
                    passwordHash,
                    name: displayName,
                    mobile: normalizedMobile,
                    mobile_country_code: mobileCountryCode ?? DEFAULT_MOBILE_COUNTRY_CODE,
                },
            });

            if (dto.tenantName?.trim()) {
                await this.provisionTenant(tx, createdUser.id, {
                    tenantName: dto.tenantName,
                    storeName: dto.storeName?.trim() || 'Main Store',
                    address: dto.address,
                    planCode: defaultPlan,
                    referralCode: dto.referralCode,
                });
            }

            return createdUser;
        });
```

Leave everything after the transaction (welcome email, verification, audit, `generateAuthResponse`) unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/backend && npx jest src/auth/auth.service.spec.ts`
Expected: PASS (Task 1 + Task 2 blocks).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/auth/auth.dto.ts apps/backend/src/auth/auth.service.ts apps/backend/src/auth/auth.service.spec.ts
git commit -m "feat(auth): minimal signup — optional mobile/store/name, defaults applied"
```

---

## Task 3: Allow duplicate mobile numbers (schema + migration)

**Files:**
- Modify: `packages/database/prisma/schema.prisma:202`
- Create: `packages/database/prisma/migrations/20260710120000_drop_user_mobile_unique/migration.sql`

**Interfaces:**
- Produces: `User.mobile` is `String?` (nullable, non-unique). No code depends on a unique constraint after Task 2.

- [ ] **Step 1: Drop `@unique` from the schema**

In `schema.prisma`, line 202, change:

```prisma
  mobile              String?
```

(remove `@unique`).

- [ ] **Step 2: Write the migration SQL**

Create `packages/database/prisma/migrations/20260710120000_drop_user_mobile_unique/migration.sql`:

```sql
-- Allow duplicate mobile numbers: one person may own multiple businesses (separate accounts).
DROP INDEX "User_mobile_key";
```

(The index `User_mobile_key` was created in `20260704120000_add_user_mobile/migration.sql`.)

- [ ] **Step 3: Regenerate the Prisma client and validate**

Run: `cd packages/database && npx prisma generate && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid" and client regenerated with no errors.

- [ ] **Step 4: Apply the migration locally**

Run: `cd packages/database && npx prisma migrate deploy`
Expected: applies `20260710120000_drop_user_mobile_unique`; output "1 migration applied" (or "No pending migrations" if the DB is unavailable — in that case note it and confirm the SQL is well-formed).

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260710120000_drop_user_mobile_unique/migration.sql
git commit -m "feat(db): allow duplicate User.mobile (drop unique index)"
```

---

## Task 4: Store rename module (backend)

**Files:**
- Modify: `packages/shared-types/index.ts:47` (add `MANAGE_STORES` under User Management)
- Create: `apps/backend/src/stores/update-store.dto.ts`
- Create: `apps/backend/src/stores/stores.service.ts`
- Create: `apps/backend/src/stores/stores.controller.ts`
- Create: `apps/backend/src/stores/stores.module.ts`
- Create: `apps/backend/src/stores/stores.service.spec.ts`
- Modify: `apps/backend/src/app.module.ts` (import + register `StoresModule`)

**Interfaces:**
- Consumes: `TenantInterceptor`, `@Tenant() TenantContext` (`tenantId`), `JwtAuthGuard`, `StorePermissionGuard`, `@RequireStorePermission`, `StorePermission.MANAGE_STORES`.
- Produces: `StoresService.rename(tenantId: string, storeId: string, name: string): Promise<{ id: string; name: string }>`; HTTP `PATCH /stores/:id` body `{ name: string }`.

- [ ] **Step 1: Add the `MANAGE_STORES` permission**

In `packages/shared-types/index.ts`, under `// User Management` (after line 47):

```ts
  // User Management
  MANAGE_USERS: "MANAGE_USERS",
  MANAGE_USER_STORE_ACCESS: "MANAGE_USER_STORE_ACCESS",
  MANAGE_STORES: "MANAGE_STORES",
```

`OWNER` receives it automatically via `Object.values(StorePermission)` (index.ts:71); OWNER also bypasses `StorePermissionGuard` (guard line 66-68), so no backfill is needed for existing owners.

- [ ] **Step 2: Write the failing service test**

Create `apps/backend/src/stores/stores.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';

describe('StoresService.rename', () => {
    const db = {
        store: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    };
    let service: StoresService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new StoresService(db as any);
    });

    it('renames a store that belongs to the tenant', async () => {
        db.store.findFirst.mockResolvedValue({ id: 's1', tenant_id: 't1' });
        db.store.update.mockResolvedValue({ id: 's1', name: 'Gulshan Branch' });
        const result = await service.rename('t1', 's1', '  Gulshan Branch  ');
        expect(db.store.findFirst).toHaveBeenCalledWith({ where: { id: 's1', tenant_id: 't1' } });
        expect(db.store.update).toHaveBeenCalledWith({
            where: { id: 's1' },
            data: { name: 'Gulshan Branch' },
            select: { id: true, name: true },
        });
        expect(result).toEqual({ id: 's1', name: 'Gulshan Branch' });
    });

    it('rejects a store from another tenant', async () => {
        db.store.findFirst.mockResolvedValue(null);
        await expect(service.rename('t1', 'sX', 'Anything')).rejects.toBeInstanceOf(NotFoundException);
        expect(db.store.update).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/backend && npx jest src/stores/stores.service.spec.ts`
Expected: FAIL with "Cannot find module './stores.service'".

- [ ] **Step 4: Create the DTO**

Create `apps/backend/src/stores/update-store.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateStoreDto {
    @IsString({ message: 'Store name is required.' })
    @MinLength(1, { message: 'Store name is required.' })
    @MaxLength(100)
    name: string;
}
```

- [ ] **Step 5: Create the service**

Create `apps/backend/src/stores/stores.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class StoresService {
    constructor(private readonly db: DatabaseService) {}

    async rename(tenantId: string, storeId: string, name: string): Promise<{ id: string; name: string }> {
        const store = await this.db.store.findFirst({ where: { id: storeId, tenant_id: tenantId } });
        if (!store) {
            throw new NotFoundException('Store not found');
        }
        return this.db.store.update({
            where: { id: storeId },
            data: { name: name.trim() },
            select: { id: true, name: true },
        });
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/backend && npx jest src/stores/stores.service.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 7: Create the controller**

Create `apps/backend/src/stores/stores.controller.ts`:

```ts
import { Body, Controller, Param, Patch, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { StoresService } from './stores.service';
import { UpdateStoreDto } from './update-store.dto';

@Controller('stores')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class StoresController {
    constructor(private readonly stores: StoresService) {}

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_STORES)
    async rename(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateStoreDto,
    ) {
        return this.stores.rename(tenant.tenantId, id, dto.name);
    }
}
```

- [ ] **Step 8: Create the module**

Create `apps/backend/src/stores/stores.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
    imports: [DatabaseModule],
    controllers: [StoresController],
    providers: [StoresService],
})
export class StoresModule {}
```

> If `StorePermissionGuard` needs `DatabaseService`/`Reflector`, they are provided globally / by `DatabaseModule` + Nest core the same way other guarded controllers resolve them (see `team.module.ts`). Mirror `team.module.ts` imports if the build complains about a missing provider.

- [ ] **Step 9: Register the module in `app.module.ts`**

Add the import near the other feature-module imports (alongside line 21 `TeamModule`):

```ts
import { StoresModule } from './stores/stores.module';
```

And add `StoresModule,` to the `imports:` array next to `TeamModule,` (line 114).

- [ ] **Step 10: Build and run the stores tests**

Run: `cd apps/backend && npx tsc --noEmit -p tsconfig.json && npx jest src/stores`
Expected: no type errors; tests PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/shared-types/index.ts apps/backend/src/stores apps/backend/src/app.module.ts
git commit -m "feat(stores): PATCH /stores/:id rename endpoint with MANAGE_STORES permission"
```

---

## Task 5: Slim the signup form (frontend)

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (add `getSignupDefaults`, ~after line 1136)
- Modify: `apps/frontend/src/app/signup/page.tsx`
- Modify: `apps/frontend/src/app/signup/page.test.tsx`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts` (signup `description` copy)

**Interfaces:**
- Consumes: `GET /auth/signup-defaults` → `{ defaultPlanCode }` (Task 1).
- Produces: a signup form with three required inputs (org name, email, password), an optional mobile field, and a plan picker pre-selected from `defaultPlanCode`.

- [ ] **Step 1: Add the API client method**

In `apps/frontend/src/lib/api.ts`, after `getSubscriptionPlans` (after line 1136):

```ts
    getSignupDefaults: () => fetch(`${API_BASE}/auth/signup-defaults`).then(async res => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.message || 'Failed to load signup defaults');
        return body && 'data' in body ? body.data : body;
    }),
```

- [ ] **Step 2: Update the signup page test to the new contract**

In `apps/frontend/src/app/signup/page.test.tsx`, ensure the `api` mock includes `getSignupDefaults: jest.fn().mockResolvedValue({ defaultPlanCode: 'STANDARD' })`. Replace any assertion that requires the "Your name" or "store name" fields with an assertion that submitting with only org name + email + password calls `api.signup`. Example test body:

```ts
it('submits with org name, email and password only', async () => {
    render(<SignupPage />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: 'Dhaka Retail Co.' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'owner@shop.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    await waitFor(() => expect(api.signup).toHaveBeenCalled());
    const payload = (api.signup as jest.Mock).mock.calls[0][0];
    expect(payload.tenantName).toBe('Dhaka Retail Co.');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/frontend && npx jest src/app/signup/page.test.tsx`
Expected: FAIL (form still requires name/store; `getSignupDefaults` mock unused / label queries mismatch).

- [ ] **Step 4: Remove the name + store fields and make mobile optional**

In `apps/frontend/src/app/signup/page.tsx`:

(a) Remove `name` and `storeName` from the `form` initial state (lines 64, 70). Keep `mobile`, `mobile_country_code`, `tenantName`, `planCode`, `referralCode`, `email`, `password`.

(b) Replace the validation block (lines 150-177) with (drops name/store/mobile-required checks; mobile validated only when present):

```ts
        if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
            setError(t.auth.signup.emailInvalid);
            return;
        }
        if (form.password.length < 8) {
            setError(t.auth.signup.passwordTooShort);
            return;
        }
        if (!form.tenantName.trim()) {
            setError(t.auth.signup.orgNameRequired);
            return;
        }
        if (form.mobile.trim() && !normalizeMobileToE164(form.mobile_country_code, form.mobile)) {
            setError(t.auth.signup.mobileInvalid);
            return;
        }
```

(c) Delete the "Your name" input block (lines 245-251) and the "Primary store name" input block (lines 319-325).

(d) On the `PhoneNumberField` (lines 262-272), remove the `required` prop so mobile is optional.

(e) Pre-select the default plan: add a `useEffect` after the existing plan-loading effect (after line 88):

```ts
    useEffect(() => {
        api.getSignupDefaults()
            .then((defaults: { defaultPlanCode?: Plan['code'] }) => {
                if (defaults?.defaultPlanCode) {
                    setForm((current) => ({ ...current, planCode: defaults.defaultPlanCode as Plan['code'] }));
                }
            })
            .catch(() => null);
    }, []);
```

Also change the hardcoded initial `planCode: 'BASIC'` (line 71) to `planCode: 'STANDARD' as Plan['code']` so the pre-API default matches the seeded platform default. The `?plan=` query-param effect (lines 90-100) still overrides both.

- [ ] **Step 5: Update the signup description copy (all 3 locales)**

In `apps/frontend/src/lib/localization/messages/en/core.ts`, change the signup `description` (currently "Set up your organization, first store, and plan in one flow") to:

```ts
            description: 'Set up your organization and plan in one flow',
```

Apply the equivalent wording in `bn/core.ts` and `ms/core.ts` (translate the same meaning; drop the "first store" clause). The now-unused keys `nameLabel`, `storeLabel`, `nameRequired`, `storeNameRequired`, `mobileRequired` may be left in place (harmless) — do not remove them to avoid touching unrelated call sites.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/frontend && npx jest src/app/signup/page.test.tsx`
Expected: PASS.

- [ ] **Step 7: Type-check the frontend**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: no errors (removed `form.name` / `form.storeName` references are gone; the `...form` spread in `api.signup` no longer carries them).

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/app/signup/page.tsx apps/frontend/src/app/signup/page.test.tsx apps/frontend/src/lib/localization/messages
git commit -m "feat(signup): three-field form, optional mobile, default plan from platform settings"
```

---

## Task 6: Store rename settings UI (frontend)

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (add `updateStore`)
- Create: `apps/frontend/src/app/(app)/settings/stores/page.tsx`
- Modify: `apps/frontend/src/lib/localization/messages/{en,bn,ms}/core.ts` (store-settings strings)

**Interfaces:**
- Consumes: existing `api.getStores()` (api.ts:810) for the list; `PATCH /stores/:id` (Task 4).
- Produces: a settings page listing the tenant's stores with an editable name per store.

- [ ] **Step 1: Add the API client method**

In `apps/frontend/src/lib/api.ts`, near `getStores` (after line 817):

```ts
    updateStore: (id: string, data: { name: string }) =>
        fetchWithAuth(`/stores/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        }),
```

- [ ] **Step 2: Add localized strings (en, then bn/ms mirrors)**

In `apps/frontend/src/lib/localization/messages/en/core.ts`, add a `storeSettings` block under the settings namespace (place near the other settings groups; if unsure, add it as a sibling of `branding` in the same object that holds settings page copy):

```ts
            storeSettings: {
                title: 'Stores',
                description: 'Rename your stores.',
                nameLabel: 'Store name',
                save: 'Save',
                saved: 'Store name updated.',
                error: 'Could not update the store name.',
            },
```

Mirror the same keys (translated) in `bn/core.ts` and `ms/core.ts`.

- [ ] **Step 3: Create the settings page**

Create `apps/frontend/src/app/(app)/settings/stores/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type StoreRow = { id: string; name: string };

export default function StoreSettingsPage() {
    const { t } = useI18n();
    const copy = t.settings.storeSettings;
    const [stores, setStores] = useState<StoreRow[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.getStores()
            .then((rows: StoreRow[]) => setStores(Array.isArray(rows) ? rows.map((s) => ({ id: s.id, name: s.name })) : []))
            .catch(() => setStores([]));
    }, []);

    const handleName = (id: string, name: string) => {
        setStores((rows) => rows.map((s) => (s.id === id ? { ...s, name } : s)));
    };

    const handleSave = async (store: StoreRow) => {
        setSavingId(store.id);
        setMessage(null);
        setError(null);
        try {
            await api.updateStore(store.id, { name: store.name.trim() });
            setMessage(copy.saved);
        } catch {
            setError(copy.error);
        } finally {
            setSavingId(null);
        }
    };

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-xl font-bold">{copy.title}</h1>
                <p className="text-sm text-gray-500">{copy.description}</p>
            </div>
            {message && <p className="text-sm text-emerald-600">{message}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="space-y-4">
                {stores.map((store) => (
                    <div key={store.id} className="flex items-end gap-3">
                        <label className="flex-1 space-y-1">
                            <span className="text-sm font-medium text-gray-700">{copy.nameLabel}</span>
                            <input
                                value={store.name}
                                onChange={(e) => handleName(store.id, e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => handleSave(store)}
                            disabled={savingId === store.id || !store.name.trim()}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-xl disabled:opacity-70"
                        >
                            {copy.save}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Type-check the frontend**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: no errors. If `t.settings.storeSettings` errors, confirm the strings from Step 2 were added to the correct settings object in all three locale files.

- [ ] **Step 5: Manual smoke via build**

Run: `cd apps/frontend && npx next build --no-lint 2>&1 | tail -20`
Expected: build succeeds and `/settings/stores` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/lib/api.ts "apps/frontend/src/app/(app)/settings/stores/page.tsx" apps/frontend/src/lib/localization/messages
git commit -m "feat(settings): store rename page consuming PATCH /stores/:id"
```

---

## Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend test suite**

Run: `cd apps/backend && npm test`
Expected: all suites pass (new auth + stores specs included).

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd apps/frontend && npm test`
Expected: all suites pass (updated signup page test included).

- [ ] **Step 3: Verify the signup flow end-to-end (use the verify skill)**

Drive the real flow: start backend + frontend, POST `/auth/signup` with only `{ email, password, tenantName }`, and confirm the response creates a tenant + a store named "Main Store" on the configured default plan, with `User.name` = email local-part and `mobile` null. Then sign up a second account reusing the same mobile and confirm it succeeds. Then call `PATCH /stores/:id` as the owner and confirm the store renames.

- [ ] **Step 4: Update `TODO.md`**

Per CLAUDE.md, check off the signup-simplification items, move them to `## COMPLETED` with today's date, and add any follow-ups discovered (e.g. the still-open `Tenant.name` rename gap noted as out-of-scope in the spec).

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "docs(todo): record simplified signup + store rename completion"
```

---

## Notes / Out of Scope

- `Tenant.name` (org name) rename is **not** addressed here — remains a separate future task (only store rename is in scope). Branding display name (`brand_business_name`) remains the existing proxy.
- Making mobile optional removes guaranteed mobile-for-OTP/recovery at signup; email verification still covers account verification.
- The now-unused i18n keys (`nameLabel`, `storeLabel`, `nameRequired`, `storeNameRequired`, `mobileRequired`) are intentionally left in the locale files to avoid touching unrelated code; cleaning them up is optional future work.
