import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { suggestVariantFamilies, validateVariantFamily, type ValidatedVariantMember } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../cache/redis.service';
import { CreateProductFamilyDto, UpdateProductFamilyDto } from './product-family.dto';

/** Enough to review in one sitting; the rest surface once these are dealt with. */
const MAX_SUGGESTIONS = 100;

const MEMBER_SELECT = {
    id: true,
    name: true,
    sku: true,
    price: true,
    image_url: true,
    option_values: true,
    stocks: { select: { quantity: true } },
} satisfies Prisma.ProductSelect;

type MemberRow = Prisma.ProductGetPayload<{ select: typeof MEMBER_SELECT }>;

function toMember(row: MemberRow) {
    return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        price: Number(row.price),
        image_url: row.image_url,
        option_values: (row.option_values ?? {}) as Record<string, string>,
        stock_quantity: row.stocks.reduce((sum, stock) => sum + stock.quantity, 0),
    };
}

/**
 * Storefront product families: which products a shopper sees as one product
 * in several sizes or colours. Grouping and ungrouping only ever touch
 * `family_id` and `option_values` on the members — never their stock, price,
 * cost or history — so both are safe to do and undo at any time.
 */
@Injectable()
export class ProductFamiliesService {
    constructor(
        private readonly db: DatabaseService,
        private readonly redis: RedisService,
    ) {}

    async findAll(tenantId: string) {
        const families = await this.db.productFamily.findMany({
            where: { tenant_id: tenantId },
            include: { products: { where: { deleted_at: null }, select: MEMBER_SELECT, orderBy: { name: 'asc' } } },
            orderBy: { name: 'asc' },
        });
        return families.map((family) => this.toFamily(family));
    }

    async findOne(tenantId: string, id: string) {
        const family = await this.db.productFamily.findFirst({
            where: { id, tenant_id: tenantId },
            include: { products: { where: { deleted_at: null }, select: MEMBER_SELECT, orderBy: { name: 'asc' } } },
        });
        if (!family) throw new NotFoundException('Product family not found');
        return this.toFamily(family);
    }

    /**
     * Products not yet in a family whose names differ only by a trailing size
     * or colour, as candidate families for staff to review. Nothing is grouped
     * until they confirm one.
     */
    async suggestions(tenantId: string) {
        const products = await this.db.product.findMany({
            where: { tenant_id: tenantId, deleted_at: null, family_id: null, type: 'GOODS' },
            select: { id: true, name: true, sku: true, price: true },
            orderBy: { name: 'asc' },
        });
        return suggestVariantFamilies(products)
            .slice(0, MAX_SUGGESTIONS)
            .map((suggestion) => ({
                name: suggestion.name,
                optionName: suggestion.optionName,
                members: suggestion.members.map(({ product, value }) => ({
                    productId: product.id,
                    name: product.name,
                    sku: product.sku,
                    price: Number(product.price),
                    value,
                })),
            }));
    }

    async create(tenantId: string, dto: CreateProductFamilyDto) {
        const validated = this.validate(dto.optionNames, dto.members);
        const name = this.requireName(dto.name);

        const familyId = await this.db.$transaction(async (tx) => {
            const products = await this.loadMembers(tx, tenantId, validated.members, null);
            const family = await tx.productFamily.create({
                data: {
                    tenant_id: tenantId,
                    name,
                    description: dto.description?.trim() || null,
                    // The first member's photo until staff choose one, so the
                    // storefront card is never blank for a family of photographed products.
                    image_url: dto.imageUrl?.trim() || products.find((p) => p.image_url)?.image_url || null,
                    images_gallery: dto.imagesGallery ?? [],
                    is_featured: dto.isFeatured ?? false,
                    option_names: validated.optionNames,
                },
            });
            await this.assignMembers(tx, tenantId, family.id, validated.members);
            return family.id;
        });

        await this.invalidate(tenantId);
        return this.findOne(tenantId, familyId);
    }

    async update(tenantId: string, id: string, dto: UpdateProductFamilyDto) {
        const family = await this.db.productFamily.findFirst({ where: { id, tenant_id: tenantId } });
        if (!family) throw new NotFoundException('Product family not found');

        // Members' values are keyed by option name, so renaming or adding an
        // option without restating them would leave every member unreadable.
        if (dto.optionNames && !dto.members) {
            throw new BadRequestException("Send the variants' values together with the options.");
        }
        const validated = dto.members ? this.validate(dto.optionNames ?? family.option_names, dto.members) : null;

        await this.db.$transaction(async (tx) => {
            if (validated) {
                await this.loadMembers(tx, tenantId, validated.members, id);
                const keep = validated.members.map((member) => member.productId);
                await tx.product.updateMany({
                    where: { tenant_id: tenantId, family_id: id, id: { notIn: keep } },
                    data: { family_id: null, option_values: Prisma.DbNull },
                });
                await this.assignMembers(tx, tenantId, id, validated.members);
            }
            await tx.productFamily.update({
                where: { id },
                data: {
                    ...(dto.name !== undefined ? { name: this.requireName(dto.name) } : {}),
                    ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
                    ...(dto.imageUrl !== undefined ? { image_url: dto.imageUrl.trim() || null } : {}),
                    ...(dto.imagesGallery !== undefined ? { images_gallery: dto.imagesGallery } : {}),
                    ...(dto.isFeatured !== undefined ? { is_featured: dto.isFeatured } : {}),
                    ...(validated ? { option_names: validated.optionNames } : {}),
                },
            });
        });

        await this.invalidate(tenantId);
        return this.findOne(tenantId, id);
    }

    /** Ungroups: every member goes back to being a product sold on its own. */
    async remove(tenantId: string, id: string) {
        const family = await this.db.productFamily.findFirst({ where: { id, tenant_id: tenantId }, select: { id: true } });
        if (!family) throw new NotFoundException('Product family not found');

        await this.db.$transaction(async (tx) => {
            await tx.product.updateMany({
                where: { tenant_id: tenantId, family_id: id },
                data: { family_id: null, option_values: Prisma.DbNull },
            });
            await tx.productFamily.delete({ where: { id } });
        });

        await this.invalidate(tenantId);
        return { id };
    }

    private validate(optionNames: readonly string[], members: CreateProductFamilyDto['members']) {
        const result = validateVariantFamily(optionNames, members);
        // `in`, not `!result.ok`: this project compiles without strictNullChecks,
        // which leaves a boolean discriminant unnarrowed.
        if ('error' in result) throw new BadRequestException(result.error);
        return result;
    }

    private requireName(name: string) {
        const trimmed = name.trim();
        if (!trimmed) throw new BadRequestException('Give the product a name.');
        return trimmed;
    }

    /**
     * The members as rows, after checking each is this tenant's, not deleted,
     * and not already in another family. `familyId` is the family being
     * edited, whose own members are of course allowed.
     */
    private async loadMembers(
        tx: Prisma.TransactionClient,
        tenantId: string,
        members: ValidatedVariantMember[],
        familyId: string | null,
    ) {
        const ids = members.map((member) => member.productId);
        const products = await tx.product.findMany({
            where: { id: { in: ids }, tenant_id: tenantId, deleted_at: null },
            select: { id: true, name: true, image_url: true, family_id: true, family: { select: { name: true } } },
        });
        if (products.length !== ids.length) {
            throw new BadRequestException('One or more products were not found.');
        }
        const taken = products.filter((product) => product.family_id && product.family_id !== familyId);
        if (taken.length > 0) {
            const names = taken.map((product) => `"${product.name}" (in ${product.family?.name ?? 'another product'})`);
            throw new BadRequestException(`Already a variant of another product: ${names.join(', ')}. Remove it from there first.`);
        }
        return products;
    }

    /**
     * Writes each member's family and values. The `family_id` condition makes
     * the claim atomic: if another request grouped one of these products after
     * `loadMembers` looked, its row no longer matches and the whole
     * transaction rolls back rather than stealing it.
     */
    private async assignMembers(
        tx: Prisma.TransactionClient,
        tenantId: string,
        familyId: string,
        members: ValidatedVariantMember[],
    ) {
        for (const member of members) {
            const { count } = await tx.product.updateMany({
                where: {
                    id: member.productId,
                    tenant_id: tenantId,
                    deleted_at: null,
                    OR: [{ family_id: null }, { family_id: familyId }],
                },
                data: { family_id: familyId, option_values: member.optionValues },
            });
            if (count !== 1) {
                throw new BadRequestException('A product changed while grouping. Reload and try again.');
            }
        }
    }

    /** The products list shows each product's family, and caches its pages. */
    private async invalidate(tenantId: string) {
        await this.redis.invalidatePattern(`products:${tenantId}:`);
    }

    private toFamily(family: {
        id: string;
        name: string;
        description: string | null;
        image_url: string | null;
        images_gallery: string[];
        option_names: string[];
        is_featured: boolean;
        created_at: Date;
        updated_at: Date;
        products: MemberRow[];
    }) {
        return {
            id: family.id,
            name: family.name,
            description: family.description,
            image_url: family.image_url,
            images_gallery: family.images_gallery,
            option_names: family.option_names,
            is_featured: family.is_featured,
            created_at: family.created_at,
            updated_at: family.updated_at,
            members: family.products.map(toMember),
        };
    }
}
