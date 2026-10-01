import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { ApplyMatchDecisionsDto } from './external-sync.match.dto';

/** Same options as the global ValidationPipe in main.ts. */
async function check(payload: unknown): Promise<ValidationError[]> {
    const dto = plainToInstance(ApplyMatchDecisionsDto, payload);
    return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function nestedProperties(errors: ValidationError[]): string[] {
    const names: string[] = [];
    for (const error of errors) {
        names.push(error.property);
        for (const child of error.children ?? []) {
            names.push(`${error.property}.${child.property}`);
        }
    }
    return names;
}

const roundTrip = {
    manifest: {
        tenantId: 'tenant-1',
        connectionId: 'conn-1',
        provider: 'EXPRESS_RETAIL_PRO',
        snapshotId: 'snap-1',
        generatedAt: '2026-09-30T00:00:00.000Z',
        rowCount: 1,
    },
    rows: [{ entity: 'PRODUCT', externalId: '1', decision: 'accept', matchId: 'p1' }],
};

describe('ApplyMatchDecisionsDto', () => {
    it('accepts the match-candidates payload posted back on Confirm', async () => {
        expect(nestedProperties(await check(roundTrip))).toEqual([]);
    });

    it('rejects an unknown field on the manifest', async () => {
        expect(
            nestedProperties(
                await check({
                    ...roundTrip,
                    manifest: { ...roundTrip.manifest, extra: true },
                }),
            ),
        ).toContain('manifest.extra');
    });
});
