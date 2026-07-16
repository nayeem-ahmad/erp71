const fs = require('fs');
const path = require('path');

/**
 * Hand-written CommonJS mirror of seed-template.ts.
 * packages/database has no build step — keep the two in sync when either changes.
 * Guarded by apps/backend/test/database-exports.spec.ts.
 */
async function seedBusinessTypeTemplate(prisma, tenantId, businessType) {
    const templatePath = path.join(
        __dirname,
        `${businessType.toLowerCase().replace(/_/g, '-')}.json`,
    );

    if (!fs.existsSync(templatePath)) {
        console.log(`No product template found for business type: ${businessType}`);
        return { created: 0, skipped: 0, groups: 0, subgroups: 0, brands: 0 };
    }

    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

    // Collect unique brand names
    const brandNames = new Set();
    for (const group of template.groups) {
        for (const subgroup of group.subgroups) {
            for (const product of subgroup.products) {
                if (product.brand) brandNames.add(product.brand);
            }
        }
    }

    // Upsert brands
    const brandMap = new Map();
    for (const brandName of brandNames) {
        const brand = await prisma.brand.upsert({
            where: { tenant_id_name: { tenant_id: tenantId, name: brandName } },
            create: { tenant_id: tenantId, name: brandName },
            update: {},
        });
        brandMap.set(brandName, brand.id);
    }

    // Create groups → subgroups → products
    let created = 0;
    let skipped = 0;
    let subgroupCount = 0;

    for (const groupData of template.groups) {
        const group = await prisma.productGroup.upsert({
            where: { tenant_id_name: { tenant_id: tenantId, name: groupData.name } },
            create: { tenant_id: tenantId, name: groupData.name },
            update: {},
        });

        for (const subgroupData of groupData.subgroups) {
            subgroupCount += 1;
            const subgroup = await prisma.productSubgroup.upsert({
                where: { group_id_name: { group_id: group.id, name: subgroupData.name } },
                create: { tenant_id: tenantId, group_id: group.id, name: subgroupData.name },
                update: {},
            });

            const skus = subgroupData.products.map((p) => p.sku);
            const existing = await prisma.product.findMany({
                where: { tenant_id: tenantId, sku: { in: skus } },
                select: { sku: true },
            });
            const existingSkus = new Set(existing.map((p) => p.sku));

            const toCreate = subgroupData.products
                .filter((p) => !existingSkus.has(p.sku))
                .map((p) => ({
                    tenant_id: tenantId,
                    name: p.name,
                    sku: p.sku,
                    price: p.purchasePrice,
                    group_id: group.id,
                    subgroup_id: subgroup.id,
                    brand_id: p.brand ? (brandMap.get(p.brand) ?? null) : null,
                }));

            created += toCreate.length;
            skipped += subgroupData.products.length - toCreate.length;

            if (toCreate.length > 0) {
                await prisma.product.createMany({ data: toCreate, skipDuplicates: true });
            }
        }
    }

    console.log(
        `Seeded ${businessType} template for tenant ${tenantId}: ${created} products created, ${skipped} skipped, across ${template.groups.length} groups`,
    );

    return {
        created,
        skipped,
        groups: template.groups.length,
        subgroups: subgroupCount,
        brands: brandNames.size,
    };
}

module.exports = { seedBusinessTypeTemplate };
