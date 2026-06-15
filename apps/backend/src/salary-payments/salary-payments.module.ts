import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SalaryPaymentsController } from './salary-payments.controller';
import { SalaryPaymentsService } from './salary-payments.service';

@Module({
    imports: [DatabaseModule],
    controllers: [SalaryPaymentsController],
    providers: [SalaryPaymentsService],
})
export class SalaryPaymentsModule {}
