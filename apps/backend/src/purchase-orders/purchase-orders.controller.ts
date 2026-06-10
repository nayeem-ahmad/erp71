import { Body, Controller, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderStatusDto } from './purchase-order.dto';
import { PurchaseOrdersService } from './purchase-orders.service';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class PurchaseOrdersController {
    constructor(private readonly service: PurchaseOrdersService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseOrderDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext) {
        return this.service.findAll(tenant.tenantId);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id/status')
    updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderStatusDto) {
        return this.service.updateStatus(tenant.tenantId, id, dto);
    }

    @Get(':id/invoice')
    getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getInvoiceData(tenant.tenantId, id);
    }
}
