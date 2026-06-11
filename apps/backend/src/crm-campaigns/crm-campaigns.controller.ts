import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmCampaignsService } from './crm-campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './crm-campaigns.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('crm/campaigns')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class CrmCampaignsController {
    constructor(private readonly service: CrmCampaignsService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateCampaignDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Get(':id/preview')
    previewRecipients(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.previewRecipients(tenant.tenantId, id);
    }

    @Post(':id/send')
    send(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.send(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
