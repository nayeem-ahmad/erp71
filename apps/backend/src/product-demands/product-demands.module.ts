import { Module } from '@nestjs/common';
import { ApprovalNotifyModule } from '../approvals/approval-notify.module';
import { DatabaseModule } from '../database/database.module';
import { ProductDemandsController } from './product-demands.controller';
import { ProductDemandsService } from './product-demands.service';

@Module({
    imports: [DatabaseModule, ApprovalNotifyModule],
    controllers: [ProductDemandsController],
    providers: [ProductDemandsService],
    exports: [ProductDemandsService],
})
export class ProductDemandsModule {}
