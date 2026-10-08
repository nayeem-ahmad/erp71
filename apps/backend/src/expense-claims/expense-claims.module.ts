import { Module } from '@nestjs/common';
import { ApprovalNotifyModule } from '../approvals/approval-notify.module';
import { DatabaseModule } from '../database/database.module';
import { AssetsModule } from '../assets/assets.module';
import { ExpenseClaimsController } from './expense-claims.controller';
import { ExpenseClaimsService } from './expense-claims.service';

@Module({
    imports: [DatabaseModule, AssetsModule, ApprovalNotifyModule],
    controllers: [ExpenseClaimsController],
    providers: [ExpenseClaimsService],
    exports: [ExpenseClaimsService],
})
export class ExpenseClaimsModule {}
