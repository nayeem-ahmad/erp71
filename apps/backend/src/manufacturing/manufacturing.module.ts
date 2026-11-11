import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ManufacturingController } from './manufacturing.controller';
import { ManufacturingService } from './manufacturing.service';

@Module({
    imports: [forwardRef(() => AuthModule)],
    controllers: [ManufacturingController],
    providers: [ManufacturingService],
    exports: [ManufacturingService],
})
export class ManufacturingModule {}
