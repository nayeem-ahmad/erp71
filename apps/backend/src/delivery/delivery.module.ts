import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
    imports: [AuthModule],
    controllers: [DeliveryController],
    providers: [DeliveryService],
})
export class DeliveryModule {}
