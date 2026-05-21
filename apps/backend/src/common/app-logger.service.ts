import { Injectable, ConsoleLogger } from '@nestjs/common';
import { requestContext } from './request-context';
import { winstonLogger } from './logger';

@Injectable()
export class AppLogger extends ConsoleLogger {
  private getContext(): { requestId: string; tenantId?: string } {
    const store = requestContext.getStore();
    return {
      requestId: store?.requestId ?? 'no-context',
      tenantId: store?.tenantId,
    };
  }

  log(message: string, context?: string): void {
    const ctx = this.getContext();
    winstonLogger.info(message, { ...ctx, context });
  }

  error(message: string, trace?: string, context?: string): void {
    const ctx = this.getContext();
    winstonLogger.error(message, { ...ctx, context, trace });
  }

  warn(message: string, context?: string): void {
    const ctx = this.getContext();
    winstonLogger.warn(message, { ...ctx, context });
  }

  debug(message: string, context?: string): void {
    const ctx = this.getContext();
    winstonLogger.debug(message, { ...ctx, context });
  }
}
