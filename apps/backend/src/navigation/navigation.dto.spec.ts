import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveNavLayoutDto } from './navigation.dto';

describe('SaveNavLayoutDto', () => {
    it('accepts a valid navigation layout payload', async () => {
        const dto = plainToInstance(SaveNavLayoutDto, {
            layout: [
                { id: 'dashboard', parentId: null, sortOrder: 0, visible: true },
                { id: 'sales', parentId: null, sortOrder: 1, visible: true },
            ],
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
    });

    it('rejects unknown layout node properties', async () => {
        const dto = plainToInstance(SaveNavLayoutDto, {
            layout: [{ id: 'dashboard', parentId: null, sortOrder: 0, visible: true, extra: true }],
        });

        const errors = await validate(dto, {
            whitelist: true,
            forbidNonWhitelisted: true,
        });
        expect(errors.length).toBeGreaterThan(0);
    });
});