import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { StorefrontService } from './storefront.service';
import { StorefrontController } from './storefront.controller';

@Module({
    imports: [DatabaseModule, AuthModule, PriceListsModule],
    controllers: [StorefrontController],
    providers: [StorefrontService],
})
export class StorefrontModule {}
