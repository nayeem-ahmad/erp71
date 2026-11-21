import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@erp71/database';
import { currentRequestTiming } from '../common/server-timing';

export const DB_QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '30000', 10);

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        super();
        // Feeds the `db` phase of the request's `Server-Timing` header. Outside
        // a request (jobs, startup) there is no timing and this only passes through.
        this.$use(async (params, next) => {
            const timing = currentRequestTiming();
            if (!timing) return next(params);
            timing.queryStarted();
            try {
                return await next(params);
            } finally {
                timing.queryEnded();
            }
        });
    }

    async onModuleInit() {
        try {
            await this.$connect();
            console.log('Successfully connected to database');
        } catch (error) {
            console.error('Failed to connect to database:', error);
            process.exit(1);
        }
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}
