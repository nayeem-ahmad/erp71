import { act, fireEvent, render, screen } from '@testing-library/react';
import CalculatorsPage from './page';
import { parseTapeEntry } from '@/components/tools/calculators/TapeCalculator';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({ api: { createNote: jest.fn().mockResolvedValue({ id: 'n1' }) } }));

describe('CalculatorsPage', () => {
    beforeEach(() => window.localStorage.clear());

    it('adds 15% VAT by default', () => {
        render(<CalculatorsPage />);
        fireEvent.change(screen.getByLabelText('Amount (Tk)'), { target: { value: '1000' } });
        expect(screen.getByText('Price with VAT').nextSibling).toHaveTextContent('1,150.00');
    });

    it('remembers the last calculator', () => {
        render(<CalculatorsPage />);
        fireEvent.click(screen.getByRole('tab', { name: 'Loan EMI' }));
        expect(window.localStorage.getItem('erp71.tools.calculatorTab')).toBe('emi');
    });

    it('keeps a running tape and saves it to Notes', async () => {
        render(<CalculatorsPage />);
        fireEvent.click(screen.getByRole('tab', { name: 'Tape' }));
        const amount = screen.getByLabelText('Amount');
        for (const entry of ['100', '50', '*2', '-10']) {
            fireEvent.change(amount, { target: { value: entry } });
            fireEvent.submit(amount.closest('form')!);
        }
        expect(screen.getByText('Total', { selector: 'span' }).nextSibling).toHaveTextContent('290.00');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Save to Notes/ }));
        });
        expect(api.createNote).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('290.00') }));
    });
});

describe('parseTapeEntry', () => {
    it('reads the operator, Bangla digits and commas', () => {
        expect(parseTapeEntry('1,250')).toEqual({ op: '+', value: 1250 });
        expect(parseTapeEntry('-৫০')).toEqual({ op: '-', value: 50 });
        expect(parseTapeEntry('x3')).toEqual({ op: '×', value: 3 });
        expect(parseTapeEntry('/4')).toEqual({ op: '÷', value: 4 });
        expect(parseTapeEntry('abc')).toBeNull();
    });
});
