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
    CreateExpenseCategoryDto,
    CreateExpenseEntryDto,
    ExpenseReportQueryDto,
    ListExpenseEntriesQueryDto,
    UpdateExpenseCategoryDto,
    UpdateExpenseEntryDto,
} from './expenses.dto';
import { ExpensesService } from './expenses.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { EXPENSE_READ, EXPENSE_WRITE } from '../auth/permission-sets';
@Controller('expenses')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ExpensesController {
    constructor(private readonly service: ExpensesService) {}

    @RequireAnyStorePermission(...EXPENSE_READ)
    @Get('categories')
    listCategories(@Tenant() tenant: TenantContext) {
        return this.service.listCategories(tenant.tenantId);
    }

    @RequireAnyStorePermission(...EXPENSE_WRITE)
    @Post('categories')
    createCategory(@Tenant() tenant: TenantContext, @Body() dto: CreateExpenseCategoryDto) {
        return this.service.createCategory(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...EXPENSE_WRITE)
    @Patch('categories/:id')
    updateCategory(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateExpenseCategoryDto,
    ) {
        return this.service.updateCategory(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...EXPENSE_WRITE)
    @Delete('categories/:id')
    deleteCategory(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteCategory(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...EXPENSE_READ)
    @Get('entries')
    listEntries(@Tenant() tenant: TenantContext, @Query() query: ListExpenseEntriesQueryDto) {
        return this.service.listEntries(tenant.tenantId, { ...query, timezone: tenant.timezone });
    }

    @RequireAnyStorePermission(...EXPENSE_WRITE)
    @Post('entries')
    createEntry(@Tenant() tenant: TenantContext, @Body() dto: CreateExpenseEntryDto) {
        return this.service.createEntry(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...EXPENSE_WRITE)
    @Patch('entries/:id')
    updateEntry(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateExpenseEntryDto,
    ) {
        return this.service.updateEntry(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...EXPENSE_WRITE)
    @Delete('entries/:id')
    deleteEntry(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteEntry(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...EXPENSE_READ)
    @Get('summary')
    getSummary(@Tenant() tenant: TenantContext, @Query() query: ExpenseReportQueryDto) {
        return this.service.getSummary(tenant.tenantId, query);
    }
}