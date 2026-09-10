import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CrmMessageTemplatesService } from './crm-message-templates.service';
import {
    CreateMessageTemplateDto,
    ListMessageTemplatesDto,
    UpdateMessageTemplateDto,
} from './message-template.dto';

@Controller('crm/message-templates')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CrmMessageTemplatesController {
    constructor(private readonly service: CrmMessageTemplatesService) {}

    /**
     * Readable by anyone who can log an activity — the Log and Schedule dialogs
     * both offer the list. Only the mutations require MANAGE_CRM_SETTINGS, which
     * matches how the CRM Setup lists next door are gated.
     */
    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: ListMessageTemplatesDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateMessageTemplateDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateMessageTemplateDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
    remove(@Tenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
