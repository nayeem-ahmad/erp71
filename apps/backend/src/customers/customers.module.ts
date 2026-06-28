import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';
import { DatabaseModule } from '../database/database.module';

@Module({
    imports: [DatabaseModule],
    controllers: [CustomersController],
    providers: [CustomersService, SegmentsService],
    exports: [CustomersService],
})
export class CustomersModule {}
