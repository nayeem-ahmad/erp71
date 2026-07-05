import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { CreateBomDto, UpdateBomDto, CreateProductionJobDto, WastageItemDto } from './manufacturing.dto';
import { applyInventoryMovement, ensureDefaultWarehouse } from '../database/inventory.utils';

@Injectable()
export class ManufacturingService {
    constructor(private readonly db: DatabaseService) {}

    // ------------------------------------------------------------------ //
    //  BOM Recipes                                                         //
    // ------------------------------------------------------------------ //

    async listBoms(tenantId: string, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.bomRecipe.findMany({
                    ...(args as object),
                    include: {
                        product: { select: { id: true, name: true, sku: true } },
                        _count: { select: { components: true } },
                    },
                }),
            count: (args) => this.db.bomRecipe.count(args as any),
            where: { tenantId },
            orderBy: { created_at: 'desc' },
            page,
            limit,
        });

        return {
            ...result,
            items: result.items.map((r: any) => ({
                id: r.id,
                productId: r.productId,
                productName: r.product.name,
                productSku: r.product.sku,
                outputQty: r.outputQty,
                notes: r.notes,
                componentCount: r._count.components,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })),
        };
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

    /**
     * Computes required vs available quantity for each BOM component at a given
     * production quantity, without mutating anything. Used both to preview
     * material requirements before creating/starting a job and to enforce the
     * stock check when a job actually starts.
     */
    async getRequirementsPreview(tenantId: string, recipeId: string, quantity: number) {
        const recipe = await this.getBom(tenantId, recipeId);
        const components = recipe.components as unknown as Array<{
            productId: string;
            quantity: any;
            product: { id: string; name: string; sku: string | null };
        }>;

        const items = await Promise.all(
            components.map(async (comp) => {
                const requiredQty = Number(comp.quantity) * quantity;

                const stockAgg = await this.db.productStock.aggregate({
                    where: { tenant_id: tenantId, product_id: comp.productId },
                    _sum: { quantity: true },
                });
                const availableQty = stockAgg._sum.quantity ?? 0;

                return {
                    productId: comp.productId,
                    productName: comp.product.name,
                    productSku: comp.product.sku,
                    perUnitQty: Number(comp.quantity),
                    requiredQty,
                    availableQty,
                    sufficient: availableQty >= requiredQty,
                };
            }),
        );

        return {
            recipeId,
            quantity,
            outputQty: quantity * recipe.outputQty,
            sufficient: items.every((item) => item.sufficient),
            components: items,
        };
    }

    async startJob(tenantId: string, id: string) {
        const job = await this.getJob(tenantId, id);

        if (job.status !== 'DRAFT') {
            throw new BadRequestException(`Cannot start a job in status ${job.status}`);
        }

        const preview = await this.getRequirementsPreview(tenantId, job.recipeId, job.quantity);
        const insufficient = preview.components
            .filter((item) => !item.sufficient)
            .map((item) => `${item.productName}: required ${item.requiredQty}, available ${item.availableQty}`);

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

    /** Latest known cost price per product (tenant-wide, most recently effective). */
    private async getCostMap(tenantId: string, productIds: string[]): Promise<Map<string, number>> {
        const prices = await this.db.productPrice.findMany({
            where: { tenant_id: tenantId, product_id: { in: productIds }, cost: { not: null } },
            orderBy: { effective_from: 'desc' },
            select: { product_id: true, cost: true },
        });
        const costByProductId = new Map<string, number>();
        for (const p of prices) {
            if (!costByProductId.has(p.product_id)) {
                costByProductId.set(p.product_id, Number(p.cost));
            }
        }
        return costByProductId;
    }

    async completeJob(tenantId: string, id: string, wastage: WastageItemDto[] = []) {
        const job = await this.getJob(tenantId, id);

        if (job.status !== 'IN_PROGRESS') {
            throw new BadRequestException(`Cannot complete a job in status ${job.status}`);
        }

        const recipe = job.recipe as any;
        const components = recipe.components as Array<{ productId: string; quantity: any }>;

        if (wastage.length > 0) {
            const wastageProductIds = wastage.map((w) => w.productId);
            const found = await this.db.product.findMany({
                where: { id: { in: wastageProductIds }, tenant_id: tenantId, deleted_at: null },
                select: { id: true },
            });
            if (found.length !== new Set(wastageProductIds).size) {
                throw new BadRequestException('One or more wastage products not found or do not belong to this tenant');
            }
        }

        const costMap = await this.getCostMap(tenantId, [
            ...components.map((c) => c.productId),
            ...wastage.map((w) => w.productId),
            job.productId,
        ]);

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
                    unitCost: costMap.get(comp.productId),
                });
            }

            // Decrement stock for any additional wastage recorded on top of the BOM, logged separately
            for (const w of wastage) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: w.productId,
                    warehouseId,
                    quantityDelta: -w.quantity,
                    movementType: 'MANUFACTURING_WASTAGE',
                    referenceType: 'PRODUCTION_JOB',
                    referenceId: id,
                    unitCost: costMap.get(w.productId),
                });
                await tx.productionWastage.create({
                    data: {
                        tenantId,
                        jobId: id,
                        productId: w.productId,
                        quantity: w.quantity,
                        note: w.note ?? null,
                    },
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
                unitCost: costMap.get(job.productId),
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

    // ------------------------------------------------------------------ //
    //  Analytics                                                           //
    // ------------------------------------------------------------------ //

    /**
     * Basic production cost & yield report (Epic 73): planned vs. actual material
     * cost per completed job, unit production cost, and a daily production
     * volume trend.
     */
    async getAnalytics(tenantId: string) {
        const jobs = await this.db.productionJob.findMany({
            where: { tenantId, status: 'COMPLETED' },
            orderBy: { completedAt: 'asc' },
            include: {
                recipe: { include: { product: { select: { id: true, name: true, sku: true } } } },
            },
        });

        if (jobs.length === 0) {
            return {
                totalCompletedJobs: 0,
                totalUnitsProduced: 0,
                totalMaterialCost: 0,
                avgUnitProductionCost: 0,
                jobs: [],
                volumeTrend: [],
            };
        }

        const jobIds = jobs.map((j: any) => j.id);
        const movements = await this.db.inventoryMovement.findMany({
            where: {
                tenant_id: tenantId,
                reference_type: 'PRODUCTION_JOB',
                reference_id: { in: jobIds },
                movement_type: { in: ['MANUFACTURING_CONSUMPTION', 'MANUFACTURING_WASTAGE'] },
            },
            select: { reference_id: true, movement_type: true, quantity_delta: true, unit_cost: true },
        });

        const costByJob = new Map<string, { planned: number; wastage: number }>();
        for (const m of movements) {
            const entry = costByJob.get(m.reference_id as string) ?? { planned: 0, wastage: 0 };
            const cost = Math.abs(m.quantity_delta) * Number(m.unit_cost ?? 0);
            if (m.movement_type === 'MANUFACTURING_CONSUMPTION') {
                entry.planned += cost;
            } else {
                entry.wastage += cost;
            }
            costByJob.set(m.reference_id as string, entry);
        }

        const volumeByDate = new Map<string, number>();
        let totalUnitsProduced = 0;
        let totalMaterialCost = 0;

        const jobRows = jobs.map((job: any) => {
            const outputQty = job.quantity * job.recipe.outputQty;
            const { planned, wastage } = costByJob.get(job.id) ?? { planned: 0, wastage: 0 };
            const actual = planned + wastage;
            const unitCost = outputQty > 0 ? actual / outputQty : 0;

            totalUnitsProduced += outputQty;
            totalMaterialCost += actual;

            const dateKey = (job.completedAt ?? job.created_at).toISOString().slice(0, 10);
            volumeByDate.set(dateKey, (volumeByDate.get(dateKey) ?? 0) + outputQty);

            return {
                jobId: job.id,
                productId: job.recipe.product.id,
                productName: job.recipe.product.name,
                productSku: job.recipe.product.sku,
                quantityProduced: outputQty,
                plannedMaterialCost: planned,
                wastageCost: wastage,
                actualMaterialCost: actual,
                unitProductionCost: unitCost,
                completedAt: job.completedAt,
            };
        });

        const volumeTrend = Array.from(volumeByDate.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, quantityProduced]) => ({ date, quantityProduced }));

        return {
            totalCompletedJobs: jobs.length,
            totalUnitsProduced,
            totalMaterialCost,
            avgUnitProductionCost: totalUnitsProduced > 0 ? totalMaterialCost / totalUnitsProduced : 0,
            jobs: jobRows,
            volumeTrend,
        };
    }
}
