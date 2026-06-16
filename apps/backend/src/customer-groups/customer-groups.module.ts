import { Module } from '@nestjs/common';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomerGroupsService } from './customer-groups.service';
import { DatabaseModule } from '../database/database.module';
import { PriceListsModule } from '../price-lists/price-lists.module';

@Module({
    imports: [DatabaseModule, PriceListsModule],
    controllers: [CustomerGroupsController],
    providers: [CustomerGroupsService],
})
export class CustomerGroupsModule {}
