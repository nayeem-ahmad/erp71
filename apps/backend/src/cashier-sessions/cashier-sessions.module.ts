import { Module } from '@nestjs/common';
import { CashierSessionsService } from './cashier-sessions.service';
import { CashierSessionsController } from './cashier-sessions.controller';
import { CountersModule } from '../counters/counters.module';

@Module({
  imports: [CountersModule],
  controllers: [CashierSessionsController],
  providers: [CashierSessionsService],
})
export class CashierSessionsModule {}