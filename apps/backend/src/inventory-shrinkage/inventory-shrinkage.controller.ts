import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateInventoryShrinkageDto, ShrinkageDirection } from './inventory-shrinkage.dto';
import { InventoryShrinkageService } from './inventory-shrinkage.service';

@Controller('inventory-shrinkage')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class InventoryShrinkageController {
    constructor(private readonly service: InventoryShrinkageService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateInventoryShrinkageDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    /**
     * `direction` narrows the log to write-offs (LOSS) or surpluses (FOUND).
     * Omitted returns both — this is the entry log, where seeing the two
     * together is the point; the reports scope themselves instead.
     */
    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('direction') direction?: string,
    ) {
        return this.service.findAll(tenant.tenantId, {
            timezone: tenant.timezone,
            createdFrom,
            createdTo,
            direction: direction === 'LOSS' || direction === 'FOUND' ? (direction as ShrinkageDirection) : undefined,
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }
}