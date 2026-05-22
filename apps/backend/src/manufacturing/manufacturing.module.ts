import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';

@Module({
    imports: [AuthModule],
    controllers: [ManufacturingController],
    providers: [ManufacturingService],
})
export class ManufacturingModule {}
