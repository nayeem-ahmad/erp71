import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DEFAULT_DOCUMENT_REMIND_DAYS } from '@erp71/shared-types';
import { AssetsService } from '../assets/assets.service';
import { DatabaseService } from '../database/database.service';
import {
    CreateBusinessDocumentDto,
    UpdateBusinessDocumentDto,
    UploadBusinessDocumentFileDto,
} from './business-documents.dto';

/** What the vault keeps: a PDF, or a photo of the certificate. */
export const DOCUMENT_FILE_TYPES: Record<string, 'raw' | 'image'> = {
    'application/pdf': 'raw',
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/webp': 'image',
};

/**
 * Under the 5 MB JSON body limit with room for the envelope: about 3.4 MB of
 * file. A scanned licence is a few hundred KB; the browser shrinks photos.
 */
export const MAX_DOCUMENT_BASE64_LENGTH = 4_600_000;

export function businessDocumentFolder(tenantId: string): string {
    return `${tenantId}/business-documents`;
}

/**
 * Turn the browser's payload into bytes, checking the type by its content
 * as well as its label: a renamed .exe labelled `application/pdf` does not
 * start with `%PDF`.
 */
export function parseDocumentUpload(fileBase64: string, mimeType?: string): { buffer: Buffer; mimeType: string } {
    const raw = (fileBase64 ?? '').trim();
    if (!raw) throw new BadRequestException('No file was provided.');

    let data = raw;
    let resolved = (mimeType ?? '').trim().toLowerCase();
    const dataUrl = raw.match(/^data:([^;,]+);base64,(.*)$/s);
    if (dataUrl) {
        resolved = dataUrl[1].toLowerCase();
        data = dataUrl[2];
    }
    if (resolved === 'image/jpg') resolved = 'image/jpeg';
    if (!DOCUMENT_FILE_TYPES[resolved]) {
        throw new BadRequestException('Upload a PDF, or a JPEG, PNG or WebP picture.');
    }
    if (data.length > MAX_DOCUMENT_BASE64_LENGTH) {
        throw new BadRequestException('The file is too large. Keep it under 3 MB.');
    }
    const buffer = Buffer.from(data, 'base64');
    if (!buffer.byteLength) throw new BadRequestException('The file could not be read.');

    const head = buffer.subarray(0, 4);
    const looksRight =
        resolved === 'application/pdf'
            ? head.toString('latin1') === '%PDF'
            : resolved === 'image/png'
              ? head[0] === 0x89 && head[1] === 0x50
              : resolved === 'image/jpeg'
                ? head[0] === 0xff && head[1] === 0xd8
                : buffer.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!looksRight) throw new BadRequestException('The file does not match its type.');

    return { buffer, mimeType: resolved };
}

const dayOrNull = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00.000Z`) : null);
const dayString = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

export function serializeBusinessDocument<T extends { issue_date: Date | null; expiry_date: Date | null; storage_key?: string | null }>(row: T) {
    const { storage_key: _key, ...rest } = row;
    return { ...rest, issue_date: dayString(row.issue_date), expiry_date: dayString(row.expiry_date) };
}

@Injectable()
export class BusinessDocumentsService {
    private readonly logger = new Logger(BusinessDocumentsService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly assets: AssetsService,
    ) {}

    /** Soonest expiry first, then the ones that never expire. */
    async findAll(tenantId: string) {
        const rows = await this.db.businessDocument.findMany({
            where: { tenant_id: tenantId },
            orderBy: [{ expiry_date: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
            take: 500,
        });
        return rows.map(serializeBusinessDocument);
    }

    private async owned(tenantId: string, id: string) {
        const row = await this.db.businessDocument.findFirst({ where: { id, tenant_id: tenantId } });
        if (!row) throw new NotFoundException('Document not found.');
        return row;
    }

    async findOne(tenantId: string, id: string) {
        return serializeBusinessDocument(await this.owned(tenantId, id));
    }

    async create(tenantId: string, userId: string, dto: CreateBusinessDocumentDto) {
        const row = await this.db.businessDocument.create({
            data: {
                tenant_id: tenantId,
                doc_type: dto.docType,
                title: dto.title,
                number: dto.number ?? null,
                issuing_authority: dto.issuingAuthority ?? null,
                issue_date: dayOrNull(dto.issueDate),
                expiry_date: dayOrNull(dto.expiryDate),
                remind_days_before: dto.remindDaysBefore ?? DEFAULT_DOCUMENT_REMIND_DAYS,
                notes: dto.notes ?? null,
                created_by: userId,
            },
        });
        return serializeBusinessDocument(row);
    }

    async update(tenantId: string, id: string, dto: UpdateBusinessDocumentDto) {
        await this.owned(tenantId, id);
        const row = await this.db.businessDocument.update({
            where: { id },
            data: {
                ...(dto.docType !== undefined ? { doc_type: dto.docType } : {}),
                ...(dto.title !== undefined ? { title: dto.title } : {}),
                ...(dto.number !== undefined ? { number: dto.number } : {}),
                ...(dto.issuingAuthority !== undefined ? { issuing_authority: dto.issuingAuthority } : {}),
                ...(dto.issueDate !== undefined ? { issue_date: dayOrNull(dto.issueDate) } : {}),
                ...(dto.expiryDate !== undefined ? { expiry_date: dayOrNull(dto.expiryDate) } : {}),
                ...(dto.remindDaysBefore !== undefined ? { remind_days_before: dto.remindDaysBefore } : {}),
                ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
            },
        });
        return serializeBusinessDocument(row);
    }

    async remove(tenantId: string, id: string) {
        const row = await this.owned(tenantId, id);
        await this.db.businessDocument.delete({ where: { id } });
        // After the row: a failed destroy is a stray file, the other order a
        // row pointing at nothing.
        await this.destroyFile(row.storage_key, row.storage_type);
        return { id };
    }

    /** Attach (or replace) the scanned copy. The old file is destroyed once the new one is in. */
    async uploadFile(tenantId: string, id: string, dto: UploadBusinessDocumentFileDto) {
        const existing = await this.owned(tenantId, id);
        const { buffer, mimeType } = parseDocumentUpload(dto.fileBase64, dto.mimeType);

        if (!this.assets.isEnabled()) {
            throw new ServiceUnavailableException('File storage is not configured, so the file could not be kept.');
        }

        const resourceType = DOCUMENT_FILE_TYPES[mimeType];
        const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1];
        const stem = (dto.fileName ?? existing.title).replace(/\.[^.]+$/, '').slice(0, 100);
        const safeStem = stem.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';

        let stored: { url: string; publicId: string; bytes: number };
        try {
            // A raw upload keeps its extension only if the public id carries it.
            stored = await this.assets.uploadBuffer(
                buffer,
                businessDocumentFolder(tenantId),
                resourceType === 'raw' ? `${safeStem}.${extension}` : safeStem,
                resourceType,
            );
        } catch {
            throw new ServiceUnavailableException('The file could not be uploaded. Try again.');
        }

        const row = await this.db.businessDocument.update({
            where: { id },
            data: {
                file_url: stored.url,
                file_name: `${safeStem}.${extension}`,
                mime_type: mimeType,
                file_size: stored.bytes ?? buffer.byteLength,
                storage_key: stored.publicId,
                storage_type: resourceType,
            },
        });
        await this.destroyFile(existing.storage_key, existing.storage_type);
        return serializeBusinessDocument(row);
    }

    async removeFile(tenantId: string, id: string) {
        const existing = await this.owned(tenantId, id);
        const row = await this.db.businessDocument.update({
            where: { id },
            data: { file_url: null, file_name: null, mime_type: null, file_size: null, storage_key: null, storage_type: null },
        });
        await this.destroyFile(existing.storage_key, existing.storage_type);
        return serializeBusinessDocument(row);
    }

    private async destroyFile(storageKey: string | null, storageType: string | null) {
        if (!storageKey) return;
        try {
            await this.assets.deleteFile(storageKey, storageType === 'raw' ? 'raw' : 'image');
        } catch (error) {
            this.logger.warn(`Could not destroy document file ${storageKey}: ${error instanceof Error ? error.message : error}`);
        }
    }
}
