import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmLeadConversationsService, FindAllConversationsOpts } from './crm-lead-conversations.service';
import {
    CreateLeadConversationDto,
    QueryLeadConversationsDto,
    UpdateLeadConversationDto,
} from './crm-lead-conversations.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CRM_STAFF, CRM_WRITE } from '../auth/permission-sets';
@Controller('crm/lead-conversations')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmLeadConversationsController {
    constructor(private readonly service: CrmLeadConversationsService) {}

    // Declared before @Get(':id') — Nest matches routes in declaration order, so the
    // parameterised route would otherwise swallow /summary as an id.
    @RequireAnyStorePermission(...CRM_STAFF)
    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext, @Query() query: QueryLeadConversationsDto) {
        return this.service.getSummary(tenant.tenantId, this.toOpts(tenant, query));
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateLeadConversationDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: QueryLeadConversationsDto) {
        return this.service.findAll(tenant.tenantId, this.toOpts(tenant, query));
    }

    /** `mine=true` resolves against the caller's own id, which never crosses the wire. */
    private toOpts(tenant: TenantContext, query: QueryLeadConversationsDto): FindAllConversationsOpts {
        return {
            timezone: tenant.timezone,
            leadId: query.leadId,
            search: query.search,
            type: query.type,
            direction: query.direction,
            createdBy: query.mine === 'true' ? tenant.userId : query.createdBy,
            dateFrom: query.dateFrom,
            dateTo: query.dateTo,
            leadStatus: query.leadStatus,
            leadAssignedTo: query.leadAssignedTo,
            page: query.page,
            limit: query.limit,
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        };
    }

    @RequireAnyStorePermission(...CRM_STAFF)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateLeadConversationDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...CRM_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}