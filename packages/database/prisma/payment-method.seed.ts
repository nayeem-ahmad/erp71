import { nextAccountCode } from './account-code';

/**
 * Default payment methods provisioned for every new tenant.
 *
 * `type` MUST be one of the backend PaymentMethodType enum *values*
 * ('Cash' | 'Mobile Wallet' | 'Card' | 'Bank') — the sales-entry UI maps the
 * stored type to a canonical accounting string, and the API validates against
 * these same values.
 *
 * `sort_order` is the "Serial" shown in Settings → Payment Methods;
 * `show_on_entry` controls whether the method appears on the sales-entry UI
 * by default (others remain addable via the "Add method" picker).
 *
 * `link_to` is the NAME of the default chart-of-accounts account the method's
 * tenders post to (see `linkDefaultPaymentMethodAccounts`). It is not stored on
 * the method: only the resolved `account_id` is.
 */
export const DEFAULT_PAYMENT_METHODS: {
    name: string;
    type: 'Cash' | 'Mobile Wallet' | 'Card' | 'Bank';
    sort_order: number;
    link_to: string;
}[] = [
    { name: 'Cash', type: 'Cash', sort_order: 1, link_to: 'Cash in Hand' },
    { name: 'Bank', type: 'Bank', sort_order: 2, link_to: 'Main Bank Account' },
    { name: 'bKash', type: 'Mobile Wallet', sort_order: 3, link_to: 'bKash Account' },
    { name: 'Nagad', type: 'Mobile Wallet', sort_order: 4, link_to: 'Nagad Account' },
    { name: 'Card', type: 'Card', sort_order: 5, link_to: 'Main Bank Account' },
];

/**
 * Idempotent: safe to call for an existing tenant (skips names already present,
 * honouring the @@unique([tenant_id, name]) constraint).
 */
export async function seedDefaultPaymentMethods(tx: any, tenantId: string) {
    await tx.paymentMethod.createMany({
        data: DEFAULT_PAYMENT_METHODS.map((m) => ({
            tenant_id: tenantId,
            name: m.name,
            type: m.type,
            sort_order: m.sort_order,
            is_active: true,
            show_on_entry: true,
        })),
        skipDuplicates: true,
    });
}

/**
 * Points each default-named method that has no account yet at the default
 * account of the matching name, so its tenders post there.
 *
 * Reads only unlinked methods, so it never overwrites a link an owner chose,
 * and a name with no matching account (an owner renamed or deleted it) is
 * skipped rather than guessed. Idempotent. Run it after
 * `bootstrapDefaultAccountingForTenant`, which creates the accounts.
 */
export async function linkDefaultPaymentMethodAccounts(
    tx: any,
    tenantId: string,
): Promise<{ linked: string[] }> {
    const targets = new Map(DEFAULT_PAYMENT_METHODS.map((m) => [m.name, m.link_to]));

    const methods: { id: string; name: string }[] = await tx.paymentMethod.findMany({
        where: { tenant_id: tenantId, account_id: null, name: { in: [...targets.keys()] } },
        select: { id: true, name: true },
    });
    if (methods.length === 0) return { linked: [] };

    const accounts: { id: string; name: string; store_id?: string | null }[] = await tx.account.findMany({
        where: { tenant_id: tenantId, name: { in: [...new Set(targets.values())] } },
        select: { id: true, name: true, store_id: true },
    });
    // Signup creates the first store before this runs. Cash is that store's
    // drawer. A caller with no store client keeps today's shared link.
    const firstStore = tx.store
        ? await tx.store.findFirst({
            where: {
                tenant_id: tenantId,
                NOT: { name: { equals: 'Online Store', mode: 'insensitive' } },
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            select: { id: true },
        })
        : null;

    const linked: string[] = [];
    for (const method of methods) {
        const accountName = targets.get(method.name) as string;
        const preferStoreId = method.name === 'Cash' ? firstStore?.id ?? null : null;
        const accountId = accountIdForLink(accountName, accounts, preferStoreId);
        if (!accountId) continue;
        await tx.paymentMethod.update({
            where: { id: method.id },
            data: preferStoreId ? { account_id: accountId, all_branches: false } : { account_id: accountId },
        });
        if (preferStoreId) {
            await tx.paymentMethodStore.create({
                data: { tenant_id: tenantId, payment_method_id: method.id, store_id: preferStoreId },
            });
        }
        linked.push(method.name);
    }
    return { linked };
}

function accountIdForLink(
    accountName: string,
    accounts: { id: string; name: string; store_id?: string | null }[],
    preferStoreId: string | null,
): string | undefined {
    const matches = accounts.filter((account) => account.name === accountName);
    if (preferStoreId) {
        const drawer = matches.find((account) => account.store_id === preferStoreId);
        if (drawer) return drawer.id;
    }
    const shared = matches.find((account) => account.store_id == null);
    return (shared ?? matches[0])?.id;
}

/**
 * One drawer and one Cash method for a branch that does not have them yet.
 * Does not copy banks or wallets. A second branch cannot reuse the name Cash.
 */
export async function ensureBranchCashDrawer(
    client: any,
    tenantId: string,
    storeId: string,
): Promise<{ accountId: string; methodId: string }> {
    const existing = await client.account.findFirst({
        where: { tenant_id: tenantId, store_id: storeId, category: 'cash' },
        select: { id: true },
    });
    let accountId: string | undefined = existing?.id;

    if (!accountId) {
        const subgroup = await client.accountSubgroup.findFirst({
            where: { tenant_id: tenantId, code: '1101' },
            select: { id: true, code: true, group_id: true },
        });
        const group = subgroup
            ? await client.accountGroup.findFirst({
                where: { id: subgroup.group_id },
                select: { id: true, code: true },
            })
            : null;
        const codes: { code: string | null }[] = await client.account.findMany({
            where: { tenant_id: tenantId },
            select: { code: true },
        });
        const created = await client.account.create({
            data: {
                tenant_id: tenantId,
                group_id: group?.id ?? subgroup?.group_id ?? null,
                subgroup_id: subgroup?.id ?? null,
                name: 'Cash in Hand',
                code: nextAccountCode(
                    group?.code ?? '11',
                    subgroup?.code ?? '1101',
                    codes.map((row) => row.code).filter((code): code is string => Boolean(code)),
                ),
                type: 'asset',
                category: 'cash',
                store_id: storeId,
            },
        });
        accountId = created.id;
    }

    const method = await client.paymentMethod.findFirst({
        where: {
            tenant_id: tenantId,
            account_id: accountId,
            type: { equals: 'Cash', mode: 'insensitive' },
        },
        select: { id: true },
    });
    if (method) return { accountId, methodId: method.id };

    const store = await client.store.findFirst({
        where: { id: storeId, tenant_id: tenantId },
        select: { id: true, name: true, code: true },
    });
    const taken: { name: string }[] = await client.paymentMethod.findMany({
        where: { tenant_id: tenantId },
        select: { name: true },
    });
    const branch = {
        id: storeId,
        name: store?.name ?? storeId,
        code: store?.code ?? null,
    };
    const createdMethod = await client.paymentMethod.create({
        data: {
            tenant_id: tenantId,
            type: 'Cash',
            name: cashMethodName(branch, new Set(taken.map((row) => row.name))),
            account_id: accountId,
            is_active: true,
            show_on_entry: true,
            sort_order: 1,
            all_branches: false,
        },
    });
    await client.paymentMethodStore.create({
        data: { tenant_id: tenantId, payment_method_id: createdMethod.id, store_id: storeId },
    });
    return { accountId, methodId: createdMethod.id };
}

function cashMethodName(
    branch: { id: string; name: string; code: string | null },
    taken: Set<string>,
): string {
    const candidates = [
        'Cash',
        `Cash (${branch.name})`,
        branch.code ? `Cash (${branch.name} ${branch.code})` : `Cash (${branch.name} ${branch.id.slice(0, 8)})`,
    ];
    for (const candidate of candidates) {
        if (!taken.has(candidate)) return candidate;
    }
    return `Cash (${branch.name} ${branch.id})`;
}
