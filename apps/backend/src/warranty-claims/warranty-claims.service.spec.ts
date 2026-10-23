import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WarrantyClaimsService } from './warranty-claims.service';
import { DatabaseService } from '../database/database.service';
import { issueDocumentNumber } from '../database/document-number.utils';

jest.mock('../database/document-number.utils', () => ({
    ...jest.requireActual('../database/document-number.utils'),
    issueDocumentNumber: jest.fn(async () => 'WC-2627-00001'),
}));


describe('WarrantyClaimsService', () => {
    let service: WarrantyClaimsService;
    let db: any;
    let tx: any;

    beforeEach(async () => {
        jest.clearAllMocks();

        tx = {
            productSerial: {
                findFirst: jest.fn(),
                findUnique: jest.fn(),
                updateMany: jest.fn(),
            },
            product: {
                findUnique: jest.fn(),
            },
            sale: {
                findUnique: jest.fn(),
            },
            warrantyClaim: {
                create: jest.fn(),
                findUnique: jest.fn(),
                update: jest.fn(),
            },
        };

        db = {
            $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
            productSerial: { findFirst: jest.fn() },
            product: { findUnique: jest.fn() },
            sale: { findUnique: jest.fn() },
            warrantyClaim: {
                findMany: jest.fn(),
                findUnique: jest.fn(),
            },
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WarrantyClaimsService,
                { provide: DatabaseService, useValue: db },
            ],
        }).compile();

        service = module.get<WarrantyClaimsService>(WarrantyClaimsService);
    });

    describe('create()', () => {
        it('should create a warranty claim and mark the serial as CLAIMED', async () => {
            const serial = {
                id: 'serial-1',
                tenant_id: 'tenant-1',
                serial_number: 'SN-001',
                status: 'SOLD',
                product_id: 'prod-1',
                source_id: 'sale-1',
                sold_at: new Date(Date.now() - 86400_000),
            };
            const product = {
                id: 'prod-1',
                warranty_enabled: true,
                warranty_duration_days: 365,
            };
            const sale = { id: 'sale-1', customer_id: 'cust-1' };
            const createdClaim = { id: 'claim-1', claim_number: 'WC-123', status: 'SUBMITTED' };

            tx.productSerial.findFirst.mockResolvedValue(serial);
            tx.product.findUnique.mockResolvedValue(product);
            tx.sale.findUnique.mockResolvedValue(sale);
            tx.warrantyClaim.create.mockResolvedValue(createdClaim);
            tx.productSerial.updateMany.mockResolvedValue({ count: 1 });

            const result = await service.create('tenant-1', {
                storeId: 'store-1',
                serialNumber: 'SN-001',
                reason: 'Defective screen',
            });

            expect(tx.warrantyClaim.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenant_id: 'tenant-1',
                        claim_number: 'WC-2627-00001',
                        serial_number: 'SN-001',
                        status: 'SUBMITTED',
                    }),
                }),
            );
            expect(issueDocumentNumber).toHaveBeenCalledWith(tx, expect.objectContaining({
                tenantId: 'tenant-1',
                docType: 'WARRANTY_CLAIM',
                storeId: 'store-1',
            }));
            expect(tx.productSerial.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'CLAIMED' }),
                }),
            );
            expect(result).toEqual(createdClaim);
        });

        it('should reject a claim when the serial is already CLAIMED', async () => {
            tx.productSerial.findFirst.mockResolvedValue({
                id: 'serial-1',
                serial_number: 'SN-001',
                status: 'CLAIMED',
                product_id: 'prod-1',
                source_id: null,
            });

            await expect(
                service.create('tenant-1', {
                    storeId: 'store-1',
                    serialNumber: 'SN-001',
                    reason: 'Defective',
                }),
            ).rejects.toThrow(BadRequestException);

            expect(tx.warrantyClaim.create).not.toHaveBeenCalled();
        });
    });

    describe('findOne()', () => {
        it('should return the claim when it belongs to the tenant', async () => {
            db.warrantyClaim.findUnique.mockResolvedValue({
                id: 'claim-1',
                tenant_id: 'tenant-1',
                status: 'SUBMITTED',
            });

            const result = await service.findOne('tenant-1', 'claim-1');

            expect(result.id).toBe('claim-1');
        });

        it('should throw NotFoundException when claim does not exist', async () => {
            db.warrantyClaim.findUnique.mockResolvedValue(null);

            await expect(service.findOne('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
        });
    });
});
