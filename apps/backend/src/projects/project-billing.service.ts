import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { grossUpUnitPrice, resolveTaxRate, roundMoney } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { AuditService, type AuditContext } from '../audit/audit.service';
import { SalesService } from '../sales/sales.service';
import { ProjectAccessService, type ProjectViewer } from './project-access.service';
import { ProjectUnbilledService, UNBILLED_ENTRY, type UnbilledPerson } from './project-unbilled.service';

const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** A milestone still to bill. */
const UNBILLED_MILESTONE: Prisma.ProjectMilestoneWhereInput = {
    OR: [{ sale_id: null }, { sale: { status: 'CANCELLED' } }],
};

export type InvoiceKind = 'MILESTONE' | 'HOURS' | 'AMOUNT';


/**
 * Project costing, Phase C: billing the customer.
 *
 * Every invoice is an ordinary credit sale to the project's customer, raised
 * through `SalesService.create` — the same numbering, VAT, posting, credit
 * limit and customer due as any other sale — and tagged with the project.
 * What it billed (a milestone, a set of hours) is marked inside the sale's own
 * transaction, so an invoice and what it bills commit together or not at all.
 * Cancelling the sale frees what it billed to be billed again.
 */
@Injectable()
export class ProjectBillingService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: ProjectAccessService,
        private readonly sales: SalesService,
        private readonly audit: AuditService,
        private readonly unbilled: ProjectUnbilledService,
    ) {}

    /** Everything the Billing section of Financials shows. */
    async billing(viewer: ProjectViewer, projectId: string, upTo?: string) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const project = await this.loadProject(tenantId, projectId);

        const [invoices, milestones, unbilled, settings] = await Promise.all([
            this.db.sale.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                select: {
                    id: true,
                    serial_number: true,
                    sale_date: true,
                    total_amount: true,
                    amount_paid: true,
                    status: true,
                    note: true,
                },
                orderBy: { sale_date: 'desc' },
            }),
            this.db.projectMilestone.findMany({
                where: { tenant_id: tenantId, project_id: projectId },
                select: {
                    id: true,
                    name: true,
                    target_date: true,
                    completed_at: true,
                    amount: true,
                    sale: { select: { id: true, serial_number: true, status: true } },
                },
                orderBy: [{ sort_order: 'asc' }, { target_date: 'asc' }],
            }),
            project.billing_type === 'TIME_AND_MATERIALS'
                ? this.unbilled.unbilledHours(tenantId, project, upTo)
                : Promise.resolve({ people: [] as UnbilledPerson[], hours: 0, amount: 0, unratedHours: 0, entryIds: [] as string[] }),
            this.db.projectCostingSettings.findUnique({
                where: { tenant_id: tenantId },
                select: { billing_product_id: true },
            }),
        ]);

        return {
            project: {
                billingType: project.billing_type,
                contractValue: project.contract_value === null ? null : num(project.contract_value),
                billRate: project.bill_rate === null ? null : num(project.bill_rate),
                customer: project.customer,
            },
            billingProductId: settings?.billing_product_id ?? null,
            invoices: invoices.map((sale) => ({
                id: sale.id,
                serialNumber: sale.serial_number,
                date: sale.sale_date.toISOString().slice(0, 10),
                totalAmount: num(sale.total_amount),
                amountPaid: num(sale.amount_paid),
                status: sale.status,
                note: sale.note,
            })),
            milestones: milestones.map((milestone) => {
                const billed = milestone.sale && milestone.sale.status !== 'CANCELLED' ? milestone.sale : null;
                return {
                    id: milestone.id,
                    name: milestone.name,
                    targetDate: milestone.target_date ? milestone.target_date.toISOString().slice(0, 10) : null,
                    completed: milestone.completed_at !== null,
                    amount: milestone.amount === null ? null : num(milestone.amount),
                    invoice: billed ? { id: billed.id, serialNumber: billed.serial_number } : null,
                };
            }),
            unbilledHours: {
                hours: unbilled.hours,
                amount: unbilled.amount,
                unratedHours: unbilled.unratedHours,
                people: unbilled.people,
            },
        };
    }

    /**
     * Raise an invoice for the project: a milestone, the unbilled hours up to a
     * date, or a plain amount (an advance, a variation). One line, on the
     * service product invoices bill as, as a credit sale to the project's
     * customer in the caller's branch.
     */
    async invoice(
        viewer: ProjectViewer,
        projectId: string,
        dto: {
            kind: InvoiceKind;
            milestoneId?: string;
            upTo?: string;
            amount?: number;
            description?: string;
            productId?: string;
            amountIncludesVat?: boolean;
            saleDate?: string;
        },
        ctx: AuditContext,
        canSellIn: (storeId: string) => Promise<boolean>,
    ) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const project = await this.loadProject(tenantId, projectId);

        if (project.billing_type === 'INTERNAL') {
            throw new BadRequestException('This project is not billed. Set how it is billed on the project first.');
        }
        if (!project.customer_id) {
            throw new BadRequestException('Set the project\'s customer first — the invoice is raised to them.');
        }
        const storeId = viewer.storeId ?? project.store_id;
        if (!storeId) throw new BadRequestException('Choose the branch to invoice from.');
        if (!(await canSellIn(storeId))) {
            throw new BadRequestException('You cannot create sales in this branch.');
        }

        const product = await this.billingProduct(tenantId, dto.productId);

        let amount: number;
        let note: string;
        let mark: (tx: any, sale: { id: string }) => Promise<void>;

        if (dto.kind === 'MILESTONE') {
            if (!dto.milestoneId) throw new BadRequestException('Choose the milestone to invoice.');
            const milestone = await this.db.projectMilestone.findFirst({
                where: { id: dto.milestoneId, tenant_id: tenantId, project_id: projectId, ...UNBILLED_MILESTONE },
                select: { id: true, name: true, amount: true },
            });
            if (!milestone) throw new NotFoundException('That milestone is not on this project, or is already invoiced.');
            amount = num(milestone.amount);
            if (!(amount > 0)) throw new BadRequestException('Give the milestone an amount before invoicing it.');
            note = `${project.code} · ${milestone.name}`;
            mark = async (tx, sale) => {
                const claimed = await tx.projectMilestone.updateMany({
                    where: { id: milestone.id, ...UNBILLED_MILESTONE },
                    data: { sale_id: sale.id },
                });
                if (claimed.count !== 1) throw new ConflictException('This milestone was invoiced a moment ago.');
            };
        } else if (dto.kind === 'HOURS') {
            if (project.billing_type !== 'TIME_AND_MATERIALS') {
                throw new BadRequestException('Only a time-and-materials project bills its hours.');
            }
            const unbilled = await this.unbilled.unbilledHours(tenantId, project, dto.upTo);
            if (unbilled.entryIds.length === 0) throw new BadRequestException('There are no unbilled hours to invoice.');
            if (unbilled.unratedHours > 0) {
                throw new BadRequestException('Some of these hours have no bill rate. Set the project\'s rate, or the person\'s.');
            }
            amount = unbilled.amount;
            note = `${project.code} · ${unbilled.hours} h${dto.upTo ? ` to ${dto.upTo}` : ''}`;
            mark = async (tx, sale) => {
                const claimed = await tx.projectTimeEntry.updateMany({
                    where: { id: { in: unbilled.entryIds }, ...UNBILLED_ENTRY },
                    data: { billed_sale_id: sale.id },
                });
                if (claimed.count !== unbilled.entryIds.length) {
                    throw new ConflictException('Some of these hours were invoiced a moment ago. Try again.');
                }
            };
        } else {
            amount = Number(dto.amount ?? 0);
            if (!(amount > 0)) throw new BadRequestException('Give an amount to invoice.');
            const description = dto.description?.trim();
            if (!description) throw new BadRequestException('Say what the amount is for.');
            note = `${project.code} · ${description}`;
            mark = async () => {};
        }

        // The sale engine prices lines VAT-inclusive. An amount given before VAT
        // is grossed up at the billing product's own rates, as a quotation is.
        const settingsVat = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { default_vat_rate: true } });
        const rates = {
            vatRate: resolveTaxRate(product.vat_rate === null ? null : num(product.vat_rate), num(settingsVat?.default_vat_rate)),
            sdRate: resolveTaxRate(product.sd_rate === null ? null : num(product.sd_rate), 0),
        };
        const includesVat = dto.amountIncludesVat !== false;
        const priceAtSale = includesVat ? roundMoney(amount) : grossUpUnitPrice(amount, rates);

        const sale = await this.sales.create(
            tenantId,
            ctx.userId ?? viewer.userId,
            {
                storeId,
                customerId: project.customer_id,
                items: [{ productId: product.id, quantity: 1, priceAtSale }],
                totalAmount: priceAtSale,
                // A project invoice is billed now and collected later: the whole
                // total goes on the customer's account, and their limit applies.
                amountPaid: 0,
                pricesIncludeVat: true,
                note,
                ...(dto.saleDate ? { saleDate: dto.saleDate } : {}),
            } as any,
            { projectId, onCreated: mark },
        );

        await this.audit
            .log('PROJECT_INVOICED', 'Project', { ...ctx, tenantId }, projectId, {
                kind: dto.kind,
                sale_id: sale.id,
                serial_number: sale.serial_number,
                total_amount: priceAtSale,
                milestone_id: dto.milestoneId ?? null,
            })
            .catch(() => {});

        return { saleId: sale.id, serialNumber: sale.serial_number, totalAmount: priceAtSale };
    }

    /** A member's own bill rate on this project, or null to fall back to the project's. */
    async setMemberBillRate(viewer: ProjectViewer, projectId: string, memberId: string, rate: number | null, ctx: AuditContext) {
        const tenantId = viewer.tenantId;
        await this.access.assertProjectVisible(viewer, projectId);
        const member = await this.db.projectMember.findFirst({
            where: { id: memberId, tenant_id: tenantId, project_id: projectId },
            select: { id: true, bill_rate: true },
        });
        if (!member) throw new NotFoundException('That person is not on this project.');
        const updated = await this.db.projectMember.update({
            where: { id: memberId },
            data: { bill_rate: rate },
            select: { id: true, bill_rate: true },
        });
        await this.audit
            .log('PROJECT_BILL_RATE_SET', 'Project', { ...ctx, tenantId }, projectId, {
                member_id: memberId,
                before: member.bill_rate === null ? null : num(member.bill_rate),
                after: rate,
            })
            .catch(() => {});
        return { id: updated.id, billRate: updated.bill_rate === null ? null : num(updated.bill_rate) };
    }

    /** Service products an invoice can bill as. */
    async billingProducts(tenantId: string) {
        const rows = await this.db.product.findMany({
            where: { tenant_id: tenantId, type: 'SERVICE' },
            select: { id: true, name: true, vat_rate: true },
            orderBy: { name: 'asc' },
            take: 200,
        });
        return rows.map((row) => ({ id: row.id, name: row.name, vatRate: row.vat_rate === null ? null : num(row.vat_rate) }));
    }

    /** The product named, else the workspace's default — a service of this workspace either way. */
    private async billingProduct(tenantId: string, productId?: string) {
        const id = productId
            ?? (await this.db.projectCostingSettings.findUnique({
                where: { tenant_id: tenantId },
                select: { billing_product_id: true },
            }))?.billing_product_id;
        if (!id) {
            throw new BadRequestException('Choose the service product project invoices bill as.');
        }
        const product = await this.db.product.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true, type: true, vat_rate: true, sd_rate: true },
        });
        if (!product) throw new NotFoundException('Billing product not found');
        // A goods line on an invoice would take stock out with nobody issuing it.
        if (product.type !== 'SERVICE') throw new BadRequestException('Project invoices bill a service product.');
        return product;
    }

    private async loadProject(tenantId: string, projectId: string) {
        const project = await this.db.project.findFirst({
            where: { id: projectId, tenant_id: tenantId, deleted_at: null },
            select: {
                id: true,
                code: true,
                store_id: true,
                customer_id: true,
                billing_type: true,
                contract_value: true,
                bill_rate: true,
                customer: { select: { id: true, name: true } },
            },
        });
        if (!project) throw new NotFoundException('Project not found');
        return project;
    }
}
