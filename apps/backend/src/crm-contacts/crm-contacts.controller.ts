import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CrmContactsService } from './crm-contacts.service';
import {
    AddContactAttachmentDto,
    BulkContactActionDto,
    CreateContactDto,
    ListContactsDto,
    ScanBusinessCardDto,
    UpdateContactDto,
} from './crm-contacts.dto';
import { ImportRowsDto } from '../common/import.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('crm/contacts')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmContactsController {
    constructor(private readonly service: CrmContactsService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateContactDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    /**
     * One card photo through the vision model. Throttled per user on top of the
     * tenant's AI credit ceiling: every call is a paid round-trip carrying a
     * multi-megabyte image, so a stuck retry loop is expensive in a way an
     * ordinary CRUD route is not.
     */
    @Post('scan-card')
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    scanCard(@Tenant() tenant: TenantContext, @Body() dto: ScanBusinessCardDto) {
        return this.service.scanBusinessCard(tenant.tenantId, dto);
    }

    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @Post('bulk-actions')
    bulkAction(@Tenant() tenant: TenantContext, @Body() dto: BulkContactActionDto) {
        return this.service.bulkAction(tenant.tenantId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListContactsDto) {
        return this.service.findAll(tenant.tenantId, { ...query, timezone: tenant.timezone });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Get(':id/attachments')
    listAttachments(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.listAttachments(tenant.tenantId, id);
    }

    /**
     * Keep the scanned card against a contact that already exists.
     *
     * Throttled like the scan route: the body carries an image, so a retry loop
     * here is a bandwidth and storage problem rather than an ordinary one.
     */
    @Post(':id/attachments')
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    addAttachment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AddContactAttachmentDto,
    ) {
        return this.service.addAttachment(tenant.tenantId, tenant.userId, id, dto);
    }

    @Delete(':id/attachments/:attachmentId')
    removeAttachment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('attachmentId') attachmentId: string,
    ) {
        return this.service.removeAttachment(tenant.tenantId, id, attachmentId);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateContactDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
