import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CrmInteractionsService } from './crm-interactions.service';
import { CreateInteractionDto, UpdateInteractionDto } from './crm-interactions.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('crm/interactions')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class CrmInteractionsController {
    constructor(private readonly service: CrmInteractionsService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateInteractionDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('customerId') customerId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            customerId,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateInteractionDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
