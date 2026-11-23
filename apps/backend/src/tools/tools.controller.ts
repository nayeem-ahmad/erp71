import { Body, Controller, Get, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { BILL_SCAN, PRICE_CHECK_READ } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BillScanService } from './bill-scan.service';
import { ScanBillDto } from './bill-scan.dto';
import { PriceCheckService } from './price-check.service';

/** Tools that read the workspace rather than keeping a register of their own. */
@Controller('tools')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ToolsController {
    constructor(
        private readonly priceCheck: PriceCheckService,
        private readonly billScan: BillScanService,
    ) {}

    /** A scanner fires one of these per barcode; the default user budget is plenty. */
    @RequireAnyStorePermission(...PRICE_CHECK_READ)
    @Get('price-check')
    lookupPrice(@Tenant() tenant: TenantContext, @Query('code') code: string) {
        return this.priceCheck.lookup(tenant, code ?? '');
    }

    /** A paid vision call: pinned at the AI routes' 20 a minute. */
    @RequireAnyStorePermission(...BILL_SCAN)
    @Post('bill-scan')
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    scanBill(@Tenant() tenant: TenantContext, @Body() dto: ScanBillDto) {
        return this.billScan.scan(tenant, dto);
    }
}
