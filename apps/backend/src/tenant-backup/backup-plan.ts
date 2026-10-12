import { Prisma } from '@prisma/client';

/**
 * Which tables a tenant backup holds, how to find a tenant's rows in each, and
 * the order they can be written back in — all derived from the Prisma schema
 * rather than listed by hand, so a table added next month is in the next backup
 * without anyone remembering to add it here.
 *
 * A table is in the backup when it carries the tenant's id (a `tenant` relation
 * or a bare `tenant_id` / `tenantId` column), or when it hangs off such a table
 * through a required relation (a `SaleItem` belongs to whichever tenant owns its
 * `Sale`). `PLATFORM_OWNED_MODELS` are the exceptions: rows that carry a tenant
 * id but record the platform's dealings with that tenant, which a restore must
 * never roll back.
 */

type DmmfModel = Prisma.DMMF.Model;
type DmmfField = Prisma.DMMF.Field;

/**
 * Tenant-stamped tables the platform owns. Billing, credits and add-ons are
 * money the platform charged or granted; the audit log, terms acceptances and
 * support threads are the platform's record of what happened. A restore puts
 * the workspace back as it was, not the bill — and a restore that rewound the
 * audit log would erase its own trail.
 */
export const PLATFORM_OWNED_MODELS: ReadonlySet<string> = new Set([
    'TenantSubscription',
    'TenantAddonSubscription',
    'BillingEvent',
    'ActivationRequest',
    'SmsTransaction',
    'AiUsageLog',
    'AuditLog',
    // Before/after snapshots of the workspace's records — a restore that
    // rewound them would erase the evidence of what it replaced.
    'RecordHistory',
    'TermsAcceptance',
    'DemoDataBatch',
    'Feedback',
    'SupportThread',
    'ReferralSignup',
    'ShortLink',
    'ShortLinkClick',
]);

/**
 * Columns on the `Tenant` row a restore leaves alone: its identity, its owner,
 * and the switches only the platform sets (suspension, deletion, feature
 * overrides, purchased credits).
 */
export const TENANT_COLUMNS_NOT_RESTORED: ReadonlySet<string> = new Set([
    'id',
    'owner_id',
    'created_at',
    'deleted_at',
    'billing_suspended_at',
    'billing_suspension_reason',
    'platform_workspace_key',
    'feature_overrides',
    'sms_credits',
    'ai_credits_bonus',
]);

const TENANT_SCALAR = /^tenant_?[iI]d$/;

export interface ForeignKey {
    /** The scalar column holding the referenced id. */
    field: string;
    target: string;
    required: boolean;
    /** The target is another table in the backup (else a platform-wide one, e.g. `User`). */
    internal: boolean;
    /**
     * Written as null on insert and filled in once every table is in, because
     * the reference closes a cycle (a self-reference, or two tables pointing at
     * each other). Only ever an optional reference.
     */
    deferred: boolean;
}

export interface TablePlan {
    model: string;
    /** The Prisma client property, e.g. `crmActivity`. */
    delegate: string;
    dbName: string;
    /** Scalar and enum columns, by name, with their Prisma type. */
    columns: { name: string; dbName: string; type: string; kind: string; required: boolean; isList: boolean }[];
    hasId: boolean;
    /** The column holding the tenant's id, for a table stamped with it directly. */
    tenantColumn: string | null;
    foreignKeys: ForeignKey[];
    /** `where` for this tenant's rows. */
    scope: (tenantId: string) => Record<string, unknown>;
}

export interface BackupPlan {
    /** Parents before children: the order to insert in; reversed, the order to delete in. */
    tables: TablePlan[];
    /** Scalar columns of `Tenant` a restore writes back. */
    tenantColumns: string[];
}

function delegateName(model: string): string {
    return model.charAt(0).toLowerCase() + model.slice(1);
}

/** A relation this model owns (holds the foreign key for). */
function ownedRelations(model: DmmfModel): DmmfField[] {
    return model.fields.filter((f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0);
}

export function buildBackupPlan(models: readonly DmmfModel[] = Prisma.dmmf.datamodel.models): BackupPlan {
    const byName = new Map(models.map((m) => [m.name, m]));
    const scopes = new Map<string, (tenantId: string) => Record<string, unknown>>();
    const tenantColumns = new Map<string, string>();

    // Tables stamped with the tenant directly.
    for (const m of models) {
        if (m.name === 'Tenant' || PLATFORM_OWNED_MODELS.has(m.name)) continue;
        const rel = ownedRelations(m).find((f) => f.type === 'Tenant');
        const column = rel?.relationFromFields?.[0]
            ?? m.fields.find((f) => f.kind === 'scalar' && TENANT_SCALAR.test(f.name))?.name;
        if (!column) continue;
        scopes.set(m.name, (tenantId) => ({ [column]: tenantId }));
        tenantColumns.set(m.name, column);
    }

    // Tables owned through a required parent, to a fixed point (a child of a child).
    let grew = true;
    while (grew) {
        grew = false;
        for (const m of models) {
            if (scopes.has(m.name) || m.name === 'Tenant' || PLATFORM_OWNED_MODELS.has(m.name)) continue;
            const parent = ownedRelations(m).find((f) => f.isRequired && scopes.has(f.type));
            if (!parent) continue;
            const parentScope = scopes.get(parent.type)!;
            scopes.set(m.name, (tenantId) => ({ [parent.name]: parentScope(tenantId) }));
            grew = true;
        }
    }

    const names = [...scopes.keys()];
    const edges = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
    for (const n of names) {
        for (const rel of ownedRelations(byName.get(n)!)) {
            if (scopes.has(rel.type)) edges.get(n)!.add(rel.type);
        }
    }

    // A reference inside a strongly connected component (a self-reference
    // included) cannot be satisfied by ordering tables, so it is deferred.
    const component = stronglyConnectedComponents(names, edges);

    const tables = new Map<string, TablePlan>();
    for (const n of names) {
        const m = byName.get(n)!;
        const foreignKeys: ForeignKey[] = ownedRelations(m).map((rel) => {
            if (rel.relationFromFields!.length !== 1 || (rel.relationToFields?.[0] ?? 'id') !== 'id') {
                throw new Error(`Backup plan: ${n}.${rel.name} is not a single-column reference to an id.`);
            }
            const internal = scopes.has(rel.type);
            const deferred = internal && component.get(rel.type) === component.get(n);
            if (deferred && rel.isRequired) {
                throw new Error(`Backup plan: required reference ${n}.${rel.name} closes a cycle; no insert order exists.`);
            }
            return { field: rel.relationFromFields![0], target: rel.type, required: rel.isRequired, internal, deferred };
        });
        tables.set(n, {
            model: n,
            delegate: delegateName(n),
            dbName: m.dbName ?? n,
            columns: m.fields
                .filter((f) => f.kind === 'scalar' || f.kind === 'enum')
                .map((f) => ({ name: f.name, dbName: f.dbName ?? f.name, type: f.type, kind: f.kind, required: f.isRequired, isList: f.isList })),
            hasId: m.fields.some((f) => f.name === 'id' && f.isId),
            tenantColumn: tenantColumns.get(n) ?? null,
            foreignKeys,
            scope: scopes.get(n)!,
        });
    }

    // Kahn's algorithm over the non-deferred references; alphabetical among
    // ready tables so the order (and so a backup file) is stable.
    const pending = new Map(names.map((n) => [
        n,
        new Set(tables.get(n)!.foreignKeys.filter((fk) => fk.internal && !fk.deferred).map((fk) => fk.target)),
    ]));
    const ordered: TablePlan[] = [];
    while (pending.size) {
        const ready = [...pending.entries()].filter(([, deps]) => deps.size === 0).map(([n]) => n).sort();
        if (!ready.length) throw new Error(`Backup plan: no insert order for ${[...pending.keys()].join(', ')}.`);
        for (const n of ready) {
            ordered.push(tables.get(n)!);
            pending.delete(n);
        }
        for (const deps of pending.values()) ready.forEach((n) => deps.delete(n));
    }

    const tenantModel = byName.get('Tenant');
    const restoredTenantColumns = (tenantModel?.fields ?? [])
        .filter((f) => (f.kind === 'scalar' || f.kind === 'enum') && !TENANT_COLUMNS_NOT_RESTORED.has(f.name))
        .map((f) => f.name);

    return { tables: ordered, tenantColumns: restoredTenantColumns };
}

/** Tarjan's algorithm; returns each node's component index. */
function stronglyConnectedComponents(nodes: string[], edges: Map<string, Set<string>>): Map<string, number> {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const component = new Map<string, number>();
    let next = 0;
    let componentCount = 0;

    const visit = (v: string) => {
        index.set(v, next);
        low.set(v, next);
        next++;
        stack.push(v);
        onStack.add(v);
        for (const w of edges.get(v) ?? []) {
            if (!index.has(w)) {
                visit(w);
                low.set(v, Math.min(low.get(v)!, low.get(w)!));
            } else if (onStack.has(w)) {
                low.set(v, Math.min(low.get(v)!, index.get(w)!));
            }
        }
        if (low.get(v) === index.get(v)) {
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                component.set(w, componentCount);
            } while (w !== v);
            componentCount++;
        }
    };

    for (const n of nodes) if (!index.has(n)) visit(n);
    return component;
}
