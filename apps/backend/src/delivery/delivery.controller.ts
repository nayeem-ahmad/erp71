import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
    UseInterceptors,
    HttpCode,
    HttpStatus,
    ParseIntPipe,
    DefaultValuePipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryDto, UpdateDeliveryDto } from './delivery.dto';

@Controller('delivery')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class DeliveryController {
    constructor(private readonly deliveryService: DeliveryService) {}

    @Get()
    listDeliveries(
        @Tenant() tenant: TenantContext,
        @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
        @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
        @Query('status') status?: string,
    ) {
        return this.deliveryService.listDeliveries(tenant.tenantId, page, Math.min(limit, 100), status);
    }

    @Get(':id')
    getDelivery(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.deliveryService.getDelivery(tenant.tenantId, id);
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    createDelivery(@Tenant() tenant: TenantContext, @Body() dto: CreateDeliveryDto) {
        return this.deliveryService.createDelivery(tenant.tenantId, dto);
    }

    @Patch(':id')
    updateDelivery(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateDeliveryDto,
    ) {
        return this.deliveryService.updateDelivery(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    cancelDelivery(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.deliveryService.cancelDelivery(tenant.tenantId, id);
    }
}
