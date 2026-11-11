import { staffingHeatClass } from './staffing-heat';

describe('staffingHeatClass', () => {
    it('returns the empty tint when there is no remaining or no max', () => {
        expect(staffingHeatClass(0, 10)).toBe('bg-blue-50 text-gray-700');
        expect(staffingHeatClass(4, 0)).toBe('bg-blue-50 text-gray-700');
    });

    it('uses the darkest blue at the max cell', () => {
        expect(staffingHeatClass(10, 10)).toBe('bg-blue-600 text-white');
    });

    it('steps through the mid blues against the max cell', () => {
        expect(staffingHeatClass(2, 10)).toBe('bg-blue-100 text-gray-800');
        expect(staffingHeatClass(4, 10)).toBe('bg-blue-200 text-gray-900');
        expect(staffingHeatClass(6, 10)).toBe('bg-blue-400 text-white');
    });
});
