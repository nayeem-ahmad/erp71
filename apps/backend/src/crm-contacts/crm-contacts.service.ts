import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AiService, type BusinessCardScanResult } from '../ai/ai.service';
import {
    BulkContactActionDto,
    ContactBulkAction,
    CreateContactDto,
    CrmContactCaptureSource,
    ListContactsDto,
    ScanBusinessCardDto,
    UpdateContactDto,
} from './crm-contacts.dto';
import { paginate } from '../common/pagination.dto';
import { runImport, ImportResult } from '../common/import.util';
import { resolveOrderBy, SortableMap } from '../common/sort.util';

const contactIncludes = {
    assignee: { select: { id: true, name: true, email: true } },
    creator: { select: { id: true, name: true, email: true } },
} as const;

const CONTACT_SORTABLE: SortableMap = {
    name: (dir) => ({ name: dir }),
    company: (dir) => ({ company: dir }),
    designation: (dir) => ({ designation: dir }),
    email: (dir) => ({ email: dir }),
    created_at: (dir) => ({ created_at: dir }),
};
const CONTACT_DEFAULT_ORDER = [{ name: 'asc' as const }];

/** Fields a contact carries beyond its name, in the order the form shows them. */
const OPTIONAL_TEXT_FIELDS = [
    'company',
    'designation',
    'mobile',
    'phone',
    'email',
    'address',
    'website_url',
    'linkedin_url',
    'notes',
] as const;

type OptionalTextField = (typeof OPTIONAL_TEXT_FIELDS)[number];

@Injectable()
export class CrmContactsService {
    constructor(
        private db: DatabaseService,
        private ai: AiService,
    ) {}

    /**
     * A blank mobile has to reach the column as NULL, not as `''`: the dedupe
     * index treats NULLs as distinct but would collide on a second empty string,
     * so two contacts without a phone number would fight over the same slot.
     */
    private normalizeMobile(mobile: string | undefined): string | null | undefined {
        if (mobile === undefined) return undefined;
        const trimmed = mobile.trim();
        return trimmed === '' ? null : trimmed;
    }

    private async assertMobileFree(tenantId: string, mobile: string, exceptId?: string) {
        const existing = await this.db.crmContact.findUnique({
            where: { tenant_id_mobile: { tenant_id: tenantId, mobile } },
            select: { id: true },
        });
        if (existing && existing.id !== exceptId) {
            throw new BadRequestException('A contact with this mobile number already exists.');
        }
    }

    /** Trim the optional text fields present in a patch, mapping blanks to NULL. */
    private mapTextFields(dto: CreateContactDto | UpdateContactDto): Record<string, string | null> {
        const data: Record<string, string | null> = {};
        for (const field of OPTIONAL_TEXT_FIELDS) {
            const value = (dto as Record<string, unknown>)[field];
            if (value === undefined) continue;
            const trimmed = String(value ?? '').trim();
            data[field] = trimmed === '' ? null : trimmed;
        }
        return data;
    }

    async create(tenantId: string, userId: string, dto: CreateContactDto) {
        const name = dto.name?.trim();
        if (!name) throw new BadRequestException('Name is required.');

        const mobile = this.normalizeMobile(dto.mobile);
        if (mobile) await this.assertMobileFree(tenantId, mobile);

        return this.db.crmContact.create({
            data: {
                tenant_id: tenantId,
                name,
                mobile: mobile ?? null,
                ...this.mapTextFields(dto),
                capture_source: dto.capture_source ?? CrmContactCaptureSource.MANUAL,
                // `|| null`, not `?? null`: the form posts an empty string for
                // "unassigned", and an empty string in an FK column is a
                // constraint violation rather than an absent owner.
                assigned_to: dto.assigned_to || null,
                created_by: userId,
            },
            include: contactIncludes,
        });
    }

    async findAll(tenantId: string, opts: ListContactsDto) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: Record<string, unknown> = { tenant_id: tenantId };
        if (opts.company) where.company = { contains: opts.company, mode: 'insensitive' };
        if (opts.assignedTo) where.assigned_to = opts.assignedTo;
        if (opts.captureSource) where.capture_source = opts.captureSource;
        if (opts.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { company: { contains: opts.search, mode: 'insensitive' } },
                { designation: { contains: opts.search, mode: 'insensitive' } },
                { mobile: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search, mode: 'insensitive' } },
                { email: { contains: opts.search, mode: 'insensitive' } },
                { notes: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.crmContact.findMany({
                where,
                include: contactIncludes,
                orderBy: resolveOrderBy(opts.sortBy, opts.sortDir, CONTACT_SORTABLE, CONTACT_DEFAULT_ORDER),
                skip,
                take: limit,
            }),
            this.db.crmContact.count({ where }),
        ]);

        return paginate(items, total, page, limit);
    }

    async findOne(tenantId: string, id: string) {
        const contact = await this.db.crmContact.findFirst({
            where: { id, tenant_id: tenantId },
            include: contactIncludes,
        });
        if (!contact) throw new NotFoundException('Contact not found');
        return contact;
    }

    async update(tenantId: string, id: string, dto: UpdateContactDto) {
        const existing = await this.db.crmContact.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('Contact not found');

        const data: Record<string, unknown> = this.mapTextFields(dto);

        if (dto.name !== undefined) {
            const name = dto.name.trim();
            if (!name) throw new BadRequestException('Name is required.');
            data.name = name;
        }

        const mobile = this.normalizeMobile(dto.mobile);
        if (mobile !== undefined) {
            if (mobile) await this.assertMobileFree(tenantId, mobile, id);
            data.mobile = mobile;
        }

        if (dto.assigned_to !== undefined) {
            data.assigned_to = dto.assigned_to || null;
        }

        return this.db.crmContact.update({
            where: { id },
            data,
            include: contactIncludes,
        });
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmContact.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('Contact not found');
        await this.db.crmContact.delete({ where: { id } });
        return { success: true };
    }

    async bulkAction(tenantId: string, dto: BulkContactActionDto) {
        const where = { tenant_id: tenantId, id: { in: dto.ids } };

        if (dto.action === ContactBulkAction.DELETE) {
            const res = await this.db.crmContact.deleteMany({ where });
            return { count: res.count };
        }

        if (dto.action === ContactBulkAction.ASSIGN) {
            const assignee = dto.value && dto.value.trim() ? dto.value.trim() : null;
            const res = await this.db.crmContact.updateMany({ where, data: { assigned_to: assignee } });
            return { count: res.count };
        }

        throw new BadRequestException('Unsupported bulk action.');
    }

    /**
     * Read a business card photo and return the fields on it. Nothing is
     * written — the client shows the result in the create form so a human can
     * correct the OCR before it becomes a contact.
     */
    async scanBusinessCard(tenantId: string, dto: ScanBusinessCardDto): Promise<{
        fields: BusinessCardScanResult;
        capture_source: CrmContactCaptureSource;
    }> {
        const fields = await this.ai.scanBusinessCard(tenantId, {
            imageBase64: dto.imageBase64,
            mimeType: dto.mimeType,
        });

        // A card with nothing readable on it is a failed scan, not an empty
        // contact: returning {} would leave the user staring at a blank form
        // with no idea whether the request even ran.
        if (!Object.keys(fields).length) {
            throw new BadRequestException(
                'No contact details could be read from that image. Try a sharper, well-lit photo of the card.',
            );
        }

        return { fields, capture_source: CrmContactCaptureSource.BUSINESS_CARD };
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        const text = (value: unknown): string | null => {
            if (value === undefined || value === null) return null;
            const trimmed = String(value).trim();
            return trimmed === '' ? null : trimmed;
        };

        return runImport<{ name: string } & Record<OptionalTextField | 'mobile', string | null>>(
            rows,
            mode,
            tenantId,
            {
                requiredFields: ['name'],
                castRow: (raw) =>
                    OPTIONAL_TEXT_FIELDS.reduce(
                        (acc, field) => ({ ...acc, [field]: text(raw[field]) }),
                        { name: String(raw.name ?? '').trim(), mobile: text(raw.mobile) },
                    ) as { name: string } & Record<OptionalTextField | 'mobile', string | null>,
                findDuplicate: async (row) => {
                    if (!row.mobile) return null;
                    const existing = await this.db.crmContact.findUnique({
                        where: { tenant_id_mobile: { tenant_id: tenantId, mobile: row.mobile } },
                        select: { id: true },
                    });
                    return existing?.id ?? null;
                },
                create: async (row) => {
                    await this.db.crmContact.create({
                        data: {
                            tenant_id: tenantId,
                            name: row.name,
                            company: row.company,
                            designation: row.designation,
                            mobile: row.mobile,
                            phone: row.phone,
                            email: row.email,
                            address: row.address,
                            website_url: row.website_url,
                            linkedin_url: row.linkedin_url,
                            notes: row.notes,
                            capture_source: CrmContactCaptureSource.IMPORT,
                        },
                    });
                },
                update: async (id, row) => {
                    // A blank cell means "not supplied", not "erase what is there":
                    // a spreadsheet re-import that only fills in emails must not
                    // wipe every other column it left empty.
                    await this.db.crmContact.update({
                        where: { id },
                        data: {
                            name: row.name,
                            ...OPTIONAL_TEXT_FIELDS.reduce<Record<string, string>>((acc, field) => {
                                if (row[field]) acc[field] = row[field] as string;
                                return acc;
                            }, {}),
                        },
                    });
                },
            },
        );
    }
}
