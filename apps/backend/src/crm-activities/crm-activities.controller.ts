import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
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
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CrmActivitiesService } from './crm-activities.service';
import {
    CompleteCrmActivityDto,
    CreateCrmActivityDto,
    UpdateCrmActivityDto,
} from './crm-activities.dto';

@Controller('crm/activities')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmActivitiesController {
    constructor(private readonly service: CrmActivitiesService) {}

    // Declared before @Get(':id') — Nest matches routes in declaration order, so
    // the parameterised route would otherwise swallow /summary as an id.
    @Get('summary')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    summary(@Tenant() tenant: TenantContext) {
        return this.service.summary(tenant.tenantId);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateCrmActivityDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('leadId') leadId?: string,
        @Query('customerId') customerId?: string,
        @Query('target') target?: 'lead' | 'customer',
        @Query('status') status?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('purposeId') purposeId?: string,
        @Query('channelId') channelId?: string,
        @Query('dueToday') dueToday?: string,
        @Query('overdue') overdue?: string,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            leadId,
            customerId,
            target,
            status,
            assignedTo,
            purposeId,
            channelId,
            dueToday: dueToday === 'true',
            overdue: overdue === 'true',
            createdFrom,
            createdTo,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            sortBy,
            sortDir,
        });
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_CRM_INTERACTIONS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateCrmActivityDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Post(':id/complete')
    @RequireStorePermission(StorePermission.CREATE_CRM_INTERACTIONS)
    complete(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CompleteCrmActivityDto,
    ) {
        return this.service.complete(tenant.tenantId, tenant.userId, id, dto);
    }

    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.cancel(tenant.tenantId, id);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_CRM_TASKS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
