import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CommonModule } from '../common/common.module';
import { SalaryStructuresController } from './salary-structures.controller';
import { SalaryStructuresService } from './salary-structures.service';

@Module({
    imports: [DatabaseModule, CommonModule],
    controllers: [SalaryStructuresController],
    providers: [SalaryStructuresService],
    exports: [SalaryStructuresService],
})
export class PayrollModule {}
