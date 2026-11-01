import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { JobTrackerService } from '../system-health/jobs/job-tracker.service';
import { JOB_NAMES } from '../system-health/jobs/job-names';
import { Meet71MembershipService, type Meet71Membership } from './meet71-membership.service';

const CODE_TTL_MS = 60 * 1000;
const USED_RETENTION_MS = 60 * 60 * 1000;
const INVALID_CODE = { code: 'MEET71_INVALID_CODE', message: 'Invalid code' } as const;

export function s256(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
}

type MintInput = {
    userId: string;
    email: string;
    displayName: string;
    returnUrl: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
};

type ExchangeInput = {
    code: string;
    codeVerifier: string;
    returnUrl: string;
};

type ConsumedSsoCode = {
    email: string;
    display_name: string;
};

@Injectable()
export class Meet71SsoService {
    private readonly logger = new Logger(Meet71SsoService.name);

    constructor(
        private db: DatabaseService,
        private membership: Meet71MembershipService,
        private jobTracker: JobTrackerService,
    ) {}

    async mint(input: MintInput): Promise<{ code: string }> {
        const code = randomBytes(32).toString('hex');
        await this.db.meet71SsoCode.create({
            data: {
                user_id: input.userId,
                email: input.email,
                display_name: input.displayName,
                return_url: input.returnUrl,
                code_challenge: input.codeChallenge,
                code_challenge_method: input.codeChallengeMethod,
                code_hash: createHash('sha256').update(code).digest('hex'),
                expires_at: new Date(Date.now() + CODE_TTL_MS),
            },
        });
        this.logger.log(`Meet71SsoCode mint email=${input.email}`);
        return { code };
    }

    async exchange(input: ExchangeInput): Promise<Meet71Membership & { allowed: true }> {
        // Bind the precomputed S256 challenge; hashing inside SQL would be hex and never match.
        const challenge = s256(input.codeVerifier);
        const codeHash = createHash('sha256').update(input.code).digest('hex');
        const rows = await this.db.$queryRaw<ConsumedSsoCode[]>`
            UPDATE "Meet71SsoCode"
            SET used_at = NOW()
            WHERE code_hash = ${codeHash}
              AND used_at IS NULL
              AND expires_at > NOW()
              AND return_url = ${input.returnUrl}
              AND code_challenge = ${challenge}
            RETURNING *`;
        if (rows.length !== 1) {
            this.logger.log('Meet71SsoCode exchange invalid');
            throw new BadRequestException(INVALID_CODE);
        }

        const membership = await this.membership.upsertOnSignIn(rows[0].email, rows[0].display_name);
        if (!membership.allowed) {
            this.logger.log('Meet71SsoCode exchange invalid');
            throw new BadRequestException(INVALID_CODE);
        }
        this.logger.log(`Meet71SsoCode exchange ok email=${membership.email}`);
        return membership;
    }

    @Cron('*/5 * * * *', { timeZone: 'Asia/Dhaka' })
    sweepCodes() {
        return this.jobTracker.track(JOB_NAMES.MEET71_SSO_SWEEP, () => this.sweepCodesImpl());
    }

    async sweepCodesImpl(): Promise<number> {
        const hourAgo = new Date(Date.now() - USED_RETENTION_MS);
        const { count } = await this.db.meet71SsoCode.deleteMany({
            where: {
                OR: [{ expires_at: { lt: new Date() } }, { used_at: { lt: hourAgo } }],
            },
        });
        return count;
    }
}
