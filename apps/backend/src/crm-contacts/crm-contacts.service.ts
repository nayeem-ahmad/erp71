import { createRequire } from 'module';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import {
    BadRequestException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { AiService, type BusinessCardScanResult } from '../ai/ai.service';
import { AssetsService } from '../assets/assets.service';
import { CrmPhotosService } from '../crm-photos/crm-photos.service';
import {
    AddContactAttachmentDto,
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
import {
    applyColumnFilters,
    codesContaining,
    containsInsensitive,
    type FilterableMap,
} from '../common/column-filter.util';
import { createdAtRange } from '../common/created-range.util';
import { parseImageUpload } from '../common/image-upload.util';
import {
    leadIdentityOf,
    leadIdentityPatch,
    normalizeLeadMobile,
    normalizeProfileUrl,
} from '@erp71/shared-types';

// A static import of this file pulls it into the Nest program. tsc then treats
// the repo as rootDir and emits dist/apps/backend/src/main.js instead of
// dist/src/main.js. The function itself is still organizationNameNorm.
function loadOrganizationNameNorm(): (raw: string) => string {
    const requirePlan = createRequire(__filename);
    let dir = __dirname;
    for (let i = 0; i < 8; i += 1) {
        const file = join(dir, 'packages/database/prisma/crm-identity-plan.ts');
        if (existsSync(file)) {
            return requirePlan(file).organizationNameNorm as (raw: string) => string;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error('organizationNameNorm could not be loaded from crm-identity-plan.ts');
}

const organizationNameNorm = loadOrganizationNameNorm();

const attachmentIncludes = {
    creator: { select: { id: true, name: true, email: true } },
} as const;

const contactIncludes = {
    assignee: { select: { id: true, name: true, email: true } },
    creator: { select: { id: true, name: true, email: true } },
    attachments: {
        orderBy: { created_at: 'desc' },
        include: attachmentIncludes,
    },
} as const;

/** Columns of the contacts table that take an advanced filter, by the table's column id. */
const CONTACT_FILTERABLE: FilterableMap<Prisma.CrmContactWhereInput> = {
    name: (v) => ({ name: containsInsensitive(v) }),
    company: (v) => ({ company: containsInsensitive(v) }),
    designation: (v) => ({ designation: containsInsensitive(v) }),
    mobile: (v) => ({ mobile: containsInsensitive(v) }),
    email: (v) => ({ email: containsInsensitive(v) }),
    capture_source: (v) => ({
        capture_source: { in: codesContaining(Object.values(CrmContactCaptureSource), v) },
    }),
    assignee: (v) => ({ assignee: { name: containsInsensitive(v) } }),
};

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
    'photo_url',
] as const;

type OptionalTextField = (typeof OPTIONAL_TEXT_FIELDS)[number];

@Injectable()
export class CrmContactsService {
    constructor(
        private db: DatabaseService,
        private ai: AiService,
        private assets: AssetsService,
        private photos: CrmPhotosService,
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

    /**
     * Email is not an identity key. A null norm still matches when the raw
     * value normalizes to the same mobile or LinkedIn profile. A value that
     * does not normalize (`N/A`, blank) is not a match.
     */
    private async assertNormalizedFree(
        tenantId: string,
        kind: 'mobile' | 'linkedin',
        norm: string | null,
        exceptId?: string,
    ) {
        if (!norm) return;

        const normField = kind === 'mobile' ? 'mobile_norm' : 'linkedin_norm';
        const rawField = kind === 'mobile' ? 'mobile' : 'linkedin_url';
        const rows = await this.db.crmContact.findMany({
            where: {
                tenant_id: tenantId,
                ...(exceptId ? { id: { not: exceptId } } : {}),
                OR: [{ [normField]: norm }, { [normField]: null, [rawField]: { not: null } }],
            },
            select: { id: true, mobile: true, mobile_norm: true, linkedin_url: true, linkedin_norm: true },
        });

        const clash = rows.some((row) => {
            if (exceptId && row.id === exceptId) return false;
            const stored = row[normField];
            if (stored) return stored === norm;
            const raw =
                kind === 'mobile' ? normalizeLeadMobile(row.mobile) : normalizeProfileUrl(row.linkedin_url);
            return raw === norm;
        });
        if (!clash) return;

        throw new BadRequestException(
            kind === 'mobile'
                ? 'A contact with this mobile number already exists.'
                : 'A contact with this LinkedIn profile already exists.',
        );
    }

    /**
     * The company string stays on the contact. A non-empty value finds or
     * creates the organization by `name_norm` and never renames an existing
     * row. Blank clears the link and leaves the organization in place.
     * `undefined` means the patch did not mention company.
     */
    private async organizationIdForCompany(
        tenantId: string,
        company: string | null | undefined,
    ): Promise<string | null | undefined> {
        if (company === undefined) return undefined;
        if (!company) return null;

        const nameNorm = organizationNameNorm(company);
        if (!nameNorm) return null;

        const where = { tenant_id_name_norm: { tenant_id: tenantId, name_norm: nameNorm } };
        const existing = await this.db.organization.findUnique({ where, select: { id: true } });
        if (existing) return existing.id;

        try {
            const created = await this.db.organization.create({
                data: { tenant_id: tenantId, name: company, name_norm: nameNorm },
                select: { id: true },
            });
            return created.id;
        } catch (error) {
            // Two saves can insert the same name_norm together. The row that
            // won keeps its display name; this save only borrows the id.
            if ((error as { code?: string } | null)?.code !== 'P2002') throw error;
            const raced = await this.db.organization.findUnique({ where, select: { id: true } });
            if (!raced) throw error;
            return raced.id;
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

        const text = this.mapTextFields(dto);
        const mobile = this.normalizeMobile(dto.mobile);
        if (mobile) await this.assertMobileFree(tenantId, mobile);
        await this.assertNormalizedFree(tenantId, 'mobile', normalizeLeadMobile(dto.mobile));
        await this.assertNormalizedFree(tenantId, 'linkedin', normalizeProfileUrl(dto.linkedin_url));

        const organizationId = await this.organizationIdForCompany(
            tenantId,
            Object.prototype.hasOwnProperty.call(text, 'company') ? text.company : undefined,
        );
        const photoKey = this.resolvePhotoKey(tenantId, dto.photo_storage_key);

        return this.db.crmContact.create({
            data: {
                tenant_id: tenantId,
                name,
                mobile: mobile ?? null,
                ...text,
                ...leadIdentityOf(dto),
                ...(organizationId !== undefined ? { organization_id: organizationId } : {}),
                capture_source: dto.capture_source ?? CrmContactCaptureSource.MANUAL,
                // `|| null`, not `?? null`: the form posts an empty string for
                // "unassigned", and an empty string in an FK column is a
                // constraint violation rather than an absent owner.
                assigned_to: dto.assigned_to || null,
                photo_storage_key: photoKey ?? null,
                created_by: userId,
            },
            include: contactIncludes,
        });
    }

    async findAll(tenantId: string, opts: ListContactsDto & { timezone: string }) {
        const page = opts.page ?? 1;
        const limit = Math.min(opts.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: Record<string, unknown> = { tenant_id: tenantId };
        const created = createdAtRange(opts.createdFrom, opts.createdTo, opts.timezone);
        if (created) where.created_at = created;
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

        const filtered = applyColumnFilters(where, opts.filters, CONTACT_FILTERABLE);

        const [items, total] = await Promise.all([
            this.db.crmContact.findMany({
                where: filtered,
                include: contactIncludes,
                orderBy: resolveOrderBy(opts.sortBy, opts.sortDir, CONTACT_SORTABLE, CONTACT_DEFAULT_ORDER),
                skip,
                take: limit,
            }),
            this.db.crmContact.count({ where: filtered }),
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

    async listAttachments(tenantId: string, contactId: string) {
        await this.assertContact(tenantId, contactId);
        return this.db.crmContactAttachment.findMany({
            where: { tenant_id: tenantId, contact_id: contactId },
            orderBy: { created_at: 'desc' },
            include: attachmentIncludes,
        });
    }

    /**
     * Keep the card image against a contact that already exists.
     *
     * Split from contact creation on purpose: an upload to a third party can
     * fail or hang, and a contact the user has already typed must not be lost
     * because a CDN was having a bad minute. The caller saves the contact first
     * and attaches afterwards, so the worst case is a contact without its card.
     */
    async addAttachment(
        tenantId: string,
        userId: string | undefined,
        contactId: string,
        dto: AddContactAttachmentDto,
    ) {
        await this.assertContact(tenantId, contactId);

        const { buffer, mimeType } = parseImageUpload(dto.imageBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            // Distinguishable from a transient failure: this one will not fix
            // itself on retry, and the operator needs to know why.
            throw new ServiceUnavailableException(
                'File storage is not configured, so the card image could not be kept.',
            );
        }

        const stem = (dto.fileName ?? 'business-card').replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem = stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'business-card';

        let stored: { url: string; publicId: string; bytes: number };
        try {
            stored = await this.assets.uploadBuffer(buffer, `${tenantId}/contact-cards`, safeStem);
        } catch {
            throw new ServiceUnavailableException(
                'The card image could not be uploaded. The contact was saved without it.',
            );
        }

        return this.db.crmContactAttachment.create({
            data: {
                tenant_id: tenantId,
                contact_id: contactId,
                file_url: stored.url,
                file_name: `${safeStem}.${mimeType.split('/')[1] ?? 'jpg'}`,
                mime_type: mimeType,
                file_size: stored.bytes ?? buffer.byteLength,
                storage_key: stored.publicId,
                kind: 'BUSINESS_CARD',
                created_by: userId,
            },
            include: attachmentIncludes,
        });
    }

    async removeAttachment(tenantId: string, contactId: string, attachmentId: string) {
        const existing = await this.db.crmContactAttachment.findFirst({
            where: { id: attachmentId, contact_id: contactId, tenant_id: tenantId },
            select: { id: true, storage_key: true },
        });
        if (!existing) throw new NotFoundException('Attachment not found');

        await this.db.crmContactAttachment.delete({ where: { id: existing.id } });
        // After the row, not before: a failed delete here is a stray file, while
        // a failed delete the other way round is a row pointing at nothing.
        if (existing.storage_key) await this.assets.deleteFile(existing.storage_key);

        return { success: true };
    }

    private async assertContact(tenantId: string, contactId: string) {
        const contact = await this.db.crmContact.findFirst({
            where: { id: contactId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!contact) throw new NotFoundException('Contact not found');
        return contact;
    }

    /**
     * Drop the stored files for contacts about to be deleted.
     *
     * The rows go on their own via `onDelete: Cascade`, but Cloudinary knows
     * nothing about that — without this every deleted contact leaves its card
     * behind, billed forever.
     */
    private async purgeAttachmentAssets(tenantId: string, contactIds: string[]) {
        if (!contactIds.length) return;
        const rows = await this.db.crmContactAttachment.findMany({
            where: { tenant_id: tenantId, contact_id: { in: contactIds } },
            select: { storage_key: true },
        });
        await Promise.all(
            rows
                .map((row) => row.storage_key)
                .filter((key): key is string => !!key)
                .map((key) => this.assets.deleteFile(key)),
        );
    }

    /**
     * Normalise the photo key and refuse one that is not this tenant's.
     *
     * Returns `undefined` when the field was absent (leave it alone), `null`
     * when it was explicitly cleared, and the key otherwise.
     */
    private resolvePhotoKey(
        tenantId: string,
        key: string | undefined,
    ): string | null | undefined {
        if (key === undefined) return undefined;
        const trimmed = key.trim();
        if (!trimmed) return null;
        this.photos.assertTenantPhotoKey(tenantId, trimmed);
        return trimmed;
    }

    /**
     * Drop the Cloudinary photos for contacts about to be deleted. The rows go
     * on their own via cascade, but Cloudinary knows nothing about that.
     */
    private async purgePhotoAssets(tenantId: string, contactIds: string[]) {
        if (!contactIds.length) return;
        const rows = await this.db.crmContact.findMany({
            where: { tenant_id: tenantId, id: { in: contactIds } },
            select: { photo_storage_key: true },
        });
        await Promise.all(
            rows
                .map((row) => row.photo_storage_key)
                .filter((key): key is string => !!key)
                .map((key) => this.assets.deleteFile(key)),
        );
    }

    async update(tenantId: string, id: string, dto: UpdateContactDto) {
        const existing = await this.db.crmContact.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true, photo_storage_key: true },
        });
        if (!existing) throw new NotFoundException('Contact not found');

        const data: Record<string, unknown> = {
            ...this.mapTextFields(dto),
            ...leadIdentityPatch(dto),
        };

        if (dto.name !== undefined) {
            const name = dto.name.trim();
            if (!name) throw new BadRequestException('Name is required.');
            data.name = name;
        }

        const mobile = this.normalizeMobile(dto.mobile);
        if (mobile !== undefined) {
            if (mobile) await this.assertMobileFree(tenantId, mobile, id);
            await this.assertNormalizedFree(tenantId, 'mobile', normalizeLeadMobile(mobile), id);
            data.mobile = mobile;
        }

        if (dto.linkedin_url !== undefined) {
            await this.assertNormalizedFree(
                tenantId,
                'linkedin',
                normalizeProfileUrl(dto.linkedin_url),
                id,
            );
        }

        if (dto.company !== undefined) {
            data.organization_id = await this.organizationIdForCompany(
                tenantId,
                (data.company as string | null) ?? null,
            );
        }

        if (dto.assigned_to !== undefined) {
            data.assigned_to = dto.assigned_to || null;
        }

        const photoKey = this.resolvePhotoKey(tenantId, dto.photo_storage_key);
        if (photoKey !== undefined) data.photo_storage_key = photoKey;

        const updated = await this.db.crmContact.update({
            where: { id },
            data,
            include: contactIncludes,
        });

        // After the row, not before: a failed delete here leaves a stray file,
        // while a failed delete the other way round leaves a row pointing at
        // nothing. Only when the key actually changed — re-saving a form with
        // an untouched photo must not delete the photo it is still using.
        if (
            photoKey !== undefined &&
            existing.photo_storage_key &&
            existing.photo_storage_key !== photoKey
        ) {
            await this.assets.deleteFile(existing.photo_storage_key);
        }

        return updated;
    }

    async remove(tenantId: string, id: string) {
        const existing = await this.db.crmContact.findFirst({
            where: { id, tenant_id: tenantId },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('Contact not found');
        await this.purgeAttachmentAssets(tenantId, [id]);
        await this.purgePhotoAssets(tenantId, [id]);
        await this.db.crmContact.delete({ where: { id } });
        return { success: true };
    }

    async bulkAction(tenantId: string, dto: BulkContactActionDto) {
        const where = { tenant_id: tenantId, id: { in: dto.ids } };

        if (dto.action === ContactBulkAction.DELETE) {
            await this.purgeAttachmentAssets(tenantId, dto.ids);
            await this.purgePhotoAssets(tenantId, dto.ids);
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
