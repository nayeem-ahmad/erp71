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
  PaymentMethodAccountDto,
  PaymentMethodResponseDto,
  PaymentMethodType,
} from './payment-methods.dto';
import { ImportRowsDto } from '../common/import.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PAYMENT_ACCOUNTS_READ, SETTINGS_ADMIN, TENDER_READ } from '../auth/permission-sets';
@Controller('payment-methods')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @RequireAnyStorePermission(...SETTINGS_ADMIN)
  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.create(tenant.tenantId, dto);
  }

  @RequireAnyStorePermission(...SETTINGS_ADMIN)
  @Post('import')
  importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
    return this.paymentMethodsService.importRows(tenant.tenantId, body.rows, body.mode);
  }

  @RequireAnyStorePermission(...TENDER_READ)
  @Get()
  async findAll(
    @Tenant() tenant: TenantContext,
    @Query('type') type?: PaymentMethodType,
  ): Promise<PaymentMethodResponseDto[]> {
    return this.paymentMethodsService.findAll(tenant.tenantId, type);
  }

  // Must stay above @Get(':id'), which would otherwise swallow 'accounts'.
  @RequireAnyStorePermission(...PAYMENT_ACCOUNTS_READ)
  @Get('accounts')
  async findLinkableAccounts(
    @Tenant() tenant: TenantContext,
  ): Promise<PaymentMethodAccountDto[]> {
    return this.paymentMethodsService.findLinkableAccounts(tenant.tenantId);
  }

  @RequireAnyStorePermission(...TENDER_READ)
  @Get('default/:type')
  async getDefault(
    @Tenant() tenant: TenantContext,
    @Param('type') type: PaymentMethodType,
  ): Promise<PaymentMethodResponseDto | null> {
    return this.paymentMethodsService.getDefaultByType(tenant.tenantId, type);
  }

  @RequireAnyStorePermission(...TENDER_READ)
  @Get(':id')
  async findOne(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.findById(id, tenant.tenantId);
  }

  @RequireAnyStorePermission(...SETTINGS_ADMIN)
  @Patch(':id')
  async update(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.update(id, tenant.tenantId, dto);
  }

  @RequireAnyStorePermission(...SETTINGS_ADMIN)
  @Delete(':id')
  async delete(
    @Tenant() tenant: TenantContext,
    @Param('id') id: string,
  ): Promise<void> {
    return this.paymentMethodsService.delete(id, tenant.tenantId);
  }
}
