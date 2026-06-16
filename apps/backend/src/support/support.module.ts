import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SupportController } from './support.controller';
import { AdminSupportController } from './admin-support.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [SupportController, AdminSupportController],
})
export class SupportModule {}
