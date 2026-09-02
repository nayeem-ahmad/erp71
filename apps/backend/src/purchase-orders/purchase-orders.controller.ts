import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
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
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        return this.service.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom,
            createdTo,
        });
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
