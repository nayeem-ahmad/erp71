import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@erp71/database';

export const DB_QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '30000', 10);

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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
