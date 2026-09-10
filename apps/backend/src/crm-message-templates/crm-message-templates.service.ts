import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
    CreateMessageTemplateDto,
    ListMessageTemplatesDto,
    UpdateMessageTemplateDto,
} from './message-template.dto';

/** Case- and whitespace-insensitive key, so "Payment reminder" and "payment  reminder" collide. */
function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The relations the picker and the Setup list both render. */
const WITH_LINKS = {
    channel: { select: { id: true, name: true, icon: true } },
    purpose: { select: { id: true, name: true, icon: true } },
} as const;

/**
 * Tenant-owned canned messages for CRM activities.
 *
 * A template is text, not a touch — it has no target, no due date and never
 * lands on a timeline. Picking one fills the Log / Schedule form and the rep
 * edits from there, so `body` is stored exactly as typed: placeholders are
 * substituted in the browser at pick time, never here, and a template renamed
 * or retired later never rewrites an activity already logged from it.
 */
@Injectable()
export class CrmMessageTemplatesService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * `usage` and `channelId` are the picker's filters; Setup passes neither and
     * gets the tenant's whole list.
     *
     * A template with no channel is offered everywhere, so the channel filter is
     * "this channel OR none" rather than an equality match — otherwise narrowing
     * one template to WhatsApp would hide every generic one alongside it.
     */
    async list(tenantId: string, query: ListMessageTemplatesDto = {}) {
        return this.db.crmMessageTemplate.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.includeInactive ? {} : { is_active: true }),
                ...(query.usage ? { usage: { in: [query.usage, 'BOTH'] } } : {}),
                ...(query.channelId
                    ? { OR: [{ channel_id: query.channelId }, { channel_id: null }] }
                    : {}),
            },
            include: WITH_LINKS,
            orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        });
    }

    private async assertNameFree(tenantId: string, name: string, exceptId?: string) {
        // Checked in the app layer because the DB's @@unique([tenant_id, name])
        // is exact-match and would let "Payment reminder" sit beside "payment
        // reminder". Two admins racing on differently-cased names can still both
        // land; the cost is a duplicate row a tenant can rename, not corruption.
        const rows = await this.db.crmMessageTemplate.findMany({
            where: { tenant_id: tenantId, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true, name: true },
        });
        const target = normalizeName(name);
        if (rows.some((r) => normalizeName(r.name) === target)) {
            throw new ConflictException(`Message template "${name}" already exists.`);
        }
    }

    /**
     * Verify a channel / purpose link belongs to the caller's tenant.
     *
     * Deactivated rows are allowed through deliberately: a tenant that hides a
     * channel for a season should not have every template pointing at it refuse
     * to save. The picker filters on the channel actually chosen in the form, so
     * a template pinned to a hidden channel simply stops being offered.
     */
    private async assertLinksOwned(
        tenantId: string,
        links: { channel_id?: string | null; purpose_id?: string | null },
    ) {
        if (links.channel_id) {
            const channel = await this.db.conversationChannel.findFirst({
                where: { id: links.channel_id, tenant_id: tenantId },
                select: { id: true },
            });
            if (!channel) throw new BadRequestException('Conversation channel not found.');
        }
        if (links.purpose_id) {
            const purpose = await this.db.crmActivityPurpose.findFirst({
                where: { id: links.purpose_id, tenant_id: tenantId },
                select: { id: true },
            });
            if (!purpose) throw new BadRequestException('Activity purpose not found.');
        }
    }

    async create(tenantId: string, userId: string | undefined, dto: CreateMessageTemplateDto) {
        await this.assertNameFree(tenantId, dto.name);
        await this.assertLinksOwned(tenantId, dto);

        const max = await this.db.crmMessageTemplate.aggregate({
            where: { tenant_id: tenantId },
            _max: { sort_order: true },
        });

        return this.db.crmMessageTemplate.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                body: dto.body,
                subject: dto.subject || null,
                usage: dto.usage ?? 'BOTH',
                channel_id: dto.channel_id ?? null,
                purpose_id: dto.purpose_id ?? null,
                sort_order: dto.sort_order ?? (max._max.sort_order ?? 0) + 1,
                created_by: userId ?? null,
            },
            include: WITH_LINKS,
        });
    }

    private async findOwned(tenantId: string, id: string) {
        const row = await this.db.crmMessageTemplate.findFirst({
            where: { id, tenant_id: tenantId },
        });
        if (!row) throw new NotFoundException('Message template not found.');
        return row;
    }

    async update(tenantId: string, id: string, dto: UpdateMessageTemplateDto) {
        const row = await this.findOwned(tenantId, id);

        if (dto.name && dto.name !== row.name) {
            await this.assertNameFree(tenantId, dto.name, id);
        }
        await this.assertLinksOwned(tenantId, dto);

        return this.db.crmMessageTemplate.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.body !== undefined ? { body: dto.body } : {}),
                // `''` is how the form clears an optional subject, and that has to
                // reach the column rather than being skipped as "unchanged".
                ...(dto.subject !== undefined ? { subject: dto.subject || null } : {}),
                ...(dto.usage !== undefined ? { usage: dto.usage } : {}),
                ...(dto.channel_id !== undefined ? { channel_id: dto.channel_id } : {}),
                ...(dto.purpose_id !== undefined ? { purpose_id: dto.purpose_id } : {}),
                ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
                ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
            },
            include: WITH_LINKS,
        });
    }

    /**
     * A hard delete, unlike the taxonomy lists.
     *
     * Nothing references a template once it has been used — the composer copies
     * the words into the activity and the link ends there — so removing one
     * cannot orphan a row or blank a report. Tenants who want the text back
     * later have Hide (`is_active: false`) instead.
     */
    async remove(tenantId: string, id: string) {
        await this.findOwned(tenantId, id);
        await this.db.crmMessageTemplate.delete({ where: { id } });
        return { success: true };
    }
}
