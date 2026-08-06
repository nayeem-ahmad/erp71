import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AssetsService } from '../assets/assets.service';

/**
 * Employee-assigned assets, policies and documents — HRIS Phases 9 and 10.
 *
 * Grouped in one service because all three are the same operation seen from
 * three angles: attach a thing to a person, and record that the person has seen
 * it. Splitting them across three modules would triple the wiring for no gain.
 */
@Injectable()
export class EmployeeRecordsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
    ) {}

    private static readonly ALLOWED_MIME = new Set([
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
    ]);
    private static readonly MAX_BYTES = 10 * 1024 * 1024;

    private toDateOnly(value: string | Date): Date {
        const date = value instanceof Date ? value : new Date(value);
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }

    // ── Asset assignments (Phase 9) ───────────────────────────────────────────

    async listAssignments(tenantId: string, opts: { employeeId?: string; outstandingOnly?: boolean } = {}) {
        return this.db.assetAssignment.findMany({
            where: {
                tenant_id: tenantId,
                ...(opts.employeeId ? { employee_id: opts.employeeId } : {}),
                ...(opts.outstandingOnly ? { returned_on: null } : {}),
            },
            include: {
                employee: { select: { id: true, name: true, employee_code: true } },
                fixedAsset: { select: { id: true, asset_code: true, name: true } },
            },
            orderBy: { assigned_on: 'desc' },
        });
    }

    async assign(tenantId: string, dto: {
        employee_id: string;
        item_name?: string;
        fixed_asset_id?: string;
        serial_number?: string;
        quantity?: number;
        assigned_on: string;
        condition_out?: string;
        notes?: string;
    }, createdBy?: string) {
        const employee = await this.db.employee.findFirst({
            where: { id: dto.employee_id, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        let itemName = dto.item_name?.trim();

        if (dto.fixed_asset_id) {
            const asset = await this.db.fixedAsset.findFirst({
                where: { id: dto.fixed_asset_id, tenant_id: tenantId },
                select: { id: true, name: true },
            });
            if (!asset) throw new NotFoundException('Fixed asset not found.');

            // Refuse to hand out something already out. A laptop in two places
            // is the exact confusion this model exists to prevent.
            const outstanding = await this.db.assetAssignment.findFirst({
                where: { tenant_id: tenantId, fixed_asset_id: dto.fixed_asset_id, returned_on: null },
                select: { id: true },
            });
            if (outstanding) {
                throw new BadRequestException('This asset is already assigned to someone. Record its return first.');
            }

            // The name is copied, not referenced: the assignment record must
            // still read sensibly if the asset is renamed or disposed of.
            itemName = itemName || asset.name;
        }

        if (!itemName) {
            throw new BadRequestException('An assignment needs either an item name or a fixed asset.');
        }

        return this.db.assetAssignment.create({
            data: {
                tenant_id: tenantId,
                employee_id: dto.employee_id,
                fixed_asset_id: dto.fixed_asset_id ?? null,
                item_name: itemName,
                serial_number: dto.serial_number ?? null,
                quantity: dto.quantity ?? 1,
                assigned_on: this.toDateOnly(dto.assigned_on),
                condition_out: dto.condition_out ?? null,
                notes: dto.notes ?? null,
                created_by: createdBy ?? null,
            },
            include: { employee: { select: { id: true, name: true, employee_code: true } } },
        });
    }

    async recordReturn(tenantId: string, id: string, dto: { returned_on: string; condition_in?: string }) {
        const assignment = await this.db.assetAssignment.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!assignment) throw new NotFoundException('Assignment not found.');
        if (assignment.returned_on) {
            throw new BadRequestException('This item has already been returned.');
        }

        const returnedOn = this.toDateOnly(dto.returned_on);
        if (returnedOn < assignment.assigned_on) {
            throw new BadRequestException('An item cannot be returned before it was handed out.');
        }

        return this.db.assetAssignment.update({
            where: { id },
            data: { returned_on: returnedOn, condition_in: dto.condition_in ?? null },
        });
    }

    /**
     * The employee confirming they hold it, from the portal.
     *
     * Scoped by employee id from the token — acknowledging on somebody else's
     * behalf would defeat the entire purpose of the acknowledgement.
     */
    async acknowledgeAssignment(tenantId: string, employeeId: string, id: string) {
        const assignment = await this.db.assetAssignment.findFirst({
            where: { id, tenant_id: tenantId, employee_id: employeeId },
        });
        if (!assignment) throw new NotFoundException('Assignment not found.');
        if (assignment.acknowledged_at) return assignment;

        return this.db.assetAssignment.update({
            where: { id },
            data: { acknowledged_at: new Date() },
        });
    }

    // ── Policies (Phase 10) ───────────────────────────────────────────────────

    async listPolicies(tenantId: string, opts: { publishedOnly?: boolean } = {}) {
        return this.db.policy.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                ...(opts.publishedOnly ? { published_at: { not: null } } : {}),
            },
            orderBy: [{ published_at: 'desc' }, { created_at: 'desc' }],
        });
    }

    async createPolicy(tenantId: string, dto: {
        title: string; body: string; kind?: string;
        requires_acknowledgement?: boolean; effective_from?: string; publish?: boolean;
    }, createdBy?: string) {
        return this.db.policy.create({
            data: {
                tenant_id: tenantId,
                title: dto.title,
                body: dto.body,
                kind: dto.kind ?? 'POLICY',
                requires_acknowledgement: dto.requires_acknowledgement ?? false,
                effective_from: dto.effective_from ? this.toDateOnly(dto.effective_from) : null,
                published_at: dto.publish ? new Date() : null,
                created_by: createdBy ?? null,
            },
        });
    }

    async updatePolicy(tenantId: string, id: string, dto: Record<string, any>) {
        const policy = await this.db.policy.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!policy) throw new NotFoundException('Policy not found.');

        const data: Record<string, any> = { ...dto };
        if (dto.effective_from) data.effective_from = this.toDateOnly(dto.effective_from);
        if (dto.publish !== undefined) {
            // Unpublishing sets it back to null rather than deleting: a policy
            // pulled for revision must keep the acknowledgements it already
            // collected, or republishing would silently reset everyone.
            data.published_at = dto.publish ? (policy.published_at ?? new Date()) : null;
            delete data.publish;
        }

        return this.db.policy.update({ where: { id }, data });
    }

    async deletePolicy(tenantId: string, id: string) {
        const policy = await this.db.policy.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!policy) throw new NotFoundException('Policy not found.');
        return this.db.policy.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    /** Who has and has not acknowledged — the reason this feature exists. */
    async policyAcknowledgementStatus(tenantId: string, policyId: string) {
        const policy = await this.db.policy.findFirst({
            where: { id: policyId, tenant_id: tenantId, deleted_at: null },
        });
        if (!policy) throw new NotFoundException('Policy not found.');

        const [employees, acknowledgements] = await Promise.all([
            this.db.employee.findMany({
                where: { tenant_id: tenantId, status: 'ACTIVE', deleted_at: null },
                select: { id: true, name: true, employee_code: true },
                orderBy: { name: 'asc' },
            }),
            this.db.policyAcknowledgement.findMany({
                where: { tenant_id: tenantId, policy_id: policyId },
                select: { employee_id: true, acknowledged_at: true },
            }),
        ]);

        const byEmployee = new Map(acknowledgements.map((row) => [row.employee_id, row.acknowledged_at]));

        return {
            policy: { id: policy.id, title: policy.title, requires_acknowledgement: policy.requires_acknowledgement },
            acknowledged: employees.filter((e) => byEmployee.has(e.id))
                .map((e) => ({ ...e, acknowledged_at: byEmployee.get(e.id) })),
            pending: employees.filter((e) => !byEmployee.has(e.id)),
        };
    }

    /** Policies an employee can see, with their own acknowledgement state. */
    async policiesForEmployee(tenantId: string, employeeId: string) {
        const [policies, mine] = await Promise.all([
            this.listPolicies(tenantId, { publishedOnly: true }),
            this.db.policyAcknowledgement.findMany({
                where: { tenant_id: tenantId, employee_id: employeeId },
                select: { policy_id: true, acknowledged_at: true },
            }),
        ]);

        const acknowledged = new Map(mine.map((row) => [row.policy_id, row.acknowledged_at]));
        return policies.map((policy) => ({
            ...policy,
            acknowledged_at: acknowledged.get(policy.id) ?? null,
        }));
    }

    async acknowledgePolicy(tenantId: string, employeeId: string, policyId: string) {
        const policy = await this.db.policy.findFirst({
            where: { id: policyId, tenant_id: tenantId, deleted_at: null, published_at: { not: null } },
        });
        if (!policy) throw new NotFoundException('Policy not found.');

        // Upsert rather than create: acknowledging twice is a double tap, not
        // an error, and a 500 on it would be baffling.
        return this.db.policyAcknowledgement.upsert({
            where: { policy_id_employee_id: { policy_id: policyId, employee_id: employeeId } },
            create: { tenant_id: tenantId, policy_id: policyId, employee_id: employeeId },
            update: {},
        });
    }

    // ── Employee documents (Phase 10) ─────────────────────────────────────────

    async listDocuments(tenantId: string, employeeId: string) {
        return this.db.employeeDocument.findMany({
            where: { tenant_id: tenantId, employee_id: employeeId, deleted_at: null },
            orderBy: { created_at: 'desc' },
        });
    }

    async addDocument(
        tenantId: string,
        employeeId: string,
        dto: { kind?: string; title: string; expires_on?: string },
        file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
        uploadedBy?: string,
    ) {
        const employee = await this.db.employee.findFirst({
            where: { id: employeeId, tenant_id: tenantId, deleted_at: null },
        });
        if (!employee) throw new NotFoundException('Employee not found.');

        if (!EmployeeRecordsService.ALLOWED_MIME.has(file.mimetype)) {
            throw new BadRequestException('A document must be a JPEG, PNG, WebP, HEIC or PDF.');
        }
        if (file.size > EmployeeRecordsService.MAX_BYTES) {
            throw new BadRequestException('A document must be 10MB or smaller.');
        }

        const uploaded = await this.assets.uploadBuffer(
            file.buffer,
            `employee-documents/${tenantId}`,
            file.originalname.replace(/\.[^.]+$/, ''),
            file.mimetype === 'application/pdf' ? 'raw' : 'image',
        );

        return this.db.employeeDocument.create({
            data: {
                tenant_id: tenantId,
                employee_id: employeeId,
                kind: dto.kind ?? 'OTHER',
                title: dto.title,
                file_url: uploaded.url,
                file_name: file.originalname,
                mime_type: file.mimetype,
                file_size: uploaded.bytes ?? file.size,
                storage_key: uploaded.publicId,
                expires_on: dto.expires_on ? this.toDateOnly(dto.expires_on) : null,
                uploaded_by: uploadedBy ?? null,
            },
        });
    }

    async deleteDocument(tenantId: string, id: string) {
        const document = await this.db.employeeDocument.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });
        if (!document) throw new NotFoundException('Document not found.');

        // Purge the file first, same ordering as expense receipts: a failure
        // must leave a row pointing at a live file rather than the reverse.
        if (document.storage_key) {
            await this.assets.deleteFile(document.storage_key).catch(() => undefined);
        }

        return this.db.employeeDocument.update({ where: { id }, data: { deleted_at: new Date() } });
    }

    /**
     * Documents expiring within `days`, for the reminder cron.
     *
     * Excludes anything already notified, so a daily cron does not send the
     * same reminder every morning until the document expires.
     */
    async expiringDocuments(tenantId: string, days = 30) {
        const horizon = new Date();
        horizon.setUTCDate(horizon.getUTCDate() + days);

        return this.db.employeeDocument.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                expires_on: { not: null, lte: this.toDateOnly(horizon) },
                expiry_notified_at: null,
            },
            include: { employee: { select: { id: true, name: true, employee_code: true } } },
            orderBy: { expires_on: 'asc' },
        });
    }

    async markExpiryNotified(tenantId: string, ids: string[]) {
        if (ids.length === 0) return { count: 0 };
        return this.db.employeeDocument.updateMany({
            where: { tenant_id: tenantId, id: { in: ids } },
            data: { expiry_notified_at: new Date() },
        });
    }
}
