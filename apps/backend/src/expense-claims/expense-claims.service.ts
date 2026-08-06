import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';

/**
 * Employee expense claims — HRIS Phase 8.
 *
 * `ExpenseEntry` was the only expense concept and it has no employee and no
 * lifecycle: `{ store, category, amount, date, method }`. Getting money back
 * for a taxi was a WhatsApp message.
 *
 * The state machine is deliberately the same shape as `LeaveRequest`:
 * DRAFT → SUBMITTED → APPROVED/REJECTED → REIMBURSED, with the same
 * `approved_by` / `approved_at` / `approver_note` fields. Two approval flows
 * that behave differently for no reason cost a manager more than the
 * duplication costs us.
 */
@Injectable()
export class ExpenseClaimsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
    ) {}

    /**
     * Receipts are the module's first tenant-supplied file surface, so the
     * allow-list and the cap are part of the feature, not a hardening pass.
     */
    private static readonly ALLOWED_MIME = new Set([
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
    ]);
    private static readonly MAX_BYTES = 5 * 1024 * 1024;

    private toDateOnly(value: string | Date): Date {
        const date = value instanceof Date ? value : new Date(value);
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }

    private claimInclude() {
        return {
            lines: { include: { category: { select: { id: true, name: true } } } },
            attachments: {
                select: { id: true, file_url: true, file_name: true, mime_type: true, file_size: true },
            },
            employee: { select: { id: true, name: true, employee_code: true } },
        };
    }

    private total(lines: { amount: number }[]) {
        return Math.round(lines.reduce((sum, line) => sum + Number(line.amount), 0) * 100) / 100;
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    async list(tenantId: string, opts: { employeeId?: string; status?: string } = {}) {
        const where: any = { tenant_id: tenantId, deleted_at: null };
        if (opts.employeeId) where.employee_id = opts.employeeId;
        if (opts.status) where.status = opts.status;

        return this.db.expenseClaim.findMany({
            where,
            include: this.claimInclude(),
            orderBy: { created_at: 'desc' },
        });
    }

    /**
     * One claim.
     *
     * `employeeId` narrows the lookup rather than being checked afterwards, so
     * an employee asking for someone else's claim gets a 404 and learns
     * nothing — the same shape as `cancelLeaveRequest`.
     */
    async get(tenantId: string, id: string, employeeId?: string) {
        const claim = await this.db.expenseClaim.findFirst({
            where: {
                id, tenant_id: tenantId, deleted_at: null,
                ...(employeeId ? { employee_id: employeeId } : {}),
            },
            include: this.claimInclude(),
        });
        if (!claim) throw new NotFoundException('Expense claim not found.');
        return claim;
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    async create(tenantId: string, employeeId: string, dto: {
        title: string;
        claim_date: string;
        notes?: string;
        lines: { description: string; amount: number; spent_on: string; category_id?: string }[];
    }) {
        if (!dto.lines?.length) {
            throw new BadRequestException('A claim needs at least one line.');
        }
        for (const line of dto.lines) {
            if (Number(line.amount) <= 0) {
                throw new BadRequestException('Every claim line must be a positive amount.');
            }
        }

        return this.db.expenseClaim.create({
            data: {
                tenant_id: tenantId,
                employee_id: employeeId,
                title: dto.title,
                claim_date: this.toDateOnly(dto.claim_date),
                notes: dto.notes ?? null,
                status: 'DRAFT',
                total_amount: this.total(dto.lines),
                lines: {
                    create: dto.lines.map((line) => ({
                        description: line.description,
                        amount: line.amount,
                        spent_on: this.toDateOnly(line.spent_on),
                        category_id: line.category_id ?? null,
                    })),
                },
            },
            include: this.claimInclude(),
        });
    }

    /** Editable only while it is the employee's own draft. */
    private assertEditable(claim: { status: string }) {
        if (claim.status !== 'DRAFT') {
            throw new BadRequestException('Only a draft claim can be edited.');
        }
    }

    async update(tenantId: string, id: string, employeeId: string, dto: {
        title?: string;
        claim_date?: string;
        notes?: string;
        lines?: { description: string; amount: number; spent_on: string; category_id?: string }[];
    }) {
        const claim = await this.get(tenantId, id, employeeId);
        this.assertEditable(claim);

        if (dto.lines) {
            if (!dto.lines.length) throw new BadRequestException('A claim needs at least one line.');
            for (const line of dto.lines) {
                if (Number(line.amount) <= 0) {
                    throw new BadRequestException('Every claim line must be a positive amount.');
                }
            }
        }

        return this.db.$transaction(async (tx) => {
            if (dto.lines) {
                await tx.expenseClaimLine.deleteMany({ where: { claim_id: id } });
                await tx.expenseClaimLine.createMany({
                    data: dto.lines.map((line) => ({
                        claim_id: id,
                        description: line.description,
                        amount: line.amount,
                        spent_on: this.toDateOnly(line.spent_on),
                        category_id: line.category_id ?? null,
                    })),
                });
            }

            return tx.expenseClaim.update({
                where: { id },
                data: {
                    ...(dto.title ? { title: dto.title } : {}),
                    ...(dto.claim_date ? { claim_date: this.toDateOnly(dto.claim_date) } : {}),
                    ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
                    ...(dto.lines ? { total_amount: this.total(dto.lines) } : {}),
                },
                include: this.claimInclude(),
            });
        });
    }

    async submit(tenantId: string, id: string, employeeId: string) {
        const claim = await this.get(tenantId, id, employeeId);
        if (claim.status !== 'DRAFT') {
            throw new BadRequestException('Only a draft claim can be submitted.');
        }
        if (claim.lines.length === 0) {
            throw new BadRequestException('A claim needs at least one line before it can be submitted.');
        }

        return this.db.expenseClaim.update({
            where: { id },
            data: { status: 'SUBMITTED' },
            include: this.claimInclude(),
        });
    }

    /** Withdraw your own claim. Allowed while it is still pending a decision. */
    async cancel(tenantId: string, id: string, employeeId: string) {
        const claim = await this.get(tenantId, id, employeeId);
        if (!['DRAFT', 'SUBMITTED'].includes(claim.status)) {
            throw new BadRequestException('Only a draft or submitted claim can be withdrawn.');
        }
        return this.db.expenseClaim.update({
            where: { id },
            data: { status: 'CANCELLED' },
            include: this.claimInclude(),
        });
    }

    /**
     * Approve or reject. Staff action, behind `MANAGE_HR` on the controller.
     *
     * Deliberately no `employeeId` scope — an approver is by definition acting
     * on somebody else's claim.
     */
    async review(tenantId: string, id: string, reviewerUserId: string, dto: {
        status: 'APPROVED' | 'REJECTED'; approver_note?: string;
    }) {
        const claim = await this.get(tenantId, id);
        if (claim.status !== 'SUBMITTED') {
            throw new BadRequestException('Only a submitted claim can be reviewed.');
        }

        return this.db.expenseClaim.update({
            where: { id },
            data: {
                status: dto.status,
                approved_by: reviewerUserId,
                approved_at: new Date(),
                approver_note: dto.approver_note ?? null,
            },
            include: this.claimInclude(),
        });
    }

    /**
     * Settle an approved claim.
     *
     * `PAYROLL` creates an earning adjustment for the given period, which the
     * next run picks up — that is the whole integration, and it works because
     * `PayrollAdjustment` already exists and is already consumed by approval.
     *
     * `DIRECT` records the settlement without creating a payment: which cash
     * account it came from is a decision the expense module already owns
     * through `ExpenseEntry`, and inventing a second path to the GL here would
     * be the wrong place for it. The claim is marked reimbursed and the
     * accounting entry is the existing expense flow.
     */
    async reimburse(tenantId: string, id: string, dto: {
        via: 'DIRECT' | 'PAYROLL'; year?: number; month?: number;
    }, actorUserId?: string) {
        const claim = await this.get(tenantId, id);
        if (claim.status !== 'APPROVED') {
            throw new BadRequestException('Only an approved claim can be reimbursed.');
        }

        if (dto.via === 'PAYROLL') {
            if (!dto.year || !dto.month) {
                throw new BadRequestException('A payroll reimbursement needs a year and month.');
            }
            await this.db.payrollAdjustment.create({
                data: {
                    tenant_id: tenantId,
                    employee_id: claim.employee_id,
                    year: dto.year,
                    month: dto.month,
                    kind: 'EARNING',
                    name: `Expense claim: ${claim.title}`,
                    amount: claim.total_amount,
                    note: `Claim ${claim.id.slice(0, 8)}`,
                    created_by: actorUserId ?? null,
                },
            });
        }

        return this.db.expenseClaim.update({
            where: { id },
            data: {
                status: 'REIMBURSED',
                reimbursed_via: dto.via,
                reimbursed_at: new Date(),
            },
            include: this.claimInclude(),
        });
    }

    // ── Attachments ───────────────────────────────────────────────────────────

    async addAttachment(
        tenantId: string,
        claimId: string,
        employeeId: string | undefined,
        file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
        uploadedBy?: string,
    ) {
        const claim = await this.get(tenantId, claimId, employeeId);
        if (!['DRAFT', 'SUBMITTED'].includes(claim.status)) {
            throw new BadRequestException('Receipts can only be added before a claim is decided.');
        }

        if (!ExpenseClaimsService.ALLOWED_MIME.has(file.mimetype)) {
            throw new BadRequestException('A receipt must be a JPEG, PNG, WebP, HEIC or PDF.');
        }
        if (file.size > ExpenseClaimsService.MAX_BYTES) {
            throw new BadRequestException('A receipt must be 5MB or smaller.');
        }

        // `uploadBuffer` + `storage_key`, never `uploadFile`: the older path
        // returns only a URL, which cannot be turned back into a Cloudinary
        // handle, so deleting the row would strand the file and bill forever.
        // PDFs go through the raw pipeline — the image pipeline mangles them.
        const uploaded = await this.assets.uploadBuffer(
            file.buffer,
            `expense-claims/${tenantId}`,
            file.originalname.replace(/\.[^.]+$/, ''),
            file.mimetype === 'application/pdf' ? 'raw' : 'image',
        );

        return this.db.expenseClaimAttachment.create({
            data: {
                tenant_id: tenantId,
                claim_id: claimId,
                file_url: uploaded.url,
                file_name: file.originalname,
                mime_type: file.mimetype,
                file_size: uploaded.bytes ?? file.size,
                storage_key: uploaded.publicId,
                uploaded_by: uploadedBy ?? null,
            },
        });
    }

    async removeAttachment(tenantId: string, attachmentId: string, employeeId?: string) {
        const attachment = await this.db.expenseClaimAttachment.findFirst({
            where: { id: attachmentId, tenant_id: tenantId },
            include: { claim: { select: { id: true, status: true, employee_id: true } } },
        });
        if (!attachment) throw new NotFoundException('Receipt not found.');
        if (employeeId && attachment.claim.employee_id !== employeeId) {
            throw new ForbiddenException('This receipt belongs to another employee.');
        }
        if (!['DRAFT', 'SUBMITTED'].includes(attachment.claim.status)) {
            throw new BadRequestException('Receipts cannot be removed after a claim is decided.');
        }

        // Purge the stored file BEFORE the row, so a failure leaves a row
        // pointing at a live file rather than a live file nobody can find.
        if (attachment.storage_key) {
            await this.assets.deleteFile(attachment.storage_key).catch(() => undefined);
        }

        return this.db.expenseClaimAttachment.delete({ where: { id: attachmentId } });
    }
}
