import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
    imports: [AuthModule],
    controllers: [ImportsController],
    providers: [ImportsService],
    exports: [ImportsService],
})
export class ImportsModule {}
