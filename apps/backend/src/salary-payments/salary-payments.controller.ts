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
import { TenantRoles } from '../auth/tenant-roles.decorator';
import {
    CreateSalaryPaymentDto,
    ListSalaryPaymentsQueryDto,
    RunSalaryAccrualDto,
    SalaryPaymentSummaryQueryDto,
    UpdateSalaryPaymentDto,
} from './salary-payments.dto';
import { SalaryPaymentsService } from './salary-payments.service';

@Controller('salary-payments')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SalaryPaymentsController {
    constructor(private readonly service: SalaryPaymentsService) {}

    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: ListSalaryPaymentsQueryDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext, @Query() query: SalaryPaymentSummaryQueryDto) {
        return this.service.getSummary(tenant.tenantId, query);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalaryPaymentDto) {
        return this.service.create(tenant.tenantId, tenant.userId, dto);
    }

    @Post('run-accrual')
    @TenantRoles('OWNER', 'ACCOUNTANT')
    runAccrual(@Tenant() tenant: TenantContext, @Body() dto: RunSalaryAccrualDto) {
        return this.service.runMonthlyAccrual(tenant.tenantId, tenant.userId, dto);
    }

    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateSalaryPaymentDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
