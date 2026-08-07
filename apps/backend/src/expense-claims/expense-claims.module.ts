import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AssetsModule } from '../assets/assets.module';
import { ExpenseClaimsController } from './expense-claims.controller';
import { ExpenseClaimsService } from './expense-claims.service';

@Module({
    imports: [DatabaseModule, AssetsModule],
    controllers: [ExpenseClaimsController],
    providers: [ExpenseClaimsService],
    exports: [ExpenseClaimsService],
})
export class ExpenseClaimsModule {}
