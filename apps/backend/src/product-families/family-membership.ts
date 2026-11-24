import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validateVariantFamily } from '@erp71/shared-types';

/**
 * Putting one product into a variant family, or taking it out — the product
 * form's "Variant" section and the products list's "Set variant group". Plain
 * functions over a transaction rather than a service, so `ProductsService` can
 * run them inside the same transaction as the product save without the two
 * modules depending on each other.
 */

export type VariantAssignment = {
    /** Join this family. */
    familyId?: string;
    /** Or start a new family with this name, on `optionNames`. */
    newFamilyName?: string;
    optionNames?: string[];
    /** The product's own values on the family's options: `{ Size: 'M' }`. */
    optionValues: Record<string, string>;
};

function check(optionNames: readonly string[], members: { productId: string; optionValues: Record<string, unknown> }[]) {
    const result = validateVariantFamily(optionNames, members as never);
    // `in`, not `!result.ok`: the backend compiles without strictNullChecks.
    if ('error' in result) throw new BadRequestException(result.error);
    return result;
}

/**
 * Makes `productId` a variant: of `familyId` (checked against the sizes it
 * already has), or of a new family. A product already in another family moves;
 * a family it leaves empty is removed. Returns the family's id.
 */
export async function assignProductToFamily(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    assignment: VariantAssignment,
): Promise<string> {
    const product = await tx.product.findFirst({
        where: { id: productId, tenant_id: tenantId, deleted_at: null },
        select: { id: true, name: true, type: true, image_url: true, family_id: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.type === 'SERVICE') {
        throw new BadRequestException('Variants are for goods; a service has no sizes to stock.');
    }

    let familyId: string;
    let optionValues: Record<string, string>;
    if (assignment.familyId) {
        const family = await tx.productFamily.findFirst({
            where: { id: assignment.familyId, tenant_id: tenantId },
            include: { products: { where: { deleted_at: null, id: { not: productId } }, select: { id: true, option_values: true } } },
        });
        if (!family) throw new NotFoundException('Variant group not found');
        const validated = check(family.option_names, [
            ...family.products.map((p) => ({ productId: p.id, optionValues: (p.option_values ?? {}) as Record<string, unknown> })),
            { productId, optionValues: assignment.optionValues },
        ]);
        familyId = family.id;
        optionValues = validated.members[validated.members.length - 1].optionValues;
    } else {
        const name = (assignment.newFamilyName ?? '').trim();
        if (!name) throw new BadRequestException('Give the variant group a name.');
        const validated = check(assignment.optionNames ?? [], [{ productId, optionValues: assignment.optionValues }]);
        const family = await tx.productFamily.create({
            data: { tenant_id: tenantId, name, image_url: product.image_url, option_names: validated.optionNames },
        });
        familyId = family.id;
        optionValues = validated.members[0].optionValues;
    }

    const previous = product.family_id;
    const { count } = await tx.product.updateMany({
        where: {
            id: productId,
            tenant_id: tenantId,
            deleted_at: null,
            // Still where it was when read: a concurrent grouping of this
            // product rolls this one back rather than being overwritten.
            family_id: previous,
        },
        data: { family_id: familyId, option_values: optionValues },
    });
    if (count !== 1) throw new BadRequestException('The product changed while grouping. Reload and try again.');

    if (previous && previous !== familyId) await deleteIfEmpty(tx, tenantId, previous);
    return familyId;
}

/** Takes `productId` out of its family, if it has one; a family left empty is removed. */
export async function removeProductFromFamily(tx: Prisma.TransactionClient, tenantId: string, productId: string) {
    const product = await tx.product.findFirst({
        where: { id: productId, tenant_id: tenantId },
        select: { family_id: true },
    });
    if (!product?.family_id) return;
    await tx.product.update({
        where: { id: productId },
        data: { family_id: null, option_values: Prisma.DbNull },
    });
    await deleteIfEmpty(tx, tenantId, product.family_id);
}

/** A family with no products left shows nothing anywhere, so it goes. */
async function deleteIfEmpty(tx: Prisma.TransactionClient, tenantId: string, familyId: string) {
    const remaining = await tx.product.count({ where: { tenant_id: tenantId, family_id: familyId, deleted_at: null } });
    if (remaining > 0) return;
    await tx.product.updateMany({
        where: { tenant_id: tenantId, family_id: familyId },
        data: { family_id: null, option_values: Prisma.DbNull },
    });
    await tx.productFamily.deleteMany({ where: { id: familyId, tenant_id: tenantId } });
}
