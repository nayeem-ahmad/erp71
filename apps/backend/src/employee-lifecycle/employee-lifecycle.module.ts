import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PayrollModule } from '../payroll/payroll.module';
import { EmployeeLifecycleController } from './employee-lifecycle.controller';
import { EmployeeLifecycleService } from './employee-lifecycle.service';

@Module({
    imports: [DatabaseModule, PayrollModule],
    controllers: [EmployeeLifecycleController],
    providers: [EmployeeLifecycleService],
    exports: [EmployeeLifecycleService],
})
export class EmployeeLifecycleModule {}
