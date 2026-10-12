import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExpenseClaimsModule } from '../expense-claims/expense-claims.module';
import { ProductDemandsModule } from '../product-demands/product-demands.module';
import { WarehouseTransfersModule } from '../warehouse-transfers/warehouse-transfers.module';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import {
    ExpenseClaimApprovals,
    LeaveRequestApprovals,
    ProductDemandApprovals,
    VoucherApprovals,
    WarehouseTransferApprovals,
} from './approval-providers';

@Module({
    imports: [AccountingModule, AttendanceModule, ExpenseClaimsModule, ProductDemandsModule, WarehouseTransfersModule],
    controllers: [ApprovalsController],
    providers: [
        ApprovalsService,
        StorePermissionGuard,
        ExpenseClaimApprovals,
        LeaveRequestApprovals,
        ProductDemandApprovals,
        VoucherApprovals,
        WarehouseTransferApprovals,
    ],
})
export class ApprovalsModule {}
