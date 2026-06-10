import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto, UpdateSalesOrderDto, UpdateOrderStatusDto, AddDepositDto } from './sales-orders.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('sales-orders')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SalesOrdersController {
    constructor(private readonly ordersService: SalesOrdersService) {}

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalesOrderDto) {
        return this.ordersService.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    async findAll(@Tenant() tenant: TenantContext) {
        return this.ordersService.findAll(tenant.tenantId);
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.ordersService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSalesOrderDto) {
        return this.ordersService.update(tenant.tenantId, id, dto);
    }

    @Patch(':id/status')
    async updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
        return this.ordersService.updateStatus(tenant.tenantId, id, dto);
    }

    @Post(':id/deposits')
    async addDeposit(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: AddDepositDto) {
        return this.ordersService.addDeposit(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.ordersService.remove(tenant.tenantId, id);
    }
}
