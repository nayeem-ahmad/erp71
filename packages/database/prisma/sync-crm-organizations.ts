/**
 * Inserts `Organization` rows and fills null `CrmContact.organization_id`.
 *
 * Why this exists
 * ---------------
 * `company` stays a free-text string. The organization is the company row:
 * one per tenant plus `name_norm` (trim, lowercase, internal whitespace
 * collapsed). Display `name` keeps the oldest contact's trimmed spelling.
 * Production never runs the migration that would insert these, so this script
 * does, on every prepare.
 *
 * It inserts or fills null columns only. A contact that already has
 * `organization_id` is left alone, an existing `name_norm` is not inserted
 * again, and the link payload is `{ organization_id }` — never `company`.
 *
 * Rows are read oldest-`created_at`-then-`id`, in pages, then planned as one
 * set so the oldest spelling wins even when the two contacts are pages apart.
 *
 * Usage:
 *   npx tsx prisma/sync-crm-organizations.ts --dry-run
 *   npx tsx prisma/sync-crm-organizations.ts --tenant=<uuid>
 *   npx tsx prisma/sync-crm-organizations.ts
 */

import { PrismaClient } from '@prisma/client';
import {
    planOrganizations,
    type ExistingOrganization,
    type OrganizationContactRow,
} from './crm-identity-plan';

const prisma = new PrismaClient();

const PAGE_SIZE = 2000;

function scriptOptions(argv: string[]) {
    const dryRun = argv.includes('--dry-run');
    const tenantId = argv.find((arg) => arg.startsWith('--tenant='))?.split('=')[1];
    const where = tenantId ? { tenant_id: tenantId } : {};
    return { dryRun, where };
}

async function loadPages<T extends { id: string }>(
    load: (cursor: string | undefined) => Promise<T[]>,
): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (;;) {
        const page = await load(cursor);
        if (page.length === 0) break;
        rows.push(...page);
        cursor = page[page.length - 1].id;
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
}

function orgKey(tenantId: string, nameNorm: string): string {
    return `${tenantId}\0${nameNorm}`;
}

async function main() {
    const { dryRun, where } = scriptOptions(process.argv.slice(2));

    const contacts = await loadPages<OrganizationContactRow>((cursor) =>
        prisma.crmContact.findMany({
            where,
            select: {
                id: true,
                tenant_id: true,
                company: true,
                organization_id: true,
                created_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        }),
    );
    const existing = await loadPages<ExistingOrganization>((cursor) =>
        prisma.organization.findMany({
            where,
            select: { id: true, tenant_id: true, name_norm: true },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: PAGE_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        }),
    );

    const { inserts, links } = planOrganizations(contacts, existing);
    const tenantByContact = new Map(contacts.map((contact) => [contact.id, contact.tenant_id]));
    const idByOrg = new Map(existing.map((org) => [orgKey(org.tenant_id, org.name_norm), org.id]));

    if (!dryRun) {
        for (const insert of inserts) {
            const created = await prisma.organization.create({
                data: {
                    tenant_id: insert.tenant_id,
                    name: insert.name,
                    name_norm: insert.name_norm,
                },
                select: { id: true },
            });
            idByOrg.set(orgKey(insert.tenant_id, insert.name_norm), created.id);
        }
    } else {
        // So a link whose organization is only planned still resolves. Never written.
        for (const insert of inserts) {
            idByOrg.set(
                orgKey(insert.tenant_id, insert.name_norm),
                `dry-run:${insert.tenant_id}:${insert.name_norm}`,
            );
        }
    }

    for (const link of links) {
        const tenantId = tenantByContact.get(link.contactId);
        if (!tenantId) {
            throw new Error(`sync-crm-organizations: contact ${link.contactId} was not loaded`);
        }
        const organizationId = idByOrg.get(orgKey(tenantId, link.name_norm));
        if (!organizationId) {
            throw new Error(`sync-crm-organizations: no organization for contact ${link.contactId}`);
        }
        if (!dryRun) {
            await prisma.crmContact.update({
                where: { id: link.contactId },
                data: { organization_id: organizationId },
            });
        }
    }

    const prefix = dryRun ? '[dry run] ' : '';
    console.log(
        `${prefix}sync-crm-organizations: scanned ${contacts.length} contact(s) ` +
            `and ${existing.length} organization(s), ` +
            `planned ${inserts.length} organization insert(s), ` +
            `planned ${links.length} organization link(s).`,
    );
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error('sync-crm-organizations failed:', error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
