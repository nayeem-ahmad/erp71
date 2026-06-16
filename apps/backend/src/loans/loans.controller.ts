import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    CreateLoanDto,
    CreateLoanPaymentDto,
    ListLoansQueryDto,
    UpdateLoanDto,
} from './loans.dto';
import { LoansService } from './loans.service';

@Controller('loans')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class LoansController {
    constructor(private readonly service: LoansService) {}

    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: ListLoansQueryDto) {
        return this.service.listLoans(tenant.tenantId, query);
    }

    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext) {
        return this.service.getSummary(tenant.tenantId);
    }

    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getLoan(tenant.tenantId, id);
    }

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateLoanDto) {
        return this.service.createLoan(tenant.tenantId, tenant.userId, dto);
    }

    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateLoanDto,
    ) {
        return this.service.updateLoan(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteLoan(tenant.tenantId, id);
    }

    @Post(':id/payments')
    addPayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateLoanPaymentDto,
    ) {
        return this.service.addPayment(tenant.tenantId, tenant.userId, id, dto);
    }

    @Delete(':id/payments/:paymentId')
    deletePayment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('paymentId') paymentId: string,
    ) {
        return this.service.deletePayment(tenant.tenantId, id, paymentId);
    }
}
