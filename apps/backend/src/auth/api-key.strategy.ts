import { Injectable } from '@nestjs/common';
import * as passport from 'passport';
import * as crypto from 'crypto';
import { DatabaseService } from '../database/database.service';

/**
 * Custom Passport strategy that authenticates via the x-api-key header.
 * Looks up the SHA-256 hash of the provided key in the database and
 * rejects any revoked keys. Updates last_used in a fire-and-forget manner.
 */
export class ApiKeyPassportStrategy extends passport.Strategy {
    name = 'api-key';

    constructor(private readonly db: DatabaseService) {
        super();
    }

    async authenticate(req: any): Promise<void> {
        const rawKey = req.headers['x-api-key'];

        if (!rawKey || typeof rawKey !== 'string') {
            return this.fail({ message: 'Missing x-api-key header' }, 401);
        }

        const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

        let apiKey: { id: string; tenantId: string } | null;
        try {
            apiKey = await this.db.apiKey.findFirst({
                where: {
                    key_hash: hash,
                    revoked_at: null,
                },
                select: { id: true, tenantId: true },
            });
        } catch {
            return this.error(new Error('Database error during API key lookup'));
        }

        if (!apiKey) {
            return this.fail({ message: 'Invalid or revoked API key' }, 401);
        }

        // Fire-and-forget last_used update — do not await in the auth hot path
        this.db.apiKey
            .update({
                where: { id: apiKey.id },
                data: { last_used: new Date() },
            })
            .catch(() => {
                // Intentionally swallowed — last_used is best-effort
            });

        return this.success({ tenantId: apiKey.tenantId, apiKeyId: apiKey.id });
    }
}

@Injectable()
export class ApiKeyStrategy {
    constructor(private readonly db: DatabaseService) {
        const strategy = new ApiKeyPassportStrategy(db);
        passport.use('api-key', strategy);
    }
}
