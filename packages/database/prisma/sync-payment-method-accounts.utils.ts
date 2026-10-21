import { linkDefaultPaymentMethodAccounts } from './payment-method.seed';

/** `platform_settings` row that records the one successful live run. */
export const MARKER_GROUP = 'sync';
export const MARKER_KEY = 'payment_method_accounts';

/** Thrown to abort the dry-run transaction. Never escapes linkTenant. */
class Rollback extends Error {}

export type SyncOptions = {
    dryRun: boolean;
    force: boolean;
    /** Restrict the run to one tenant. Such a run never writes the marker. */
    tenantId?: string;
};

export type SyncResult =
    | { skipped: true; ranAt: string }
    | { skipped: false; tenants: number; changed: { tenantId: string; linked: string[] }[]; markerWritten: boolean };

/**
 * Links `tenantId`'s unlinked default methods inside one transaction. A dry run
 * does the same work and rolls it back, so the preview cannot disagree with a
 * live run.
 */
export async function linkTenant(client: any, tenantId: string, dryRun: boolean): Promise<string[]> {
    let linked: string[] = [];

    try {
        await client.$transaction(
            async (tx: any) => {
                ({ linked } = await linkDefaultPaymentMethodAccounts(tx, tenantId));
                if (dryRun) throw new Rollback();
            },
            { timeout: 30_000 },
        );
    } catch (error) {
        if (!(error instanceof Rollback)) throw error;
    }

    return linked;
}

/**
 * One-shot per database. After the first successful whole-database live run a
 * marker is stored and later runs skip, so a link an owner cleared on purpose is
 * never put back by a later deploy. `--force` runs regardless. A dry run or a
 * single-tenant run never writes the marker; the marker is written only after
 * every tenant succeeded (an error before then leaves it unset).
 */
export async function runPaymentMethodAccountSync(client: any, options: SyncOptions): Promise<SyncResult> {
    const { dryRun, force, tenantId } = options;

    const marker = await client.platformSetting.findFirst({
        where: { group: MARKER_GROUP, key: MARKER_KEY },
        select: { value: true },
    });
    if (marker && !force) {
        return { skipped: true, ranAt: marker.value ?? '' };
    }

    const tenants: { id: string }[] = await client.tenant.findMany({
        where: tenantId ? { id: tenantId } : undefined,
        select: { id: true },
        orderBy: { created_at: 'asc' },
    });

    const changed: { tenantId: string; linked: string[] }[] = [];
    for (const tenant of tenants) {
        const linked = await linkTenant(client, tenant.id, dryRun);
        if (linked.length > 0) changed.push({ tenantId: tenant.id, linked });
    }

    let markerWritten = false;
    if (!dryRun && !tenantId) {
        const value = new Date().toISOString();
        await client.platformSetting.upsert({
            where: { group_key: { group: MARKER_GROUP, key: MARKER_KEY } },
            create: { group: MARKER_GROUP, key: MARKER_KEY, value },
            update: { value },
        });
        markerWritten = true;
    }

    return { skipped: false, tenants: tenants.length, changed, markerWritten };
}
