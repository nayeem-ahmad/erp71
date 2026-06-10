import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreatePurchaseDto } from './purchase.dto';
import { PurchasesService } from './purchases.service';

@Controller('purchases')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class PurchasesController {
    constructor(private readonly purchasesService: PurchasesService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseDto) {
        return this.purchasesService.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext) {
        return this.purchasesService.findAll(tenant.tenantId);
    }

    @Get(':id/invoice')
    getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.getInvoiceData(tenant.tenantId, id);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.findOne(tenant.tenantId, id);
    }
}