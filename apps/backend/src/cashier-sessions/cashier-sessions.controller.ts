import { Controller, Post, Get, Body, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { CashierSessionsService } from './cashier-sessions.service';
import { OpenSessionDto } from './dto/open-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('cashier-sessions')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class CashierSessionsController {
  constructor(private readonly cashierSessionsService: CashierSessionsService) {}

  @Post('open')
  async openSession(
    @Tenant() tenant: TenantContext,
    @Body() dto: OpenSessionDto,
  ) {
    return this.cashierSessionsService.openSession(tenant.tenantId, tenant.userId, dto);
  }

  @Post(':sessionId/close')
  async closeSession(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.cashierSessionsService.closeSession(tenant.tenantId, sessionId, dto);
  }

  @Get('open')
  async getOpenSession(
    @Tenant() tenant: TenantContext,
  ) {
    return this.cashierSessionsService.getOpenSessionByUser(tenant.tenantId, tenant.userId);
  }

  @Get('store/:storeId')
  async getSessionsByStore(
    @Tenant() tenant: TenantContext,
    @Param('storeId') storeId: string,
  ) {
    return this.cashierSessionsService.getSessionsByStore(tenant.tenantId, storeId);
  }

  /**
   * The floor view: every till open in a store right now, with what each is
   * holding. Ordered before `:sessionId` so "open" is not read as an id.
   */
  @Get('store/:storeId/open')
  async getOpenSessionsByStore(
    @Tenant() tenant: TenantContext,
    @Param('storeId') storeId: string,
  ) {
    return this.cashierSessionsService.getOpenSessionsByStore(tenant.tenantId, storeId);
  }

  @Get(':sessionId')
  async getSessionById(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
  ) {
    return this.cashierSessionsService.getSessionById(tenant.tenantId, sessionId);
  }

  /** Takings, payment-method breakdown and expected cash for one shift. */
  @Get(':sessionId/summary')
  async getSessionSummary(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
  ) {
    return this.cashierSessionsService.getSessionSummary(tenant.tenantId, sessionId);
  }

  @Post(':sessionId/cash-transaction')
  async addCashTransaction(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
    @Body() dto: { amount: number; type: string; description?: string },
  ) {
    return this.cashierSessionsService.addCashTransaction(
      tenant.tenantId,
      sessionId,
      dto.amount,
      dto.type,
      dto.description,
    );
  }

  @Get(':sessionId/cash-transactions')
  async getCashTransactions(
    @Tenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
  ) {
    return this.cashierSessionsService.getCashTransactions(tenant.tenantId, sessionId);
  }
}