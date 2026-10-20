import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Put,
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
  PaymentLayoutQueryDto,
  SavePaymentLayoutDto,
} from './payment-methods.dto';
import type { PaymentLayoutResponse } from '@erp71/shared-types';
import { ImportRowsDto } from '../common/import.dto';
import { BranchScopeService } from '../database/branch-scope.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PAYMENT_ACCOUNTS_READ, SETTINGS_ADMIN, TENDER_READ } from '../auth/permission-sets';
@Controller('payment-methods')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PaymentMethodsController {
  constructor(
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly branchScope: BranchScopeService,
  ) {}

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
    @Query('storeId') storeId?: string,
  ): Promise<PaymentMethodResponseDto[]> {
    let storeIds: string[] | undefined;
    if (storeId?.trim()) {
      // A branch id, or `all`: both go through the shared access check.
      const resolved = await this.branchScope.resolveStoreId(tenant, storeId, { permissions: TENDER_READ });
      storeIds = resolved ? [resolved] : undefined;
    } else if (!(await this.branchScope.canSeeAllBranches(tenant))) {
      // Old clients send no branch. Owners and consolidated holders keep getting
      // every method; everyone else only what is offered at one of their branches.
      storeIds = await this.branchScope.memberStoreIds(tenant);
    }
    return this.paymentMethodsService.findAll(tenant.tenantId, { type, storeIds });
  }

  // Must stay above @Get(':id'), which would otherwise swallow 'accounts'.
  @RequireAnyStorePermission(...PAYMENT_ACCOUNTS_READ)
  @Get('accounts')
  async findLinkableAccounts(
    @Tenant() tenant: TenantContext,
  ): Promise<PaymentMethodAccountDto[]> {
    return this.paymentMethodsService.findLinkableAccounts(tenant.tenantId);
  }

  /**
   * The caller's own layout of the method strip at one branch. The branch is
   * required and checked against the caller's access; `all` is refused. These
   * three routes must stay above @Get(':id'), which would swallow 'layout'.
   */
  @RequireAnyStorePermission(...TENDER_READ)
  @Get('layout')
  async getLayout(
    @Tenant() tenant: TenantContext,
    @Query() query: PaymentLayoutQueryDto,
  ): Promise<PaymentLayoutResponse<PaymentMethodResponseDto>> {
    const storeId = await this.layoutStoreId(tenant, query.storeId);
    return this.paymentMethodsService.getLayout(tenant, storeId, query.context);
  }

  @RequireAnyStorePermission(...TENDER_READ)
  @Put('layout')
  async saveLayout(
    @Tenant() tenant: TenantContext,
    @Query() query: PaymentLayoutQueryDto,
    @Body() dto: SavePaymentLayoutDto,
  ): Promise<PaymentLayoutResponse<PaymentMethodResponseDto>> {
    const storeId = await this.layoutStoreId(tenant, query.storeId);
    return this.paymentMethodsService.saveLayout(tenant, storeId, query.context, dto);
  }

  @RequireAnyStorePermission(...TENDER_READ)
  @Delete('layout')
  async resetLayout(
    @Tenant() tenant: TenantContext,
    @Query() query: PaymentLayoutQueryDto,
  ): Promise<PaymentLayoutResponse<PaymentMethodResponseDto>> {
    const storeId = await this.layoutStoreId(tenant, query.storeId);
    return this.paymentMethodsService.resetLayout(tenant, storeId, query.context);
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

  private async layoutStoreId(tenant: TenantContext, storeId: string): Promise<string> {
    const resolved = await this.branchScope.resolveStoreId(tenant, storeId, {
      permissions: TENDER_READ,
      allowAll: false,
    });
    return resolved as string;
  }
}
