import { Prisma } from '@prisma/client';
import { applyInventoryMovement } from '../../database/inventory.utils';
import type { DemoWorld, ProductRuntime } from './context';
import { money } from './write';

type Tx = Prisma.TransactionClient;

const PROJECT_STATUSES = [
    { name: 'Backlog', category: 'TODO', sort: 1 },
    { name: 'In Progress', category: 'IN_PROGRESS', sort: 2 },
    { name: 'Review', category: 'IN_PROGRESS', sort: 3 },
    { name: 'Done', category: 'DONE', sort: 4 },
] as const;

const PROJECT_SPECS = [
    {
        code: 'BR3',
        name: 'Third branch opening',
        tasks: [
            'Shortlist shop locations', 'Negotiate the lease', 'Order shelving and fit-out',
            'Recruit two salesmen', 'Move opening stock in', 'Soft launch and signage',
        ],
    },
    {
        code: 'DIGI',
        name: 'Move the shop online',
        tasks: [
            'Photograph the top 100 SKUs', 'Write product descriptions',
            'Set up delivery partners', 'Run the launch campaign',
        ],
    },
];

const SUPPORT_THREADS = [
    { subject: 'How do I print a VAT-compliant invoice?', category: 'support', body: 'Our customer is asking for a Mushak 6.3 copy — where do I get one?' },
    { subject: 'Stock count does not match the shelf', category: 'support', body: 'The report shows 12 but we counted 9. How do I correct it?' },
    { subject: 'Please add a second cash counter', category: 'feature', body: 'We opened a second till and want both cashiers on their own session.' },
];

/**
 * The remaining modules a walkthrough is likely to open: light manufacturing
 * (a bundle assembled from stock), the project board, and the in-app noise a
 * live store accumulates — low-stock notifications, support threads, feedback.
 *
 * Deliberately small. These exist so the pages are not blank, not to model a
 * factory: a grocer's demo needs one convincing combo pack, not a BOM tree.
 */
export class OpsWriter {
    private bundleProduct: ProductRuntime | null = null;
    private recipeId: string | null = null;
    private components: Array<{ product: ProductRuntime; quantity: number }> = [];

    constructor(private readonly world: DemoWorld) {}

    private get counts() {
        return this.world.counts;
    }

    /* ---------------------------------------------------------------- */
    /*  Manufacturing                                                    */
    /* ---------------------------------------------------------------- */

    /** A bundle product assembled from three fast-moving catalogue lines. */
    async ensureBom(tx: Tx, date: Date): Promise<void> {
        if (this.world.products.length < 4) return;

        const components = [...this.world.products]
            .sort((a, b) => b.popularityWeight - a.popularityWeight)
            .slice(0, 3)
            .map((product) => ({ product, quantity: this.world.rng.int(1, 3) }));
        const componentCost = components.reduce((s, c) => s + c.product.cost * c.quantity, 0);
        const sku = `D${this.world.batchNumber}-BUNDLE-01`;

        const product = await tx.product.upsert({
            where: { tenant_id_sku: { tenant_id: this.world.tenantId, sku } },
            update: {},
            create: {
                tenant_id: this.world.tenantId,
                name: 'Family Combo Pack',
                sku,
                price: money(componentCost * 1.35),
                unit_type: 'pack',
                reorder_level: 5,
                created_at: date,
            },
        });

        const existingRecipe = await tx.bomRecipe.findUnique({ where: { productId: product.id } });
        const recipe = existingRecipe ?? await tx.bomRecipe.create({
            data: {
                tenantId: this.world.tenantId,
                productId: product.id,
                outputQty: 1,
                notes: 'Assembled in-store from stock',
                created_at: date,
                updated_at: date,
                components: {
                    create: components.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
                },
            },
        });
        if (!existingRecipe) this.counts.bomRecipes++;

        this.recipeId = recipe.id;
        this.components = components;
        this.bundleProduct = {
            id: product.id, sku, name: 'Family Combo Pack',
            sellPrice: money(componentCost * 1.35), cost: money(componentCost),
            reorderLevel: 5, popularityWeight: 4, supplierIndex: 0, warranty: false,
            stock: new Map(this.world.stores.map((s) => [s.warehouseId, 0])),
        };
        this.world.products.push(this.bundleProduct);
        this.counts.products++;
    }

    /**
     * Assemble a batch: components leave stock, a little is wasted, the finished
     * packs come in. Mirrors what `manufacturing.service` does on completion —
     * same movement types, so the stock ledger reads identically.
     */
    async runProductionJob(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        if (!this.recipeId || !this.bundleProduct) return;

        const warehouse = this.world.mainStore.warehouseId;
        const quantity = rng.int(5, 20);
        // Only assemble what the shelf can actually supply.
        const feasible = Math.min(
            quantity,
            ...this.components.map((c) => Math.floor((c.product.stock.get(warehouse) ?? 0) / c.quantity)),
        );
        if (feasible <= 0) return;

        const job = await tx.productionJob.create({
            data: {
                tenantId: this.world.tenantId,
                recipeId: this.recipeId,
                productId: this.bundleProduct.id,
                quantity: feasible,
                status: 'COMPLETED',
                startedAt: date,
                completedAt: date,
                created_at: date,
                updated_at: date,
            },
        });
        this.counts.productionJobs++;

        let totalCost = 0;
        for (const component of this.components) {
            const used = component.quantity * feasible;
            await applyInventoryMovement(tx, {
                tenantId: this.world.tenantId, productId: component.product.id, warehouseId: warehouse,
                quantityDelta: -used, movementType: 'MANUFACTURING_CONSUMPTION',
                referenceType: 'PRODUCTION_JOB', referenceId: job.id, unitCost: component.product.cost, occurredAt: date,
            });
            component.product.stock.set(warehouse, (component.product.stock.get(warehouse) ?? 0) - used);
            totalCost += component.product.cost * used;

            // A unit or two spoils in assembly.
            if (rng.chance(0.3) && (component.product.stock.get(warehouse) ?? 0) > 1) {
                await tx.productionWastage.create({
                    data: {
                        tenantId: this.world.tenantId, jobId: job.id, productId: component.product.id,
                        quantity: new Prisma.Decimal(1), note: 'Damaged during assembly', created_at: date,
                    },
                });
                await applyInventoryMovement(tx, {
                    tenantId: this.world.tenantId, productId: component.product.id, warehouseId: warehouse,
                    quantityDelta: -1, movementType: 'MANUFACTURING_WASTAGE',
                    referenceType: 'PRODUCTION_JOB', referenceId: job.id, unitCost: component.product.cost, occurredAt: date,
                });
                component.product.stock.set(warehouse, (component.product.stock.get(warehouse) ?? 0) - 1);
                totalCost += component.product.cost;
            }
        }

        const labour = money(feasible * rng.int(8, 20));
        await tx.productionJobCost.createMany({
            data: [
                { tenantId: this.world.tenantId, jobId: job.id, costType: 'RAW_MATERIAL', amount: money(totalCost), created_at: date },
                { tenantId: this.world.tenantId, jobId: job.id, costType: 'LABOR', amount: labour, created_at: date },
            ],
        });

        await applyInventoryMovement(tx, {
            tenantId: this.world.tenantId, productId: this.bundleProduct.id, warehouseId: warehouse,
            quantityDelta: feasible, movementType: 'MANUFACTURING_OUTPUT',
            referenceType: 'PRODUCTION_JOB', referenceId: job.id,
            unitCost: money((totalCost + labour) / feasible), occurredAt: date,
        });
        this.bundleProduct.stock.set(warehouse, (this.bundleProduct.stock.get(warehouse) ?? 0) + feasible);

        await tx.productionJob.update({
            where: { id: job.id },
            data: { totalJobCost: money(totalCost + labour), costPerUnit: money((totalCost + labour) / feasible) },
        });
    }

    /* ---------------------------------------------------------------- */
    /*  Projects                                                         */
    /* ---------------------------------------------------------------- */

    /** Two running projects with a board's worth of tasks across the statuses. */
    async writeProjects(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;

        for (const spec of PROJECT_SPECS) {
            const code = `D${this.world.batchNumber}-${spec.code}`;
            const project = await tx.project.create({
                data: {
                    tenant_id: this.world.tenantId,
                    store_id: this.world.mainStore.storeId,
                    code,
                    name: spec.name,
                    description: `Demo project — ${spec.name.toLowerCase()}`,
                    status: 'ACTIVE',
                    priority: rng.pick(['MEDIUM', 'HIGH']) as never,
                    visibility: 'PUBLIC',
                    manager_id: this.world.userId,
                    created_by: this.world.userId,
                    start_date: date,
                    target_end_date: new Date(date.getTime() + 120 * 86400000),
                    budget_amount: money(rng.int(200, 900) * 1000),
                    created_at: date,
                    updated_at: date,
                },
            });
            this.counts.projects++;

            const statusIds: string[] = [];
            for (const status of PROJECT_STATUSES) {
                const row = await tx.projectTaskStatus.create({
                    data: {
                        tenant_id: this.world.tenantId, project_id: project.id, name: status.name,
                        category: status.category as never, sort_order: status.sort,
                        is_default: status.sort === 1, is_active: true,
                        created_at: date, updated_at: date,
                    },
                });
                statusIds.push(row.id);
            }

            const milestone = await tx.projectMilestone.create({
                data: {
                    tenant_id: this.world.tenantId, project_id: project.id, name: 'Phase 1',
                    target_date: new Date(date.getTime() + 60 * 86400000),
                    created_at: date, updated_at: date,
                },
            });

            for (const [index, title] of spec.tasks.entries()) {
                // Front-loaded: the early tasks are done, the later ones are not.
                const statusIndex = Math.min(PROJECT_STATUSES.length - 1, Math.floor((spec.tasks.length - index) / 2));
                const done = PROJECT_STATUSES[statusIndex].category === 'DONE';
                await tx.projectTask.create({
                    data: {
                        tenant_id: this.world.tenantId,
                        project_id: project.id,
                        milestone_id: milestone.id,
                        title,
                        status_id: statusIds[statusIndex],
                        priority: rng.pick(['LOW', 'MEDIUM', 'HIGH']) as never,
                        assignee_id: this.world.userId,
                        start_date: date,
                        due_date: new Date(date.getTime() + (index + 1) * 10 * 86400000),
                        estimate_hours: new Prisma.Decimal(rng.int(2, 24)),
                        remaining_hours: done ? new Prisma.Decimal(0) : new Prisma.Decimal(rng.int(1, 16)),
                        sort_order: index,
                        completed_at: done ? date : null,
                        created_by: this.world.userId,
                        created_at: date,
                        updated_at: date,
                    },
                });
                this.counts.projectTasks++;
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /*  In-app noise                                                     */
    /* ---------------------------------------------------------------- */

    /**
     * Low-stock alerts for whatever is running down. The bar is 1.5× the reorder
     * level rather than the level itself: selling a line down to its reorder
     * point triggers a replenishment purchase in the same day, so by the end of
     * a run almost nothing is still sitting at or under it.
     */
    async writeNotifications(tx: Tx, date: Date): Promise<void> {
        const warehouse = this.world.mainStore.warehouseId;
        const low = this.world.products
            .filter((p) => (p.stock.get(warehouse) ?? 0) <= p.reorderLevel * 1.5)
            .sort((a, b) => (a.stock.get(warehouse) ?? 0) - (b.stock.get(warehouse) ?? 0))
            .slice(0, 6);

        for (const product of low) {
            await tx.notification.create({
                data: {
                    tenant_id: this.world.tenantId,
                    user_id: this.world.userId,
                    type: 'LOW_STOCK',
                    title: `Low stock: ${product.name}`,
                    body: `${product.name} is down to ${product.stock.get(warehouse) ?? 0} against a reorder level of ${product.reorderLevel}.`,
                    link: '/inventory',
                    read_at: this.world.rng.chance(0.4) ? date : null,
                    created_at: date,
                },
            });
            this.counts.notifications++;
        }
    }

    /** A few support conversations with the platform team. */
    async writeSupportThreads(tx: Tx, date: Date): Promise<void> {
        const rng = this.world.rng;
        for (const [index, spec] of SUPPORT_THREADS.entries()) {
            const openedAt = new Date(date.getTime() + index * 5 * 86400000);
            if (openedAt > this.world.end) break;
            const resolved = rng.chance(0.6);

            const thread = await tx.supportThread.create({
                data: {
                    tenantId: this.world.tenantId,
                    subject: spec.subject,
                    status: resolved ? 'resolved' : 'open',
                    category: spec.category,
                    createdById: this.world.userId,
                    createdAt: openedAt,
                    updatedAt: openedAt,
                },
            });
            this.counts.supportThreads++;

            await tx.supportMessage.create({
                data: {
                    threadId: thread.id, senderId: this.world.userId, senderRole: 'owner',
                    body: spec.body, createdAt: openedAt,
                },
            });
        }
    }
}
