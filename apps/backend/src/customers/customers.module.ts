import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';
import { CustomerScopeService } from './customer-scope.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CustomersController],
    providers: [CustomersService, SegmentsService, CustomerScopeService],
    exports: [CustomersService],
})
export class CustomersModule {}
