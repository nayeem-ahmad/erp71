import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmLeadsService } from './crm-leads.service';
import { CreateLeadDto, UpdateLeadDto } from './crm-leads.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('crm/leads')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmLeadsController {
    constructor(private readonly service: CrmLeadsService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateLeadDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('status') status?: string,
        @Query('source') source?: string,
        @Query('category') category?: string,
        @Query('priority') priority?: string,
        @Query('assignedTo') assignedTo?: string,
        @Query('myActionsToday') myActionsToday?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            status,
            source,
            category,
            priority,
            assignedTo,
            myActionsToday: myActionsToday === 'true',
            userId: tenant.userId,
            search,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Post(':id/convert')
    convert(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.convert(tenant.tenantId, id);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}