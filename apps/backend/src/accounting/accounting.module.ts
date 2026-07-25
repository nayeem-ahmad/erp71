import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { TenantRoleGuard } from '../auth/tenant-role.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { AuditService } from '../audit/audit.service';

@Module({
    controllers: [AccountingController],
    providers: [AccountingService, StorePermissionGuard, TenantRoleGuard, SubscriptionAccessGuard, AuditService],
    // Exported for the AI assistant's financial_statement tool, so ledger figures
    // it quotes come from the same code the accounting reports render.
    exports: [AccountingService],
})
export class AccountingModule {}