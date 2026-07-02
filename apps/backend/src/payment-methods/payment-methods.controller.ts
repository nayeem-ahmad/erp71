import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PaymentMethodsService } from './payment-methods.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PaymentMethodResponseDto,
  PaymentMethodType,
} from './payment-methods.dto';
import { ImportRowsDto } from '../common/import.dto';

@Controller('payment-methods')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.create(tenant.tenantId, dto);
  }

  @Post('import')
  importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
    return this.paymentMethodsService.importRows(tenant.tenantId, body.rows, body.mode);
  }

  @Get()
  async findAll(
    @Tenant() tenant: TenantContext,
    @Query('type') type?: PaymentMethodType,
  ): Promise<PaymentMethodResponseDto[]> {
    return this.paymentMethodsService.findAll(tenant.tenantId, type);
  }

  @Get('default/:type')
  async getDefault(
    @Tenant() tenant: TenantContext,
    @Param('type') type: PaymentMethodType,
  ): Promise<PaymentMethodResponseDto | null> {
    return this.paymentMethodsService.getDefaultByType(tenant.tenantId, type);
  }

  @Get(':id')
  async findOne(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.findById(id, tenant.tenantId);
  }

  @Patch(':id')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  async delete(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.paymentMethodsService.delete(id, tenant.tenantId);
  }
}
