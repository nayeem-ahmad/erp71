import { Controller, Post, Get, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CashierSessionsService } from './cashier-sessions.service';
import { OpenSessionDto } from './dto/open-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { CashTransactionDto } from './dto/cash-transaction.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { POS_STAFF } from '../auth/permission-sets';
import { BranchQueryDto } from '../common/branch-query.dto';
@Controller('cashier-sessions')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CashierSessionsController {
  constructor(
    private readonly cashierSessionsService: CashierSessionsService,
    private readonly branchScope: BranchScopeService,
  ) {}

  /**
   * A till belongs to one branch. A path or body store id must be one the
   * caller may use there — before this, any branch of the tenant could be
   * named and read (or opened against).
   */
  private branch(tenant: TenantContext, storeId: string | undefined): Promise<string> {
    return this.branchScope
      .resolveStoreId(tenant, storeId, { permissions: POS_STAFF, allowAll: false })
      .then((resolved) => resolved as string);
  }

  @RequireAnyStorePermission(...POS_STAFF)
  @Post('open')
  async openSession(
    @Tenant() tenant: TenantContext,
    @Body() dto: OpenSessionDto,
  ) {
    const storeId = await this.branch(tenant, dto.storeId);
    return this.cashierSessionsService.openSession(tenant.tenantId, tenant.userId, { ...dto, storeId });
  }

  @RequireAnyStorePermission(...POS_STAFF)
  @Post(':sessionId/close')
  async closeSession(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.cashierSessionsService.closeSession(tenant.tenantId, sessionId, dto);
  }

  @RequireAnyStorePermission(...POS_STAFF)
  @Get('open')
  async getOpenSession(
    @Tenant() tenant: TenantContext,
  ) {
    return this.cashierSessionsService.getOpenSessionByUser(tenant.tenantId, tenant.userId);
  }

  /**
   * Open tills and today's closed shifts across one branch or, for an owner or
   * a `VIEW_CONSOLIDATED_REPORTS` holder, every branch (`storeId=all`, or
   * omitted). The phone's cashier monitor. Ordered before `:sessionId`.
   */
  @RequireAnyStorePermission(...POS_STAFF)
  @Get('overview')
  async getOverview(
    @Tenant() tenant: TenantContext,
    @Query() query: BranchQueryDto,
  ) {
    const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: POS_STAFF });
    return this.cashierSessionsService.getOverview(tenant.tenantId, storeId, tenant.timezone);
  }

  @RequireAnyStorePermission(...POS_STAFF)
  @Get('store/:storeId')
  async getSessionsByStore(
    @Tenant() tenant: TenantContext,
    @Param('storeId') storeId: string,
  ) {
    return this.cashierSessionsService.getSessionsByStore(tenant.tenantId, await this.branch(tenant, storeId));
  }

  /**
   * The floor view: every till open in a store right now, with what each is
   * holding. Ordered before `:sessionId` so "open" is not read as an id.
   */
  @RequireAnyStorePermission(...POS_STAFF)
  @Get('store/:storeId/open')
  async getOpenSessionsByStore(
    @Tenant() tenant: TenantContext,
    @Param('storeId') storeId: string,
  ) {
    return this.cashierSessionsService.getOpenSessionsByStore(tenant.tenantId, await this.branch(tenant, storeId));
  }

  @RequireAnyStorePermission(...POS_STAFF)
  @Get(':sessionId')
  async getSessionById(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
  ) {
    return this.cashierSessionsService.getSessionById(tenant.tenantId, sessionId);
  }

  /** Takings, payment-method breakdown and expected cash for one shift. */
  @RequireAnyStorePermission(...POS_STAFF)
  @Get(':sessionId/summary')
  async getSessionSummary(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
  ) {
    return this.cashierSessionsService.getSessionSummary(tenant.tenantId, sessionId);
  }

  @RequireAnyStorePermission(...POS_STAFF)
  @Post(':sessionId/cash-transaction')
  async addCashTransaction(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
    @Body() dto: CashTransactionDto,
  ) {
    return this.cashierSessionsService.addCashTransaction(
      tenant.tenantId,
      sessionId,
      dto.amount,
      dto.type,
      dto.description,
    );
  }

  @RequireAnyStorePermission(...POS_STAFF)
  @Get(':sessionId/cash-transactions')
  async getCashTransactions(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
  ) {
    return this.cashierSessionsService.getCashTransactions(tenant.tenantId, sessionId);
  }
}