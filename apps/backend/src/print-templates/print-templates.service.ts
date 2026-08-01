import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    CreatePrintTemplateDto,
    PrintDocType,
    PrintTemplateResponseDto,
    ResolvedPrintTemplateDto,
    UpdatePrintTemplateDto,
} from './print-templates.dto';

const DEFAULT_ACCENT = '#1d4ed8';

@Injectable()
export class PrintTemplatesService {
    constructor(private readonly db: DatabaseService) { }

    async list(tenantId: string): Promise<PrintTemplateResponseDto[]> {
        const templates = await this.db.printTemplate.findMany({
            where: { tenant_id: tenantId },
            orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
        });
        return templates.map((template) => this.mapToResponse(template));
    }

    async get(tenantId: string, id: string): Promise<PrintTemplateResponseDto> {
        const template = await this.db.printTemplate.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!template) throw new NotFoundException('Print template not found');
        return this.mapToResponse(template);
    }

    async create(
        tenantId: string,
        dto: CreatePrintTemplateDto,
    ): Promise<PrintTemplateResponseDto> {
        // The first template a tenant creates becomes the default, so printing
        // never falls back to branding once one exists.
        const existing = await this.db.printTemplate.count({ where: { tenant_id: tenantId } });
        const isDefault = dto.is_default ?? existing === 0;

        const template = await this.db.$transaction(async (tx) => {
            if (isDefault) await this.clearDefault(tx, tenantId);
            return tx.printTemplate.create({
                data: {
                    tenant_id: tenantId,
                    name: dto.name,
                    is_default: isDefault,
                    doc_types: dto.doc_types ?? [],
                    config: dto.config as unknown as object,
                },
            });
        });

        return this.mapToResponse(template);
    }

    async update(
        tenantId: string,
        id: string,
        dto: UpdatePrintTemplateDto,
    ): Promise<PrintTemplateResponseDto> {
        const existing = await this.db.printTemplate.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('Print template not found');

        const template = await this.db.$transaction(async (tx) => {
            if (dto.is_default) await this.clearDefault(tx, tenantId, id);
            return tx.printTemplate.update({
                where: { id },
                data: {
                    ...(dto.name !== undefined ? { name: dto.name } : {}),
                    ...(dto.is_default !== undefined ? { is_default: dto.is_default } : {}),
                    ...(dto.doc_types !== undefined ? { doc_types: dto.doc_types } : {}),
                    ...(dto.config !== undefined ? { config: dto.config as unknown as object } : {}),
                },
            });
        });

        return this.mapToResponse(template);
    }

    async remove(tenantId: string, id: string): Promise<{ success: true }> {
        const existing = await this.db.printTemplate.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!existing) throw new NotFoundException('Print template not found');

        await this.db.$transaction(async (tx) => {
            await tx.printTemplate.delete({ where: { id } });

            // Never leave a tenant without a default: promote the next template.
            if (existing.is_default) {
                const next = await tx.printTemplate.findFirst({
                    where: { tenant_id: tenantId },
                    orderBy: { created_at: 'asc' },
                });
                if (next) {
                    await tx.printTemplate.update({
                        where: { id: next.id },
                        data: { is_default: true },
                    });
                }
            }
        });

        return { success: true };
    }

    /**
     * The header config to print a document with: the template assigned to that
     * document type, else the tenant default, else one derived from branding so
     * printing always has a sensible letterhead.
     */
    async resolve(tenantId: string, docType?: PrintDocType): Promise<ResolvedPrintTemplateDto> {
        const templates = await this.db.printTemplate.findMany({
            where: { tenant_id: tenantId },
        });

        const assigned = docType
            ? templates.find((template) => template.doc_types.includes(docType))
            : undefined;
        const match = assigned ?? templates.find((template) => template.is_default);

        if (match) {
            return {
                template_id: match.id,
                name: match.name,
                config: match.config as Record<string, unknown>,
            };
        }

        return {
            template_id: null,
            name: null,
            config: await this.brandingFallback(tenantId),
        };
    }

    /**
     * Partial config built from the tenant's branding — the same mapping as the
     * frontend's `headerConfigFromBranding`, applied server-side so any client
     * gets the logo without knowing about branding.
     */
    private async brandingFallback(tenantId: string): Promise<Record<string, unknown>> {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { brand_logo_url: true, brand_primary_color: true },
        });

        const color = this.isHexColor(tenant?.brand_primary_color)
            ? (tenant!.brand_primary_color as string)
            : DEFAULT_ACCENT;

        return {
            logo: { url: tenant?.brand_logo_url ?? undefined },
            company: { color },
            title: { color },
            rule: { color },
        };
    }

    private isHexColor(value: string | null | undefined): boolean {
        return !!value && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
    }

    /** Prisma's transaction client, narrowed to what this service uses. */
    private async clearDefault(
        tx: { printTemplate: { updateMany: DatabaseService['printTemplate']['updateMany'] } },
        tenantId: string,
        exceptId?: string,
    ): Promise<void> {
        await tx.printTemplate.updateMany({
            where: {
                tenant_id: tenantId,
                is_default: true,
                ...(exceptId ? { id: { not: exceptId } } : {}),
            },
            data: { is_default: false },
        });
    }

    private mapToResponse(template: {
        id: string;
        tenant_id: string;
        name: string;
        is_default: boolean;
        doc_types: string[];
        config: unknown;
        created_at: Date;
        updated_at: Date;
    }): PrintTemplateResponseDto {
        return {
            id: template.id,
            tenant_id: template.tenant_id,
            name: template.name,
            is_default: template.is_default,
            doc_types: template.doc_types,
            config: (template.config ?? {}) as Record<string, unknown>,
            created_at: template.created_at,
            updated_at: template.updated_at,
        };
    }
}
