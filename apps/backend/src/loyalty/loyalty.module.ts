import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerScopeService } from '../customers/customer-scope.service';

@Module({
    imports: [DatabaseModule, AuthModule],
    controllers: [LoyaltyController],
    // CustomerScopeService decides whose customers the loyalty list shows.
    providers: [LoyaltyService, CustomerScopeService],
    exports: [LoyaltyService],
})
export class LoyaltyModule {}
