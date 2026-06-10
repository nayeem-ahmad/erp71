import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { SalesReturnsService } from './sales-returns.service';
import { CreateSalesReturnDto, UpdateSalesReturnDto } from './sales-returns.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('sales-returns')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SalesReturnsController {
    constructor(private readonly returnsService: SalesReturnsService) {}

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalesReturnDto) {
        return this.returnsService.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    async findAll(@Tenant() tenant: TenantContext) {
        return this.returnsService.findAll(tenant.tenantId);
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.returnsService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSalesReturnDto) {
        return this.returnsService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.returnsService.remove(tenant.tenantId, id);
    }
}
