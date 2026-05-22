import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';

export interface ApiKeyListItem {
    id: string;
    name: string;
    key_prefix: string;
    last_used: Date | null;
    created_at: Date;
    revoked_at: Date | null;
}

export interface CreatedApiKey {
    key: string;
    id: string;
    name: string;
    key_prefix: string;
}

@Injectable()
export class ApiKeysService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * List all API keys for a tenant.
     * Never returns the actual key or its hash — only safe display fields.
     */
    async listKeys(tenantId: string): Promise<ApiKeyListItem[]> {
        return this.db.apiKey.findMany({
            where: { tenantId },
            select: {
                id: true,
                name: true,
                key_prefix: true,
                last_used: true,
                created_at: true,
                revoked_at: true,
            },
            orderBy: { created_at: 'desc' },
        });
    }

    /**
     * Generate a new API key.
     * Format: rsk_live_ + 64 hex chars (32 random bytes) = 73 chars total.
     * Stores only the SHA-256 hash and the first 8 chars as a display prefix.
     * Returns the FULL raw key exactly once — it can never be retrieved again.
     */
    async createKey(tenantId: string, name: string): Promise<CreatedApiKey> {
        const randomPart = crypto.randomBytes(32).toString('hex'); // 64 hex chars
        const rawKey = `rsk_live_${randomPart}`;                   // 73 chars total

        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const keyPrefix = rawKey.slice(0, 8); // "rsk_live" (first 8 chars)

        const record = await this.db.apiKey.create({
            data: {
                tenantId,
                name,
                key_hash: keyHash,
                key_prefix: keyPrefix,
            },
            select: { id: true, name: true, key_prefix: true },
        });

        return {
            key: rawKey,
            id: record.id,
            name: record.name,
            key_prefix: record.key_prefix,
        };
    }

    /**
     * Revoke an API key by setting revoked_at.
     * Verifies the key belongs to the requesting tenant before revoking.
     */
    async revokeKey(tenantId: string, keyId: string): Promise<void> {
        const existing = await this.db.apiKey.findUnique({
            where: { id: keyId },
            select: { tenantId: true, revoked_at: true },
        });

        if (!existing) {
            throw new NotFoundException('API key not found');
        }

        if (existing.tenantId !== tenantId) {
            throw new ForbiddenException('API key does not belong to this tenant');
        }

        if (existing.revoked_at) {
            // Already revoked — idempotent, just return
            return;
        }

        await this.db.apiKey.update({
            where: { id: keyId },
            data: { revoked_at: new Date() },
        });
    }
}
