import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
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
        return this.purchasesService.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
    ) {
        return this.purchasesService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom,
            createdTo,
            sortBy,
            sortDir,
        });
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