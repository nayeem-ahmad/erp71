import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { InitiateFundTransferDto, ListFundTransfersQueryDto } from './fund-transfers.dto';
import { FundTransfersService } from './fund-transfers.service';

@Controller('fund-transfers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class FundTransfersController {
    constructor(private readonly service: FundTransfersService) {}

    @Post()
    initiate(@Tenant() tenant: TenantContext, @Body() dto: InitiateFundTransferDto) {
        return this.service.initiate(tenant.tenantId, tenant.userId, dto);
    }

    @Post(':id/receive')
    receive(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.receive(tenant.tenantId, tenant.userId, id);
    }

    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: ListFundTransfersQueryDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.get(tenant.tenantId, id);
    }
}