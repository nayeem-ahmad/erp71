import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateInventoryShrinkageDto } from './inventory-shrinkage.dto';
import { InventoryShrinkageService } from './inventory-shrinkage.service';

@Controller('inventory-shrinkage')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class InventoryShrinkageController {
    constructor(private readonly service: InventoryShrinkageService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateInventoryShrinkageDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        return this.service.findAll(tenant.tenantId, { timezone: tenant.timezone, createdFrom, createdTo });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }
}