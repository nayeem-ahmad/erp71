import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AccountingModule } from '../accounting/accounting.module';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { InvestorsController } from './investors.controller';
import { InvestorsService } from './investors.service';

@Module({
    // AccountingModule for AccountingService: the monthly run reads net profit
    // through the same code that renders the P&L report, so the figure investors
    // are paid on and the figure on the report cannot drift apart.
    imports: [DatabaseModule, AccountingModule],
    controllers: [InvestorsController],
    providers: [InvestorsService, StorePermissionGuard],
})
export class InvestorsModule {}
