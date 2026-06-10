import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreatePurchaseReturnDto, UpdatePurchaseReturnDto } from './purchase-return.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

@Controller('purchase-returns')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class PurchaseReturnsController {
    constructor(private readonly purchaseReturnsService: PurchaseReturnsService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseReturnDto) {
        return this.purchaseReturnsService.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext) {
        return this.purchaseReturnsService.findAll(tenant.tenantId);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchaseReturnsService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePurchaseReturnDto) {
        return this.purchaseReturnsService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchaseReturnsService.remove(tenant.tenantId, id);
    }
}