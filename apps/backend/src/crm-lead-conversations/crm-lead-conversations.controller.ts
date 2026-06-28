import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmLeadConversationsService } from './crm-lead-conversations.service';
import { CreateLeadConversationDto, UpdateLeadConversationDto } from './crm-lead-conversations.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('crm/lead-conversations')
@UseGuards(JwtAuthGuard, SubscriptionAccessGuard)
@RequiresFeature('premiumCrm')
@UseInterceptors(TenantInterceptor)
export class CrmLeadConversationsController {
    constructor(private readonly service: CrmLeadConversationsService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateLeadConversationDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('leadId') leadId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            leadId,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateLeadConversationDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}