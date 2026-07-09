import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmTasksService } from './crm-tasks.service';
import { CreateCrmTaskDto, UpdateCrmTaskDto } from './crm-tasks.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('crm/tasks')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmTasksController {
    constructor(private readonly service: CrmTasksService) {}

    @Get('summary')
    getTodaySummary(@Tenant() tenant: TenantContext) {
        return this.service.getTodaySummary(tenant.tenantId);
    }

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateCrmTaskDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('customerId') customerId?: string,
        @Query('leadId') leadId?: string,
        @Query('target') target?: 'customer' | 'lead',
        @Query('status') status?: string,
        @Query('dueToday') dueToday?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            customerId,
            leadId,
            target,
            status,
            dueToday: dueToday === 'true',
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCrmTaskDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
