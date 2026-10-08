import { Module } from '@nestjs/common';
import { ApprovalNotifyModule } from '../approvals/approval-notify.module';
import { DatabaseModule } from '../database/database.module';
import { WarehouseTransfersController } from './warehouse-transfers.controller';
import { WarehouseTransfersService } from './warehouse-transfers.service';

@Module({
    imports: [DatabaseModule, ApprovalNotifyModule],
    controllers: [WarehouseTransfersController],
    providers: [WarehouseTransfersService],
    exports: [WarehouseTransfersService],
})
export class WarehouseTransfersModule {}