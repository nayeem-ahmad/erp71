import { Prisma } from '@prisma/client';
import {
    StorePermission,
    TenantRecordScope,
    mergeAddonFeatures,
    normalizePlanFeatures,
} from '@erp71/shared-types';
import { AuthService } from './auth.service';
import { AuthCacheService } from '../database/auth-cache.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';

/**
 * `GET /auth/me`, characterized.
 *
 * The app shell reads every field of this response — the workspace list, each
 * workspace's plan and entitlements, permissions, branches, the referee and
 * employee identities — so a change to how it is *loaded* must not change one
 * byte of what it *returns*. These cases pin the whole response with
 * `toStrictEqual` against a database fake that behaves like Prisma where it
 * matters here:
 *
 * - Rows hold every column, as the tables do, and `select`/`include` shape them
 *   the way the client does. A `select` that forgets a field the mapping reads
 *   changes the output and fails here — which a mock that ignores its
 *   arguments could never catch.
 * - Each relation level in a `select`/`include` is counted as its own
 *   statement, because that is what Prisma issues without the `relationJoins`
 *   preview feature, so the cost of the endpoint is measured here too.
 */

/** Keys that are relations rather than columns (Json columns are not in it). */
const RELATIONS = new Set([
    'tenantMembers',
    'tenant',
    'subscription',
    'plan',
    'tenantRole',
    'roles',
    'storeAccess',
    'store',
    'storePermissions',
    'addon',
]);

const isPlainObject = (value: unknown): value is Record<string, any> =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !Prisma.Decimal.isDecimal(value);

/** The subset of Prisma's `where` these queries use. */
function matches(row: any, where: any): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
        if (key === 'OR') return (condition as any[]).some((branch) => matches(row, branch));
        const value = row?.[key];
        if (RELATIONS.has(key) && isPlainObject(condition)) return matches(value, condition);
        if (isPlainObject(condition)) {
            if ('in' in condition) return (condition.in as unknown[]).includes(value);
            if ('not' in condition) return value !== condition.not;
            if ('gt' in condition) return value > condition.gt;
            throw new Error(`fake db: unsupported condition on ${key}: ${JSON.stringify(condition)}`);
        }
        return condition === null ? value === null || value === undefined : value === condition;
    });
}

/** What Prisma returns for `row` under `args`: columns, plus the relations asked for. */
function shape(row: any, args: any): any {
    if (row === null || row === undefined) return null;
    if (Array.isArray(row)) return row.filter((item) => matches(item, args?.where)).map((item) => shape(item, args));

    const out: Record<string, unknown> = {};
    if (!args?.select) {
        for (const [key, value] of Object.entries(row)) if (!RELATIONS.has(key)) out[key] = value;
    }
    for (const [key, spec] of Object.entries(args?.select ?? args?.include ?? {})) {
        if (!spec) continue;
        if (RELATIONS.has(key)) out[key] = shape(row[key], spec === true ? {} : spec);
        else out[key] = row[key];
    }
    return out;
}

/** Statements Prisma issues for `args`: one, plus one per relation level loaded. */
function statementsFor(args: any): number {
    let total = 1;
    for (const [key, spec] of Object.entries(args?.select ?? args?.include ?? {})) {
        if (spec && RELATIONS.has(key)) total += statementsFor(spec === true ? {} : spec);
    }
    return total;
}

type Logged = { model: string; op: string; statements: number; args: any };

function table(model: string, rows: any[], log: Logged[]) {
    const record = (op: string, args: any, statements = statementsFor(args)) =>
        log.push({ model, op, statements, args });
    const found = (args: any) => rows.filter((row) => matches(row, args?.where));
    return {
        findUnique: async (args: any) => {
            record('findUnique', args);
            return shape(found(args)[0] ?? null, args);
        },
        findFirst: async (args: any) => {
            record('findFirst', args);
            return shape(found(args)[0] ?? null, args);
        },
        findMany: async (args: any) => {
            record('findMany', args);
            const hits = found(args);
            return (args?.take ? hits.slice(0, args.take) : hits).map((row) => shape(row, args));
        },
        update: async (args: any) => {
            record('update', args, 1);
            const row = found(args)[0];
            Object.assign(row, args.data);
            return shape(row, {});
        },
    };
}

// --- The data -----------------------------------------------------------------

const NOW = Date.now();
const day = (offset: number) => new Date(NOW + offset * 86_400_000);
const d = (value: string) => new Prisma.Decimal(value);

const PLATFORM_FEATURES = {
    feedback: true,
    support: true,
    help: false,
    voice: false,
    manufacturing: false,
    aiChat: false,
    externalImport: false,
    projects: false,
    platformProjects: true,
    platformAccounting: false,
};

/** Columns every tenant row has that the response must never carry. */
const tenantNoise = {
    storefront_enabled: true,
    storefront_banner: null,
    brand_primary_color: '#123456',
    default_vat_rate: d('15.00'),
    mushak_enabled: false,
    business_type: 'electronics',
    billing_suspended_at: null,
    billing_suspension_reason: null,
    loyalty_points_enabled: false,
    sms_enabled: true,
    sms_credits: 120,
    ai_credits_bonus: 0,
    report_email: 'reports@example.com',
    created_at: day(-400),
};

const STANDARD_PLAN = {
    id: 'plan-standard',
    code: 'STANDARD',
    name: 'Standard',
    description: 'For a growing shop',
    monthly_price: d('1499.00'),
    yearly_price: d('14990.00'),
    setup_fee: d('0.00'),
    features_json: { maxUsers: 5, maxStores: 2, premiumAccounting: true },
    marketing_features_json: ['Five users'],
    is_active: true,
};

const BASIC_PLAN = {
    id: 'plan-basic',
    code: 'BASIC',
    name: 'Basic',
    description: null,
    monthly_price: d('999.00'),
    yearly_price: null,
    setup_fee: d('500.00'),
    features_json: null,
    marketing_features_json: [],
    is_active: true,
};

const subscriptionOf = (tenantId: string, plan: any, overrides: Record<string, unknown> = {}) => ({
    id: `sub-${tenantId}`,
    tenant_id: tenantId,
    plan_id: plan.id,
    status: 'ACTIVE',
    billing_cycle: 'MONTHLY',
    current_period_start: day(-10),
    current_period_end: day(20),
    cancel_at_period_end: false,
    past_due_since: null,
    last_reminder_at: null,
    provider_name: 'manual',
    provider_customer_ref: null,
    provider_subscription_ref: 'ref-1',
    discount_type: null,
    discount_value: null,
    activated_at: day(-300),
    setup_fee_paid_at: day(-300),
    plan,
    ...overrides,
});

const tenantRow = (id: string, overrides: Record<string, unknown>): any => ({
    id,
    name: `Shop ${id}`,
    owner_id: 'someone',
    default_locale: 'en',
    timezone: 'Asia/Dhaka',
    localization_enabled: false,
    secondary_locale: null,
    storefront_slug: null,
    dashboard_preference: 'AUTO',
    onboarding_dismissed_at: null,
    deleted_at: null,
    platform_workspace_key: null,
    feature_overrides: {},
    subscription: null,
    ...tenantNoise,
    ...overrides,
});

const roleRow = (id: string, name: string, record_scope: TenantRecordScope) => ({
    id,
    tenant_id: 'any',
    name,
    description: `${name} role`,
    is_system: true,
    template_key: null,
    record_scope,
    created_at: day(-100),
    updated_at: day(-50),
});

const storeRow = (id: string, tenantId: string, name: string) => ({
    id,
    tenant_id: tenantId,
    name,
    address: `${name} Road`,
    latitude: 23.78,
    longitude: 90.4,
    created_at: day(-200),
});

/** Karim owns one shop, works the till at another, and left a third (since deleted). */
function karim() {
    const shop1 = tenantRow('tenant-1', {
        name: 'Karim Electronics',
        owner_id: 'user-1',
        default_locale: 'bn',
        localization_enabled: true,
        secondary_locale: 'bn',
        storefront_slug: 'karim',
        dashboard_preference: 'SALES',
        onboarding_dismissed_at: day(-30),
        // `help` is turned off for this shop, `manufacturing` on; the junk key
        // is ignored by the override parser.
        feature_overrides: { manufacturing: true, help: false, bogus: 'x' },
    });
    shop1.subscription = subscriptionOf('tenant-1', STANDARD_PLAN) as any;

    // Rahim has three branches; Karim works the till at one of them, so the
    // branch filter shows locked rather than hidden.
    const shop2 = tenantRow('tenant-2', { name: 'Rahim Traders', timezone: 'Asia/Kolkata', _count: { stores: 3 } });
    // Never paid for: no active status and no activation stamp.
    shop2.subscription = subscriptionOf('tenant-2', BASIC_PLAN, {
        status: 'PAST_DUE',
        activated_at: null,
        cancel_at_period_end: true,
    }) as any;

    const gone = tenantRow('tenant-3', { name: 'Closed Shop', deleted_at: day(-5) });
    const platform = tenantRow('platform-ws', { name: 'ERP71 Platform', platform_workspace_key: 'platform' });

    const membership = (tenant: any, role: string, tenantRole: any, roles: any[]) => ({
        id: `tu-${tenant.id}`,
        tenant_id: tenant.id,
        user_id: 'user-1',
        role,
        tenant_role_id: tenantRole?.id ?? null,
        invoice_print_prefs: { paper: 'A4' },
        tenant,
        tenantRole,
        roles: roles.map((role, i) => ({ id: `tur-${tenant.id}-${i}`, assigned_at: day(-20), tenantRole: role })),
    });

    const salesUser = roleRow('role-sales', 'Sales User', TenantRecordScope.OWN);
    const projectUser = roleRow('role-projects', 'Project User', TenantRecordScope.OWN);

    return {
        id: 'user-1',
        email: 'karim@example.com',
        passwordHash: '$2b$10$hash',
        google_id: 'google-1',
        name: 'Karim',
        preferred_locale: 'bn',
        token_version: 3,
        storefront_token_version: 1,
        applicant_token_version: 0,
        is_platform_admin: false,
        must_change_password: false,
        blog_last_seen_at: day(-2),
        firebase_uid: null,
        mobile_country_code: 'BD',
        mobile: '+8801700000001',
        mobile_verified_at: day(-90),
        email_verified_at: day(-365),
        avatar_url: 'https://cdn.example.com/karim.png',
        totp_secret: 'JBSWY3DPEHPK3PXP',
        created_at: day(-365),
        updated_at: day(-1),
        tenantMembers: [
            membership(shop1, 'OWNER', null, []),
            membership(shop2, 'CASHIER', roleRow('role-cashier', 'Cashier', TenantRecordScope.ALL), [salesUser]),
            membership(gone, 'MANAGER', null, []),
            membership(platform, 'CASHIER', projectUser, [projectUser]),
        ],
        storeAccess: [
            { id: 'usa-1', user_id: 'user-1', store_id: 'store-1', tenant_id: 'tenant-1', access_level: 'MULTI_STORE_CAPABLE', created_at: day(-300), store: storeRow('store-1', 'tenant-1', 'Gulshan') },
            { id: 'usa-2', user_id: 'user-1', store_id: 'store-2', tenant_id: 'tenant-2', access_level: 'STORE_ONLY', created_at: day(-60), store: storeRow('store-2', 'tenant-2', 'Banani') },
            { id: 'usa-3', user_id: 'user-1', store_id: 'store-3', tenant_id: 'tenant-3', access_level: 'STORE_ONLY', created_at: day(-60), store: storeRow('store-3', 'tenant-3', 'Old') },
        ],
        storePermissions: [
            { id: 'p1', user_id: 'user-1', tenant_id: 'tenant-2', store_id: 'store-2', permission: StorePermission.CREATE_SALE, granted_by: 'x', granted_at: day(-60) },
            { id: 'p2', user_id: 'user-1', tenant_id: 'tenant-2', store_id: 'store-2', permission: StorePermission.VIEW_LEDGER, granted_by: 'x', granted_at: day(-60) },
            // A branch they no longer have access to: must not count.
            { id: 'p3', user_id: 'user-1', tenant_id: 'tenant-2', store_id: 'store-9', permission: StorePermission.EDIT_PRODUCTS, granted_by: 'x', granted_at: day(-60) },
        ],
    };
}

const addonRow = (id: string, features_json: Record<string, unknown>) => ({
    id,
    code: id.toUpperCase(),
    name: id,
    description: null,
    category: null,
    monthly_price: d('300.00'),
    yearly_price: null,
    features_json,
    is_active: true,
    sort_order: 0,
});

const addonSubscriptions = () => [
    // Live: counts.
    { id: 'as-1', tenant_id: 'tenant-1', addon_id: 'extra-users', status: 'ACTIVE', current_period_start: day(-5), current_period_end: day(25), cancel_at_period_end: false, addon: addonRow('extra-users', { maxUsers: 15 }) },
    // Lapsed, and cancelled: neither counts.
    { id: 'as-2', tenant_id: 'tenant-1', addon_id: 'api', status: 'ACTIVE', current_period_start: day(-40), current_period_end: day(-10), cancel_at_period_end: false, addon: addonRow('api', { apiAccess: true }) },
    { id: 'as-3', tenant_id: 'tenant-1', addon_id: 'chat', status: 'CANCELLED', current_period_start: day(-5), current_period_end: day(25), cancel_at_period_end: false, addon: addonRow('chat', { teamChat: true }) },
];

const refereeRow = (overrides: Record<string, unknown>) => ({
    id: 'referee-1',
    user_id: 'user-1',
    name: 'Karim Partner',
    email: 'karim@example.com',
    phone: '+8801700000009',
    referral_code: 'KARIM1',
    commission_rate: d('10.00'),
    signup_discount: d('5.00'),
    is_active: true,
    notes: 'met at a fair',
    created_by: 'admin-1',
    created_at: day(-100),
    updated_at: day(-10),
    deleted_at: null,
    ...overrides,
});

const employeeRow = {
    id: 'emp-1',
    tenant_id: 'tenant-2',
    employee_code: 'EMP-00007',
    name: 'Karim',
    phone: '01700000001',
    email: null,
    user_id: 'user-1',
    portal_access: true,
    status: 'ACTIVE',
    deleted_at: null,
    basic_salary: d('25000.00'),
};

function harness(data: { users: any[]; referees?: any[]; employees?: any[]; addons?: any[] }) {
    const log: Logged[] = [];
    const subscriptions = data.users.flatMap((user) =>
        user.tenantMembers.map((m: any) => m.tenant.subscription).filter(Boolean),
    );
    const db: any = {
        user: table('user', data.users, log),
        referee: table('referee', data.referees ?? [], log),
        employee: table('employee', data.employees ?? [], log),
        tenantSubscription: table('tenantSubscription', subscriptions, log),
        tenantAddonSubscription: table('tenantAddonSubscription', data.addons ?? [], log),
    };
    const platformSettings = { getPlatformFeatures: jest.fn(async () => ({ ...PLATFORM_FEATURES })) };
    const referrals = new ReferralsService(db, {} as any, {} as any, {} as any, {} as any, {} as any);
    const service = new AuthService(
        db,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        platformSettings as any,
        referrals,
        new PlanEntitlementsService(db),
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        new AuthCacheService({ ttlMs: 0 }),
    );
    return { service, log, db };
}

// --- The response ---------------------------------------------------------------

const ALL_PERMISSIONS = Object.values(StorePermission);

const standardFeatures = mergeAddonFeatures(
    normalizePlanFeatures(STANDARD_PLAN.features_json, 'STANDARD'),
    [{ maxUsers: 15 }],
);
const basicFeatures = normalizePlanFeatures(null, 'BASIC');

function expectedKarim() {
    const user = karim();
    const [shop1, shop2, , platform] = user.tenantMembers.map((m) => m.tenant);
    return {
        id: 'user-1',
        email: 'karim@example.com',
        name: 'Karim',
        preferred_locale: 'bn',
        is_platform_admin: false,
        is_demo: false,
        email_verified: true,
        two_factor_enabled: true,
        has_password: true,
        must_change_password: false,
        google_connected: true,
        mobile_connected: false,
        mobile_verified: true,
        avatar_url: 'https://cdn.example.com/karim.png',
        platform_features: PLATFORM_FEATURES,
        referee: {
            id: 'referee-1',
            name: 'Karim Partner',
            email: 'karim@example.com',
            referral_code: 'KARIM1',
            signup_discount: 5,
            commission_rate: 10,
            is_active: true,
            has_login: true,
        },
        employee: { id: 'emp-1', tenant_id: 'tenant-2', employee_code: 'EMP-00007', name: 'Karim' },
        tenants: [
            {
                id: 'tenant-1',
                name: 'Karim Electronics',
                storefront_slug: 'karim',
                platform_features: { ...PLATFORM_FEATURES, manufacturing: true, help: false },
                default_locale: 'bn',
                onboarding_dismissed: true,
                localization_enabled: true,
                secondary_locale: 'bn',
                timezone: 'Asia/Dhaka',
                dashboard_preference: 'SALES',
                role: 'OWNER',
                tenant_role: null,
                record_scope: TenantRecordScope.ALL,
                permissions: ALL_PERMISSIONS,
                stores: [storeRow('store-1', 'tenant-1', 'Gulshan')],
                store_count: 1,
                pending_activation: false,
                is_platform_workspace: false,
                subscription: {
                    status: 'ACTIVE',
                    current_period_start: shop1.subscription.current_period_start,
                    current_period_end: shop1.subscription.current_period_end,
                    cancel_at_period_end: false,
                    is_premium: false,
                    is_paid_plan: true,
                    plan: {
                        code: 'STANDARD',
                        name: 'Standard',
                        description: 'For a growing shop',
                        monthly_price: 1499,
                        yearly_price: 14990,
                        features_json: standardFeatures,
                    },
                },
            },
            {
                id: 'tenant-2',
                name: 'Rahim Traders',
                storefront_slug: null,
                platform_features: PLATFORM_FEATURES,
                default_locale: 'en',
                onboarding_dismissed: false,
                localization_enabled: false,
                secondary_locale: null,
                timezone: 'Asia/Kolkata',
                dashboard_preference: 'AUTO',
                role: 'CASHIER',
                tenant_role: { id: 'role-cashier', name: 'Cashier' },
                record_scope: TenantRecordScope.OWN,
                permissions: [StorePermission.CREATE_SALE, StorePermission.VIEW_LEDGER],
                stores: [storeRow('store-2', 'tenant-2', 'Banani')],
                store_count: 3,
                pending_activation: true,
                is_platform_workspace: false,
                subscription: {
                    status: 'PAST_DUE',
                    current_period_start: shop2.subscription.current_period_start,
                    current_period_end: shop2.subscription.current_period_end,
                    cancel_at_period_end: true,
                    is_premium: false,
                    is_paid_plan: true,
                    plan: {
                        code: 'BASIC',
                        name: 'Basic',
                        description: null,
                        monthly_price: 999,
                        yearly_price: null,
                        features_json: basicFeatures,
                    },
                },
            },
            {
                id: 'platform-ws',
                name: 'ERP71 Platform',
                storefront_slug: null,
                platform_features: { ...PLATFORM_FEATURES, projects: true },
                default_locale: 'en',
                onboarding_dismissed: false,
                localization_enabled: false,
                secondary_locale: null,
                timezone: platform.timezone,
                dashboard_preference: 'AUTO',
                role: 'CASHIER',
                tenant_role: { id: 'role-projects', name: 'Project User' },
                record_scope: TenantRecordScope.OWN,
                permissions: [],
                stores: [],
                store_count: 0,
                pending_activation: false,
                is_platform_workspace: true,
                subscription: null,
            },
        ],
    };
}

describe('AuthService.getMe — the response the app shell reads', () => {
    it('returns exactly this for a member of several workspaces', async () => {
        const { service } = harness({
            users: [karim()],
            referees: [refereeRow({})],
            employees: [employeeRow],
            addons: addonSubscriptions(),
        });

        await expect(service.getMe('user-1')).resolves.toStrictEqual(expectedKarim());
    });

    it('leaves a deleted workspace out by filtering the memberships it loads', async () => {
        const { service, log } = harness({ users: [karim()] });

        await service.getMe('user-1');

        const userRead = log.find((entry) => entry.model === 'user')!;
        const relations = userRead.args.select ?? userRead.args.include;
        expect(relations.tenantMembers.where).toEqual({ tenant: { deleted_at: null } });
    });

    it('links a referee found by email and reports the login', async () => {
        const referees = [refereeRow({ user_id: null })];
        const { service } = harness({ users: [karim()], referees });

        const result = await service.getMe('user-1');

        expect(result.referee).toStrictEqual(expectedKarim().referee);
        expect(referees[0].user_id).toBe('user-1');
    });

    it('does not take a referee whose email matches but who belongs to someone else', async () => {
        const { service } = harness({ users: [karim()], referees: [refereeRow({ user_id: 'user-2' })] });

        await expect(service.getMe('user-1')).resolves.toMatchObject({ referee: null });
    });

    it('ignores an archived or deactivated referee', async () => {
        const archived = refereeRow({ deleted_at: day(-1) });
        const inactive = refereeRow({ id: 'referee-2', email: 'other@example.com', is_active: false });
        const { service } = harness({ users: [karim()], referees: [archived, inactive] });

        await expect(service.getMe('user-1')).resolves.toMatchObject({ referee: null });
    });

    it('returns exactly this for a platform admin with no shop of their own', async () => {
        const admin = {
            ...karim(),
            id: 'admin-1',
            email: 'admin@example.com',
            name: null,
            is_platform_admin: true,
            passwordHash: null,
            google_id: null,
            firebase_uid: 'fb-1',
            mobile_verified_at: null,
            email_verified_at: null,
            avatar_url: null,
            totp_secret: 'pending:ABC',
            must_change_password: true,
            storeAccess: [],
            storePermissions: [],
        };
        admin.tenantMembers = admin.tenantMembers.filter((m: any) => m.tenant.platform_workspace_key);
        const { service } = harness({ users: [admin] });

        await expect(service.getMe('admin-1')).resolves.toStrictEqual({
            id: 'admin-1',
            email: 'admin@example.com',
            name: null,
            preferred_locale: 'bn',
            is_platform_admin: true,
            is_demo: false,
            email_verified: false,
            two_factor_enabled: false,
            has_password: false,
            must_change_password: true,
            google_connected: false,
            mobile_connected: true,
            mobile_verified: false,
            avatar_url: null,
            platform_features: PLATFORM_FEATURES,
            referee: null,
            employee: null,
            // The platform workspace is reached from the admin console, not listed.
            tenants: [],
        });
    });

    /**
     * What it costs. Before the slimming this was 21 statements: the same user
     * read (11 — one per relation level, `include` or `select` alike), then the
     * referee by id, the employee, and per paid workspace the subscription and
     * plan read a second time plus the add-ons. Now the subscription is not
     * re-read and the referee lookup is one query whichever way it resolves.
     */
    it('costs 17 statements for a member of two paid workspaces', async () => {
        const { service, log } = harness({
            users: [karim()],
            referees: [refereeRow({})],
            employees: [employeeRow],
            addons: addonSubscriptions(),
        });

        await service.getMe('user-1');

        expect(log.map((entry) => [entry.model, entry.op, entry.statements])).toEqual([
            ['user', 'findUnique', 11],
            ['referee', 'findMany', 1],
            ['employee', 'findFirst', 1],
            ['tenantAddonSubscription', 'findMany', 2],
            ['tenantAddonSubscription', 'findMany', 2],
        ]);
        expect(log.reduce((sum, entry) => sum + entry.statements, 0)).toBe(17);
        // Loaded once, with the membership — never read again per workspace.
        expect(log.some((entry) => entry.model === 'tenantSubscription')).toBe(false);
    });

    it('reads no column the response does not use', async () => {
        const { service, log } = harness({ users: [karim()] });

        await service.getMe('user-1');

        const userRead = log.find((entry) => entry.model === 'user')!;
        expect(userRead.args.include).toBeUndefined();
        // The secrets it must read to report "has a password" / "has 2FA" are the
        // only sensitive columns in it; the token versions and billing references
        // the old `include` dragged along are gone.
        expect(Object.keys(userRead.args.select)).not.toContain('token_version');
        expect(Object.keys(userRead.args.select.tenantMembers.select.tenant.select)).not.toContain('sms_credits');
    });

    it('refuses an unknown user', async () => {
        const { service } = harness({ users: [] });
        await expect(service.getMe('nobody')).rejects.toThrow('User not found');
    });
});
