import * as fs from 'fs';
import * as path from 'path';

interface ProductEntry {
  sku: string;
  name: string;
  purchasePrice: number;
  brand: string | null;
}

interface SubgroupEntry {
  name: string;
  products: ProductEntry[];
}

interface GroupEntry {
  name: string;
  subgroups: SubgroupEntry[];
}

interface TemplateData {
  businessType: string;
  groups: GroupEntry[];
}

export async function seedBusinessTypeTemplate(
  prisma: any,
  tenantId: string,
  businessType: string,
): Promise<void> {
  const templatePath = path.join(
    __dirname,
    `${businessType.toLowerCase().replace(/_/g, '-')}.json`,
  );

  if (!fs.existsSync(templatePath)) {
    console.log(`No product template found for business type: ${businessType}`);
    return;
  }

  const template: TemplateData = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));

  // Collect unique brand names
  const brandNames = new Set<string>();
  for (const group of template.groups) {
    for (const subgroup of group.subgroups) {
      for (const product of subgroup.products) {
        if (product.brand) brandNames.add(product.brand);
      }
    }
  }

  // Upsert brands
  const brandMap = new Map<string, string>();
  for (const brandName of brandNames) {
    const brand = await prisma.brand.upsert({
      where: { tenant_id_name: { tenant_id: tenantId, name: brandName } },
      create: { tenant_id: tenantId, name: brandName },
      update: {},
    });
    brandMap.set(brandName, brand.id);
  }

  // Create groups → subgroups → products
  for (const groupData of template.groups) {
    const group = await prisma.productGroup.upsert({
      where: { tenant_id_name: { tenant_id: tenantId, name: groupData.name } },
      create: { tenant_id: tenantId, name: groupData.name },
      update: {},
    });

    for (const subgroupData of groupData.subgroups) {
      const subgroup = await prisma.productSubgroup.upsert({
        where: { group_id_name: { group_id: group.id, name: subgroupData.name } },
        create: { tenant_id: tenantId, group_id: group.id, name: subgroupData.name },
        update: {},
      });

      // Skip SKUs already present for this tenant
      const skus = subgroupData.products.map((p) => p.sku);
      const existing = await prisma.product.findMany({
        where: { tenant_id: tenantId, sku: { in: skus } },
        select: { sku: true },
      });
      const existingSkus = new Set(existing.map((p: { sku: string }) => p.sku));

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

      if (toCreate.length > 0) {
        await prisma.product.createMany({ data: toCreate, skipDuplicates: true });
      }
    }
  }

  const total = template.groups.reduce(
    (acc, g) => acc + g.subgroups.reduce((a, sg) => a + sg.products.length, 0),
    0,
  );
  console.log(
    `Seeded ${businessType} template for tenant ${tenantId}: ${total} products across ${template.groups.length} groups`,
  );
}
