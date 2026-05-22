import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateBomDto, UpdateBomDto, CreateProductionJobDto } from './manufacturing.dto';
import { applyInventoryMovement, ensureDefaultWarehouse } from '../database/inventory.utils';

@Injectable()
export class ManufacturingService {
    constructor(private readonly db: DatabaseService) {}

    // ------------------------------------------------------------------ //
    //  BOM Recipes                                                         //
    // ------------------------------------------------------------------ //

    async listBoms(tenantId: string) {
        const recipes = await this.db.bomRecipe.findMany({
            where: { tenantId },
            orderBy: { created_at: 'desc' },
            include: {
                product: { select: { id: true, name: true, sku: true } },
                _count: { select: { components: true } },
            },
        });

        return recipes.map((r) => ({
            id: r.id,
            productId: r.productId,
            productName: r.product.name,
            productSku: r.product.sku,
            outputQty: r.outputQty,
            notes: r.notes,
            componentCount: r._count.components,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }));
    }

    async getBom(tenantId: string, id: string) {
        const recipe = await this.db.bomRecipe.findFirst({
            where: { id, tenantId },
            include: {
                product: { select: { id: true, name: true, sku: true } },
                components: {
                    include: {
                        product: { select: { id: true, name: true, sku: true } },
                    },
                },
            },
        });

        if (!recipe) throw new NotFoundException('BOM recipe not found');
        return recipe;
    }

    async createBom(tenantId: string, dto: CreateBomDto) {
        // Validate output product belongs to tenant
        const product = await this.db.product.findFirst({
            where: { id: dto.productId, tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });
        if (!product) throw new BadRequestException('Product not found or does not belong to this tenant');

        // Validate all component products belong to tenant
        if (dto.components.length > 0) {
            const componentProductIds = dto.components.map((c) => c.productId);
            const found = await this.db.product.findMany({
                where: {
                    id: { in: componentProductIds },
                    tenant_id: tenantId,
                    deleted_at: null,
                },
                select: { id: true },
            });
            if (found.length !== componentProductIds.length) {
                throw new BadRequestException('One or more component products not found or do not belong to this tenant');
            }
        }

        return this.db.$transaction(async (tx) => {
            const recipe = await tx.bomRecipe.create({
                data: {
                    tenantId,
                    productId: dto.productId,
                    outputQty: dto.outputQty,
                    notes: dto.notes ?? null,
                    components: {
                        create: dto.components.map((c) => ({
                            productId: c.productId,
                            quantity: c.quantity,
                        })),
                    },
                },
                include: {
                    product: { select: { id: true, name: true, sku: true } },
                    components: {
                        include: {
                            product: { select: { id: true, name: true, sku: true } },
                        },
                    },
                },
            });

            return recipe;
        });
    }

    async updateBom(tenantId: string, id: string, dto: UpdateBomDto) {
        await this.getBom(tenantId, id);

        return this.db.$transaction(async (tx) => {
            // If components provided, replace all
            if (dto.components !== undefined) {
                if (dto.components.length > 0) {
                    const componentProductIds = dto.components.map((c) => c.productId);
                    const found = await tx.product.findMany({
                        where: {
                            id: { in: componentProductIds },
                            tenant_id: tenantId,
                            deleted_at: null,
                        },
                        select: { id: true },
                    });
                    if (found.length !== componentProductIds.length) {
                        throw new BadRequestException('One or more component products not found or do not belong to this tenant');
                    }
                }

                await tx.bomComponent.deleteMany({ where: { recipeId: id } });

                if (dto.components.length > 0) {
                    await tx.bomComponent.createMany({
                        data: dto.components.map((c) => ({
                            recipeId: id,
                            productId: c.productId,
                            quantity: c.quantity,
                        })),
                    });
                }
            }

            const updateData: any = {};
            if (dto.outputQty !== undefined) updateData.outputQty = dto.outputQty;
            if (dto.notes !== undefined) updateData.notes = dto.notes;

            return tx.bomRecipe.update({
                where: { id },
                data: updateData,
                include: {
                    product: { select: { id: true, name: true, sku: true } },
                    components: {
                        include: {
                            product: { select: { id: true, name: true, sku: true } },
                        },
                    },
                },
            });
        });
    }

    async deleteBom(tenantId: string, id: string) {
        await this.getBom(tenantId, id);
        await this.db.bomRecipe.delete({ where: { id } });
    }

    // ------------------------------------------------------------------ //
    //  Production Jobs                                                     //
    // ------------------------------------------------------------------ //

    async listJobs(tenantId: string, page: number, limit: number, status?: string) {
        const skip = (page - 1) * limit;
        const where: any = { tenantId };
        if (status) where.status = status;

        const [items, total] = await Promise.all([
            this.db.productionJob.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: 'desc' },
                include: {
                    recipe: {
                        include: {
                            product: { select: { id: true, name: true, sku: true } },
                        },
                    },
                },
            }),
            this.db.productionJob.count({ where }),
        ]);

        return {
            items,
            total,
            page,
            limit,
            pages: Math.ceil(total / limit),
        };
    }

    async getJob(tenantId: string, id: string) {
        const job = await this.db.productionJob.findFirst({
            where: { id, tenantId },
            include: {
                recipe: {
                    include: {
                        product: { select: { id: true, name: true, sku: true } },
                        components: {
                            include: {
                                product: { select: { id: true, name: true, sku: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!job) throw new NotFoundException('Production job not found');
        return job;
    }

    async createJob(tenantId: string, dto: CreateProductionJobDto) {
        // Validate recipe belongs to tenant
        const recipe = await this.db.bomRecipe.findFirst({
            where: { id: dto.recipeId, tenantId },
            select: { id: true, productId: true },
        });
        if (!recipe) throw new BadRequestException('BOM recipe not found or does not belong to this tenant');

        return this.db.productionJob.create({
            data: {
                tenantId,
                recipeId: dto.recipeId,
                productId: recipe.productId,
                quantity: dto.quantity,
                status: 'DRAFT',
                notes: dto.notes ?? null,
            },
        });
    }

    async startJob(tenantId: string, id: string) {
        const job = await this.getJob(tenantId, id);

        if (job.status !== 'DRAFT') {
            throw new BadRequestException(`Cannot start a job in status ${job.status}`);
        }

        // Check component stock availability across all warehouses
        const recipe = job.recipe as any;
        const components = recipe.components as Array<{ productId: string; quantity: any; product: { name: string } }>;

        const insufficient: string[] = [];

        for (const comp of components) {
            const requiredQty = Number(comp.quantity) * job.quantity;

            const stockAgg = await this.db.productStock.aggregate({
                where: {
                    tenant_id: tenantId,
                    product_id: comp.productId,
                },
                _sum: { quantity: true },
            });

            const availableQty = stockAgg._sum.quantity ?? 0;

            if (availableQty < requiredQty) {
                insufficient.push(
                    `${comp.product.name}: required ${requiredQty}, available ${availableQty}`,
                );
            }
        }

        if (insufficient.length > 0) {
            throw new BadRequestException(
                `Insufficient stock for: ${insufficient.join('; ')}`,
            );
        }

        return this.db.productionJob.update({
            where: { id },
            data: { status: 'IN_PROGRESS', startedAt: new Date() },
        });
    }

    async completeJob(tenantId: string, id: string) {
        const job = await this.getJob(tenantId, id);

        if (job.status !== 'IN_PROGRESS') {
            throw new BadRequestException(`Cannot complete a job in status ${job.status}`);
        }

        const recipe = job.recipe as any;
        const components = recipe.components as Array<{ productId: string; quantity: any }>;

        return this.db.$transaction(async (tx) => {
            // Get or create default warehouse for the tenant
            const warehouse = await ensureDefaultWarehouse(tx, tenantId);
            const warehouseId = warehouse.id;

            // Decrement each component's stock
            for (const comp of components) {
                const consumeQty = Number(comp.quantity) * job.quantity;
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: comp.productId,
                    warehouseId,
                    quantityDelta: -consumeQty,
                    movementType: 'MANUFACTURING_CONSUMPTION',
                    referenceType: 'PRODUCTION_JOB',
                    referenceId: id,
                });
            }

            // Increment output product's stock
            const outputQty = job.quantity * recipe.outputQty;
            await applyInventoryMovement(tx, {
                tenantId,
                productId: job.productId,
                warehouseId,
                quantityDelta: outputQty,
                movementType: 'MANUFACTURING_OUTPUT',
                referenceType: 'PRODUCTION_JOB',
                referenceId: id,
            });

            // Mark job as completed
            return tx.productionJob.update({
                where: { id },
                data: { status: 'COMPLETED', completedAt: new Date() },
            });
        });
    }

    async cancelJob(tenantId: string, id: string) {
        const job = await this.getJob(tenantId, id);

        if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
            throw new BadRequestException(`Cannot cancel a job in status ${job.status}`);
        }

        return this.db.productionJob.update({
            where: { id },
            data: { status: 'CANCELLED' },
        });
    }
}
