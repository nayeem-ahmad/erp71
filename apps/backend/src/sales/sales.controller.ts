import { Controller, Post, Get, Body, Param, Query, UseGuards, UseInterceptors, Patch, Delete } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSaleDto, FinalizeSaleDto, UpdateSaleDto } from './sale.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('sales')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SalesController {
    constructor(private readonly salesService: SalesService) { }

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSaleDto) {
        return this.salesService.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('mine') mine?: string,
        @Query('search') search?: string,
        @Query('status') status?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
    ) {
        const mineOnly = mine === 'true' || mine === '1';
        return this.salesService.findAll(tenant.tenantId, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            createdBy: mineOnly ? tenant.userId : undefined,
            search: search || undefined,
            status: status || undefined,
            sortBy: sortBy || undefined,
            sortDir: sortDir || undefined,
        });
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.findOne(tenant.tenantId, id);
    }

    @Get(':id/invoice')
    async getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.getInvoiceData(tenant.tenantId, id);
    }

    @Post(':id/finalize')
    async finalize(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: FinalizeSaleDto,
    ) {
        return this.salesService.finalizeDraft(tenant.tenantId, tenant.userId, id, dto);
    }

    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSaleDto) {
        return this.salesService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.remove(tenant.tenantId, id);
    }
}
