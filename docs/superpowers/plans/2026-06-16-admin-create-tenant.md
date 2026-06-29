# Admin: Create New Tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let platform admins create a new tenant (with owner user, store, and subscription) directly from the admin dashboard — equivalent to a manual signup on behalf of a customer.

**Architecture:** New `POST /admin/tenants` endpoint added to `AdminTenantsController`. Provisioning logic lives inline in `AdminTenantsService` (no new services). New `GET /admin/users/lookup?email=` in `AdminUsersController` for resolving existing users by email before submission. Modal UI added to the existing tenants page.

**Tech Stack:** NestJS, Prisma, bcrypt, Node.js crypto, Jest (unit tests), Next.js 15, Tailwind CSS, lucide-react

---

## File Map

| File | Change |
|------|--------|
| `apps/backend/src/admin-tenants/admin-tenants.dto.ts` | Add `CreateAdminTenantDto` |
| `apps/backend/src/admin-tenants/admin-tenants.service.ts` | Add `lookupUserByEmail`, `createTenant`; inject `EmailService`; add imports |
| `apps/backend/src/admin-tenants/admin-tenants.module.ts` | Import `EmailModule` |
| `apps/backend/src/admin-tenants/admin-tenants.controller.ts` | Add `POST /` handler |
| `apps/backend/src/admin-tenants/admin-users.controller.ts` | Add `GET /lookup` handler |
| `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts` | Add tests for new service methods |
| `apps/frontend/src/lib/localization/messages/en/admin.ts` | Add `createModal` keys |
| `apps/frontend/src/lib/localization/messages/bn/admin.ts` | Add `createModal` keys (Bengali) |
| `apps/frontend/src/lib/localization/messages/ms/admin.ts` | Add `createModal` keys (Malay) |
| `apps/frontend/src/lib/api.ts` | Add `createAdminTenant` and `lookupAdminUser` |
| `apps/frontend/src/app/dashboard/admin/tenants/page.tsx` | Add "New Tenant" button + modal |

---

### Task 1: Add CreateAdminTenantDto

**Files:**
- Modify: `apps/backend/src/admin-tenants/admin-tenants.dto.ts`

- [ ] **Step 1: Update the DTO file**

Replace the first import line in `apps/backend/src/admin-tenants/admin-tenants.dto.ts` (currently `import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';`) with:

```ts
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
```

Then append this class at the bottom of the file:

```ts
export class CreateAdminTenantDto {
    @IsIn(['new', 'existing'])
    ownerMode: 'new' | 'existing';

    @ValidateIf((o) => o.ownerMode === 'new')
    @IsEmail()
    ownerEmail?: string;

    @ValidateIf((o) => o.ownerMode === 'new')
    @IsOptional()
    @IsString()
    ownerName?: string;

    @ValidateIf((o) => o.ownerMode === 'existing')
    @IsString()
    ownerUserId?: string;

    @IsString()
    tenantName: string;

    @IsString()
    storeName: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    businessType?: string;

    @IsIn(['FREE', 'BASIC', 'STANDARD', 'PREMIUM'])
    planCode: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/admin-tenants/admin-tenants.dto.ts
git commit -m "feat(admin): add CreateAdminTenantDto"
```

---

### Task 2: Service methods + tests

**Files:**
- Modify: `apps/backend/src/admin-tenants/admin-tenants.service.ts`
- Modify: `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts`

- [ ] **Step 1: Write failing tests**

At the very top of `apps/backend/src/admin-tenants/admin-tenants.service.spec.ts` (before any `import` statements — Jest hoists `jest.mock` calls automatically), add:

```ts
jest.mock('@erp71/database', () => ({
    bootstrapDefaultAccountingForTenant: jest.fn().mockResolvedValue(undefined),
    seedBusinessTypeTemplate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('hashed-temp-password'),
}));
```

Update the existing `import { NotFoundException } from '@nestjs/common';` line to also include `ConflictException`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
```

Add a new import for `EmailService`:

```ts
import { EmailService } from '../email/email.service';
```

In the `describe('AdminTenantsService', ...)` block, add `let emailService: any;` alongside the existing `let` declarations.

Inside `beforeEach`, expand the `db` object to add the new models and methods:

```ts
db = {
    tenant: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),          // ADD
    },
    tenantUser: { create: jest.fn() },           // ADD
    store: { create: jest.fn() },                // ADD
    subscriptionPlan: { findUnique: jest.fn() }, // ADD
    tenantSubscription: {
        findUnique: jest.fn(),
        update: jest.fn(),
        groupBy: jest.fn(),
        create: jest.fn(),          // ADD
    },
    userStoreAccess: { create: jest.fn() },          // ADD
    userStorePermission: { createMany: jest.fn() },   // ADD
    user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),          // ADD
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(db)),
};

emailService = {
    sendWelcome: jest.fn().mockResolvedValue(undefined),
};
```

Add `{ provide: EmailService, useValue: emailService }` to the `providers` array inside `Test.createTestingModule`.

Then add these two `describe` blocks at the end of the file (before the final closing `}`):

```ts
/* ------------------------------------------------------------------ */
/*  lookupUserByEmail                                                   */
/* ------------------------------------------------------------------ */

describe('lookupUserByEmail', () => {
    it('returns id, email, name when user exists', async () => {
        db.user.findUnique.mockResolvedValue({
            id: 'u-1',
            email: 'test@example.com',
            name: 'Test User',
        });

        const result = await service.lookupUserByEmail('test@example.com');

        expect(result).toEqual({ id: 'u-1', email: 'test@example.com', name: 'Test User' });
        expect(db.user.findUnique).toHaveBeenCalledWith({
            where: { email: 'test@example.com' },
            select: { id: true, email: true, name: true },
        });
    });

    it('throws NotFoundException when user does not exist', async () => {
        db.user.findUnique.mockResolvedValue(null);

        await expect(service.lookupUserByEmail('ghost@example.com')).rejects.toThrow(NotFoundException);
    });
});

/* ------------------------------------------------------------------ */
/*  createTenant                                                        */
/* ------------------------------------------------------------------ */

describe('createTenant', () => {
    const plan = { id: 'plan-1', code: 'FREE', is_active: true };

    beforeEach(() => {
        db.subscriptionPlan.findUnique.mockResolvedValue(plan);
        db.tenant.create.mockResolvedValue({ id: 't-new', name: 'Acme Ltd' });
        db.tenantUser.create.mockResolvedValue({});
        db.store.create.mockResolvedValue({ id: 's-new', name: 'Acme Store' });
        db.tenantSubscription.create.mockResolvedValue({});
        db.userStoreAccess.create.mockResolvedValue({});
        db.userStorePermission.createMany.mockResolvedValue({ count: 10 });
        db.tenant.findUnique.mockResolvedValue(makeTenant({ id: 't-new', name: 'Acme Ltd' }));
    });

    describe('ownerMode = new', () => {
        it('creates a new user and provisions the tenant', async () => {
            db.user.findUnique.mockResolvedValueOnce(null); // email check → not taken
            db.user.create.mockResolvedValue({ id: 'u-new', email: 'owner@acme.com', name: 'Alice' });

            const result = await service.createTenant(
                {
                    ownerMode: 'new',
                    ownerEmail: 'owner@acme.com',
                    ownerName: 'Alice',
                    tenantName: 'Acme Ltd',
                    storeName: 'Acme Store',
                    planCode: 'FREE',
                },
                'admin-1',
            );

            expect(db.user.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ email: 'owner@acme.com', name: 'Alice' }),
                }),
            );
            expect(emailService.sendWelcome).toHaveBeenCalledWith('owner@acme.com', 'Alice');
            expect(db.tenant.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ name: 'Acme Ltd', owner_id: 'u-new' }),
                }),
            );
            expect(auditService.log).toHaveBeenCalledWith(
                'tenant.admin_create',
                'Tenant',
                expect.anything(),
                't-new',
                expect.objectContaining({ owner_mode: 'new' }),
            );
            expect(result.id).toBe('t-new');
        });

        it('throws ConflictException when email is already registered', async () => {
            db.user.findUnique.mockResolvedValueOnce({ id: 'u-taken' }); // email taken

            await expect(
                service.createTenant(
                    { ownerMode: 'new', ownerEmail: 'taken@test.com', tenantName: 'X', storeName: 'X', planCode: 'FREE' },
                    'admin-1',
                ),
            ).rejects.toThrow(ConflictException);

            expect(db.user.create).not.toHaveBeenCalled();
        });
    });

    describe('ownerMode = existing', () => {
        it('reuses an existing user and skips user creation', async () => {
            db.user.findUnique.mockResolvedValueOnce({
                id: 'u-existing',
                email: 'owner@acme.com',
                name: 'Bob',
            });

            const result = await service.createTenant(
                {
                    ownerMode: 'existing',
                    ownerUserId: 'u-existing',
                    tenantName: 'Acme Ltd',
                    storeName: 'Acme Store',
                    planCode: 'FREE',
                },
                'admin-1',
            );

            expect(db.user.create).not.toHaveBeenCalled();
            expect(emailService.sendWelcome).not.toHaveBeenCalled();
            expect(db.tenant.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ owner_id: 'u-existing' }),
                }),
            );
            expect(result.id).toBe('t-new');
        });

        it('throws NotFoundException when ownerUserId does not exist', async () => {
            db.user.findUnique.mockResolvedValueOnce(null);

            await expect(
                service.createTenant(
                    { ownerMode: 'existing', ownerUserId: 'ghost', tenantName: 'X', storeName: 'X', planCode: 'FREE' },
                    'admin-1',
                ),
            ).rejects.toThrow(NotFoundException);
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/backend && npx jest admin-tenants.service.spec --no-coverage 2>&1 | tail -20
```

Expected: Failures like `TypeError: service.lookupUserByEmail is not a function` and `service.createTenant is not a function`.

- [ ] **Step 3: Implement the service methods**

In `apps/backend/src/admin-tenants/admin-tenants.service.ts`, update the imports at the top:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { bootstrapDefaultAccountingForTenant, seedBusinessTypeTemplate } from '@erp71/database';
import { ROLE_DEFAULT_PERMISSIONS, UserRole } from '@erp71/shared-types';
import {
    ListAdminTenantsQueryDto,
    ListAdminUsersQueryDto,
    SuspendTenantDto,
    UpdateAdminTenantSubscriptionDto,
    CreateAdminTenantDto,
} from './admin-tenants.dto';
```

Update the constructor to inject `EmailService`:

```ts
constructor(
    private readonly db: DatabaseService,
    private readonly billingService: BillingService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
) {}
```

Add these two methods after `impersonateTenant` and before `getMetrics`:

```ts
async lookupUserByEmail(email: string) {
    const user = await this.db.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
}

async createTenant(dto: CreateAdminTenantDto, adminUserId: string) {
    let ownerId: string;
    let ownerEmail: string;
    let ownerName: string | null;

    if (dto.ownerMode === 'new') {
        const existing = await this.db.user.findUnique({ where: { email: dto.ownerEmail! } });
        if (existing) throw new ConflictException('Email is already registered');

        const tempPassword = crypto.randomBytes(8).toString('hex');
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        const newUser = await this.db.user.create({
            data: { email: dto.ownerEmail!, name: dto.ownerName ?? null, passwordHash },
        });

        ownerId = newUser.id;
        ownerEmail = newUser.email;
        ownerName = (newUser as any).name ?? null;

        this.emailService.sendWelcome(ownerEmail, ownerName ?? ownerEmail).catch((err: any) => {
            console.warn(`[AdminTenantsService] Welcome email failed for ${ownerEmail}:`, err?.message);
        });
    } else {
        const user = await this.db.user.findUnique({ where: { id: dto.ownerUserId! } });
        if (!user) throw new NotFoundException('User not found');
        ownerId = user.id;
        ownerEmail = user.email;
        ownerName = (user as any).name ?? null;
    }

    const plan = await this.db.subscriptionPlan.findUnique({ where: { code: dto.planCode } });
    if (!plan?.is_active) throw new BadRequestException('Selected subscription plan is not available.');

    const { tenant } = await this.db.$transaction(async (tx: any) => {
        const tenant = await tx.tenant.create({
            data: {
                name: dto.tenantName,
                owner_id: ownerId,
                ...(dto.businessType ? { business_type: dto.businessType } : {}),
            },
        });

        await tx.tenantUser.create({
            data: { tenant_id: tenant.id, user_id: ownerId, role: 'OWNER' },
        });

        const store = await tx.store.create({
            data: { tenant_id: tenant.id, name: dto.storeName, address: dto.address ?? null },
        });

        await tx.tenantSubscription.create({
            data: {
                tenant_id: tenant.id,
                plan_id: plan.id,
                status: 'TRIALING',
                current_period_start: new Date(),
                current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                provider_name: 'manual',
            },
        });

        await tx.userStoreAccess.create({
            data: {
                user_id: ownerId,
                store_id: store.id,
                tenant_id: tenant.id,
                access_level: 'MULTI_STORE_CAPABLE',
            },
        });

        const ownerPermissions = ROLE_DEFAULT_PERMISSIONS[UserRole.OWNER];
        await tx.userStorePermission.createMany({
            data: ownerPermissions.map((permission: string) => ({
                user_id: ownerId,
                store_id: store.id,
                tenant_id: tenant.id,
                permission,
                granted_by: ownerId,
            })),
            skipDuplicates: true,
        });

        await bootstrapDefaultAccountingForTenant(tx, tenant.id);

        return { tenant, store };
    });

    if (dto.businessType) {
        seedBusinessTypeTemplate(this.db, tenant.id, dto.businessType).catch((err: any) =>
            console.error(`[AdminTenantsService] Failed to seed business type template:`, err),
        );
    }

    await this.auditService.log('tenant.admin_create', 'Tenant', { userId: adminUserId }, tenant.id, {
        owner_email: ownerEmail,
        owner_mode: dto.ownerMode,
    });

    return this.getTenant(tenant.id);
}
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd apps/backend && npx jest admin-tenants.service.spec --no-coverage 2>&1 | tail -20
```

Expected: All tests pass, including the existing ones.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/admin-tenants/admin-tenants.service.ts \
        apps/backend/src/admin-tenants/admin-tenants.service.spec.ts
git commit -m "feat(admin): add lookupUserByEmail and createTenant to AdminTenantsService"
```

---

### Task 3: Wire up controllers and module

**Files:**
- Modify: `apps/backend/src/admin-tenants/admin-tenants.controller.ts`
- Modify: `apps/backend/src/admin-tenants/admin-users.controller.ts`
- Modify: `apps/backend/src/admin-tenants/admin-tenants.module.ts`

- [ ] **Step 1: Add POST / to AdminTenantsController**

In `apps/backend/src/admin-tenants/admin-tenants.controller.ts`, update the DTO import to include `CreateAdminTenantDto`:

```ts
import {
    ListAdminTenantsQueryDto,
    UpdateAdminTenantSubscriptionDto,
    SuspendTenantDto,
    CreateAdminTenantDto,
} from './admin-tenants.dto';
```

Add this handler after `listTenants`:

```ts
@Post()
createTenant(
    @Body() dto: CreateAdminTenantDto,
    @Request() req: any,
) {
    return this.adminTenantsService.createTenant(dto, req.user.userId);
}
```

- [ ] **Step 2: Add GET /lookup to AdminUsersController**

In `apps/backend/src/admin-tenants/admin-users.controller.ts`, the import line already has `Query`. Add this handler before `listUsers`:

```ts
@Get('lookup')
lookupUser(@Query('email') email: string) {
    return this.adminTenantsService.lookupUserByEmail(email);
}
```

- [ ] **Step 3: Import EmailModule into AdminTenantsModule**

Replace the full content of `apps/backend/src/admin-tenants/admin-tenants.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BillingModule } from '../billing/billing.module';
import { EmailModule } from '../email/email.module';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminMetricsController } from './admin-metrics.controller';
import { AdminTenantsService } from './admin-tenants.service';

@Module({
    imports: [
        BillingModule,
        EmailModule,
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'fallback-secret-for-dev-only',
            signOptions: { expiresIn: '1h' },
        }),
    ],
    controllers: [AdminTenantsController, AdminUsersController, AdminMetricsController],
    providers: [AdminTenantsService, PlatformAdminGuard],
})
export class AdminTenantsModule {}
```

- [ ] **Step 4: Run all admin-tenants tests**

```bash
cd apps/backend && npx jest admin-tenants --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/admin-tenants/admin-tenants.controller.ts \
        apps/backend/src/admin-tenants/admin-users.controller.ts \
        apps/backend/src/admin-tenants/admin-tenants.module.ts
git commit -m "feat(admin): wire POST /admin/tenants and GET /admin/users/lookup endpoints"
```

---

### Task 4: i18n locale keys

**Files:**
- Modify: `apps/frontend/src/lib/localization/messages/en/admin.ts`
- Modify: `apps/frontend/src/lib/localization/messages/bn/admin.ts`
- Modify: `apps/frontend/src/lib/localization/messages/ms/admin.ts`

- [ ] **Step 1: Add English keys**

In `apps/frontend/src/lib/localization/messages/en/admin.ts`, inside the `tenants` object, after the `selectPrompt` line, add:

```ts
createModal: {
    trigger: 'New Tenant',
    title: 'Create New Tenant',
    ownerSection: 'Owner',
    tabNewUser: 'New User',
    tabExistingUser: 'Existing User',
    ownerEmail: 'Owner Email',
    ownerName: 'Owner Name (optional)',
    lookupEmail: 'Search by email',
    userNotFound: 'No user found with this email',
    tenantSection: 'Tenant & Store',
    tenantName: 'Tenant Name',
    storeName: 'Store Name',
    address: 'Address (optional)',
    businessType: 'Business Type (optional)',
    plan: 'Subscription Plan',
    cancel: 'Cancel',
    create: 'Create Tenant',
    creating: 'Creating...',
    successToast: '{name} created successfully',
    createFailed: 'Failed to create tenant',
},
```

- [ ] **Step 2: Add Bengali keys**

In `apps/frontend/src/lib/localization/messages/bn/admin.ts`, inside the `tenants` object, after the `selectPrompt` line, add:

```ts
createModal: {
    trigger: 'নতুন টেন্যান্ট',
    title: 'নতুন টেন্যান্ট তৈরি করুন',
    ownerSection: 'মালিক',
    tabNewUser: 'নতুন ব্যবহারকারী',
    tabExistingUser: 'বিদ্যমান ব্যবহারকারী',
    ownerEmail: 'মালিকের ইমেইল',
    ownerName: 'মালিকের নাম (ঐচ্ছিক)',
    lookupEmail: 'ইমেইল দিয়ে খুঁজুন',
    userNotFound: 'এই ইমেইলে কোনো ব্যবহারকারী পাওয়া যায়নি',
    tenantSection: 'টেন্যান্ট ও স্টোর',
    tenantName: 'টেন্যান্টের নাম',
    storeName: 'স্টোরের নাম',
    address: 'ঠিকানা (ঐচ্ছিক)',
    businessType: 'ব্যবসার ধরন (ঐচ্ছিক)',
    plan: 'সাবস্ক্রিপশন প্ল্যান',
    cancel: 'বাতিল',
    create: 'টেন্যান্ট তৈরি করুন',
    creating: 'তৈরি হচ্ছে...',
    successToast: '{name} সফলভাবে তৈরি হয়েছে',
    createFailed: 'টেন্যান্ট তৈরি করতে ব্যর্থ',
},
```

- [ ] **Step 3: Add Malay keys**

In `apps/frontend/src/lib/localization/messages/ms/admin.ts`, inside the `tenants` object, after the `selectPrompt` line, add:

```ts
createModal: {
    trigger: 'Penyewa Baharu',
    title: 'Cipta Penyewa Baharu',
    ownerSection: 'Pemilik',
    tabNewUser: 'Pengguna Baharu',
    tabExistingUser: 'Pengguna Sedia Ada',
    ownerEmail: 'E-mel Pemilik',
    ownerName: 'Nama Pemilik (pilihan)',
    lookupEmail: 'Cari mengikut e-mel',
    userNotFound: 'Tiada pengguna ditemui dengan e-mel ini',
    tenantSection: 'Penyewa & Kedai',
    tenantName: 'Nama Penyewa',
    storeName: 'Nama Kedai',
    address: 'Alamat (pilihan)',
    businessType: 'Jenis Perniagaan (pilihan)',
    plan: 'Pelan Langganan',
    cancel: 'Batal',
    create: 'Cipta Penyewa',
    creating: 'Mencipta...',
    successToast: '{name} berjaya dicipta',
    createFailed: 'Gagal mencipta penyewa',
},
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/lib/localization/messages/en/admin.ts \
        apps/frontend/src/lib/localization/messages/bn/admin.ts \
        apps/frontend/src/lib/localization/messages/ms/admin.ts
git commit -m "feat(admin): add createModal i18n keys for tenant creation"
```

---

### Task 5: Frontend API client methods

**Files:**
- Modify: `apps/frontend/src/lib/api.ts`

- [ ] **Step 1: Add createAdminTenant and lookupAdminUser**

In `apps/frontend/src/lib/api.ts`, after the existing `impersonateTenant` entry (around line 892), add:

```ts
createAdminTenant: (data: {
    ownerMode: 'new' | 'existing';
    ownerEmail?: string;
    ownerName?: string;
    ownerUserId?: string;
    tenantName: string;
    storeName: string;
    address?: string;
    businessType?: string;
    planCode: string;
}) => fetchWithAuth('/admin/tenants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
}),

lookupAdminUser: (email: string) =>
    fetchWithAuth(`/admin/users/lookup?email=${encodeURIComponent(email)}`),
```

- [ ] **Step 2: Run existing API tests**

```bash
cd apps/frontend && npx jest lib/api.test --no-coverage 2>&1 | tail -10
```

Expected: All pre-existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/api.ts
git commit -m "feat(admin): add createAdminTenant and lookupAdminUser API client methods"
```

---

### Task 6: Frontend modal UI

**Files:**
- Modify: `apps/frontend/src/app/dashboard/admin/tenants/page.tsx`

- [ ] **Step 1: Add Plus to the lucide-react import**

Find the existing lucide-react import line:

```ts
import { Building2, Loader2, Search, ShieldCheck, Users, UserX, LogIn, CheckCircle } from 'lucide-react';
```

Replace it with:

```ts
import { Building2, CheckCircle, Loader2, LogIn, Plus, Search, ShieldCheck, Users, UserX } from 'lucide-react';
```

- [ ] **Step 2: Add modal state variables**

In the `AdminTenantsPage` function body, after the existing `const [isImpersonating, setIsImpersonating] = useState(false);` line, add:

```ts
const mc = m.createModal;

type CreateDraft = {
    ownerEmail: string;
    ownerName: string;
    existingEmail: string;
    ownerUserId: string;
    tenantName: string;
    storeName: string;
    address: string;
    businessType: string;
    planCode: PlanCode;
};

const emptyDraft = (): CreateDraft => ({
    ownerEmail: '', ownerName: '', existingEmail: '', ownerUserId: '',
    tenantName: '', storeName: '', address: '', businessType: '', planCode: 'FREE',
});

const [showCreateModal, setShowCreateModal] = useState(false);
const [createMode, setCreateMode] = useState<'new' | 'existing'>('new');
const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyDraft());
const [lookupResult, setLookupResult] = useState<{ id: string; email: string; name: string | null } | null>(null);
const [lookupNotFound, setLookupNotFound] = useState(false);
const [isLookingUp, setIsLookingUp] = useState(false);
const [isCreating, setIsCreating] = useState(false);
const [createError, setCreateError] = useState('');
```

- [ ] **Step 3: Add modal handler functions**

After the existing `showToast` function, add:

```ts
const openCreateModal = () => {
    setCreateDraft(emptyDraft());
    setCreateMode('new');
    setLookupResult(null);
    setLookupNotFound(false);
    setCreateError('');
    setShowCreateModal(true);
};

const closeCreateModal = () => {
    if (isCreating) return;
    setShowCreateModal(false);
};

const handleLookup = async () => {
    if (!createDraft.existingEmail) return;
    setIsLookingUp(true);
    setLookupResult(null);
    setLookupNotFound(false);
    setCreateDraft((d) => ({ ...d, ownerUserId: '' }));
    try {
        const user: any = await api.lookupAdminUser(createDraft.existingEmail);
        setLookupResult(user);
        setCreateDraft((d) => ({ ...d, ownerUserId: user.id }));
    } catch {
        setLookupNotFound(true);
    } finally {
        setIsLookingUp(false);
    }
};

const handleCreate = async () => {
    setIsCreating(true);
    setCreateError('');
    try {
        const payload: any = {
            ownerMode: createMode,
            tenantName: createDraft.tenantName,
            storeName: createDraft.storeName,
            planCode: createDraft.planCode,
        };
        if (createDraft.address) payload.address = createDraft.address;
        if (createDraft.businessType) payload.businessType = createDraft.businessType;
        if (createMode === 'new') {
            payload.ownerEmail = createDraft.ownerEmail;
            if (createDraft.ownerName) payload.ownerName = createDraft.ownerName;
        } else {
            payload.ownerUserId = createDraft.ownerUserId;
        }

        const created: any = await api.createAdminTenant(payload);
        setShowCreateModal(false);
        showToast(formatMessage(mc.successToast, { name: createDraft.tenantName }));

        const rows = await api.getAdminTenants({});
        setTenants(rows);
        setSelectedTenantId(created.id);
        const detail = await api.getAdminTenant(created.id);
        setSelectedTenant(detail);
    } catch (err: any) {
        setCreateError(err.message || mc.createFailed);
    } finally {
        setIsCreating(false);
    }
};
```

- [ ] **Step 4: Add "New Tenant" button to the page header**

Find this block in the JSX:

```tsx
<div>
    <h1 className="text-2xl font-black tracking-tight">{m.title}</h1>
    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">
        {m.subtitle}
    </p>
</div>
```

Replace it with:

```tsx
<div className="flex items-start justify-between gap-4">
    <div>
        <h1 className="text-2xl font-black tracking-tight">{m.title}</h1>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">
            {m.subtitle}
        </p>
    </div>
    <button
        type="button"
        onClick={openCreateModal}
        className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 hover:bg-blue-700 shrink-0"
    >
        <Plus className="w-4 h-4" /> {mc.trigger}
    </button>
</div>
```

- [ ] **Step 5: Add modal JSX**

At the very end of the returned JSX, just before the final closing `</div>` of `<div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 ...">`, add:

```tsx
{showCreateModal && (
    <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={closeCreateModal}
    >
        <div
            className="w-full max-w-lg rounded-3xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="border-b border-gray-100 px-6 py-5 shrink-0">
                <h2 className="text-lg font-black tracking-tight">{mc.title}</h2>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 overflow-y-auto">
                {createError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {createError}
                    </div>
                )}

                {/* Owner */}
                <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{mc.ownerSection}</p>
                    <div className="flex rounded-2xl border border-gray-100 overflow-hidden">
                        <button
                            type="button"
                            onClick={() => { setCreateMode('new'); setLookupResult(null); setLookupNotFound(false); }}
                            className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest transition ${createMode === 'new' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        >
                            {mc.tabNewUser}
                        </button>
                        <button
                            type="button"
                            onClick={() => setCreateMode('existing')}
                            className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest transition ${createMode === 'existing' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        >
                            {mc.tabExistingUser}
                        </button>
                    </div>

                    {createMode === 'new' ? (
                        <div className="space-y-3">
                            <input
                                type="email"
                                value={createDraft.ownerEmail}
                                onChange={(e) => setCreateDraft((d) => ({ ...d, ownerEmail: e.target.value }))}
                                placeholder={mc.ownerEmail}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                            <input
                                value={createDraft.ownerName}
                                onChange={(e) => setCreateDraft((d) => ({ ...d, ownerName: e.target.value }))}
                                placeholder={mc.ownerName}
                                className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={createDraft.existingEmail}
                                    onChange={(e) => setCreateDraft((d) => ({ ...d, existingEmail: e.target.value }))}
                                    placeholder={mc.lookupEmail}
                                    className="flex-1 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleLookup()}
                                    disabled={isLookingUp || !createDraft.existingEmail}
                                    className="rounded-2xl bg-gray-800 px-4 py-3 text-xs font-black text-white hover:bg-gray-700 disabled:opacity-50"
                                >
                                    {isLookingUp ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                </button>
                            </div>
                            {lookupResult && (
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                                    {lookupResult.name || lookupResult.email}
                                </div>
                            )}
                            {lookupNotFound && (
                                <p className="text-xs font-semibold text-red-500">{mc.userNotFound}</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Tenant & Store */}
                <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{mc.tenantSection}</p>
                    <input
                        value={createDraft.tenantName}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, tenantName: e.target.value }))}
                        placeholder={mc.tenantName}
                        className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                    <input
                        value={createDraft.storeName}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, storeName: e.target.value }))}
                        placeholder={mc.storeName}
                        className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                    <input
                        value={createDraft.address}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, address: e.target.value }))}
                        placeholder={mc.address}
                        className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                    <select
                        value={createDraft.businessType}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, businessType: e.target.value }))}
                        className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                    >
                        <option value="">{mc.businessType}</option>
                        <option value="GROCERY">Grocery</option>
                        <option value="PHARMACY">Pharmacy</option>
                        <option value="SURGICAL_MEDICAL">Surgical / Medical</option>
                        <option value="COMPUTER_HARDWARE">Computer Hardware</option>
                    </select>
                </div>

                {/* Plan */}
                <div className="space-y-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{mc.plan}</p>
                    <select
                        value={createDraft.planCode}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, planCode: e.target.value as PlanCode }))}
                        className="w-full rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                    >
                        <option value="FREE">Free</option>
                        <option value="BASIC">Basic</option>
                        <option value="STANDARD">Standard</option>
                        <option value="PREMIUM">Premium</option>
                    </select>
                </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 shrink-0">
                <button
                    type="button"
                    onClick={closeCreateModal}
                    disabled={isCreating}
                    className="rounded-2xl bg-gray-100 px-5 py-2.5 text-sm font-black text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                    {mc.cancel}
                </button>
                <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={isCreating}
                    className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-60"
                >
                    {isCreating
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> {mc.creating}</>
                        : mc.create}
                </button>
            </div>
        </div>
    </div>
)}
```

- [ ] **Step 6: TypeScript check**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep -E "admin/tenants|admin\.ts" | head -20
```

Expected: No errors in the modified files.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/dashboard/admin/tenants/page.tsx
git commit -m "feat(admin): add create tenant modal to admin tenants page"
```
