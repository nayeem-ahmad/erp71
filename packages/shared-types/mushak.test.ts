import {
  MUSHAK_FORMS,
  MUSHAK_FORM_BY_CODE,
  MUSHAK_LARGE_SUPPLY_THRESHOLD_BDT,
  MushakForm,
  SUPPORTED_MUSHAK_FORMS,
  allocateProRata,
  checkMushakIssuer,
  computeSaleTax,
  isSupportedMushakForm,
  mushakSupplyUnit,
  resolveTaxRate,
  roundMoney,
  splitTaxInclusive,
  toBengaliDigits,
} from './mushak';

describe('form catalogue', () => {
  it('lists every 6.x form NBR prescribes, in gazette order', () => {
    expect(MUSHAK_FORMS.map((f) => f.code)).toEqual([
      '6.1', '6.2', '6.2.1', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9', '6.10',
    ]);
  });

  it('marks the four forms the sales module actually produces', () => {
    expect(SUPPORTED_MUSHAK_FORMS).toEqual(['6.2', '6.3', '6.7', '6.10']);
    expect(isSupportedMushakForm(MushakForm.TAX_INVOICE)).toBe(true);
    expect(isSupportedMushakForm(MushakForm.PURCHASE_BOOK)).toBe(false);
    expect(isSupportedMushakForm('6.99')).toBe(false);
  });

  it('carries a Bangla title and a rule citation on every form', () => {
    for (const form of MUSHAK_FORMS) {
      expect(form.titleBn.length).toBeGreaterThan(0);
      expect(form.ruleBn).toContain('বিধি ৪০');
      expect(MUSHAK_FORM_BY_CODE[form.code]).toBe(form);
    }
  });

  it('names a source module for every supported form', () => {
    for (const form of MUSHAK_FORMS.filter((f) => f.supported)) {
      expect(form.module).toBe('sales');
    }
  });
});

describe('splitTaxInclusive', () => {
  it('backs 15% VAT out of an inclusive price', () => {
    const split = splitTaxInclusive(1150, { vatRate: 15, sdRate: 0 });
    expect(split.taxableValue).toBe(1000);
    expect(split.vatAmount).toBe(150);
    expect(split.sdAmount).toBe(0);
    expect(split.inclusiveTotal).toBe(1150);
  });

  it('levies supplementary duty on the value and VAT on value plus duty', () => {
    // 1000 value + 10% SD = 1100, + 15% VAT = 1265.
    const split = splitTaxInclusive(1265, { vatRate: 15, sdRate: 10 });
    expect(split.taxableValue).toBe(1000);
    expect(split.sdAmount).toBe(100);
    expect(split.vatAmount).toBe(165);
  });

  it('treats a zero-rated line as all value', () => {
    const split = splitTaxInclusive(500, { vatRate: 0, sdRate: 0 });
    expect(split).toMatchObject({ taxableValue: 500, vatAmount: 0, sdAmount: 0 });
  });

  it('always reassembles into the gross, whatever the rate', () => {
    for (const gross of [1, 7.77, 99.99, 333.33, 10000.01]) {
      for (const vatRate of [0, 5, 7.5, 10, 15]) {
        for (const sdRate of [0, 10, 25.5]) {
          const s = splitTaxInclusive(gross, { vatRate, sdRate });
          expect(roundMoney(s.taxableValue + s.sdAmount + s.vatAmount)).toBe(
            roundMoney(gross),
          );
        }
      }
    }
  });

  it('ignores a negative or non-finite rate rather than inventing a credit', () => {
    expect(splitTaxInclusive(100, { vatRate: -15, sdRate: NaN })).toMatchObject({
      taxableValue: 100,
      vatAmount: 0,
      sdAmount: 0,
    });
  });
});

describe('allocateProRata', () => {
  it('splits proportionally and sums to the target exactly', () => {
    const parts = allocateProRata(100, [1, 1, 1]);
    expect(roundMoney(parts.reduce((a, b) => a + b, 0))).toBe(100);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  it('weights by line size', () => {
    expect(allocateProRata(90, [100, 200])).toEqual([30, 60]);
  });

  it('puts the whole target on the first line when there is nothing to weight by', () => {
    expect(allocateProRata(50, [0, 0])).toEqual([50, 0]);
  });

  it('returns nothing for no lines', () => {
    expect(allocateProRata(50, [])).toEqual([]);
  });
});

describe('computeSaleTax', () => {
  const lines = [
    { key: 'a', quantity: 2, unitPrice: 575, vatRate: 15, sdRate: 0 },
    { key: 'b', quantity: 1, unitPrice: 230, vatRate: 15, sdRate: 0 },
  ];

  it('totals the lines when nothing was discounted', () => {
    const tax = computeSaleTax(lines);
    expect(tax.inclusiveTotal).toBe(1380);
    expect(tax.taxableValue).toBe(1200);
    expect(tax.vatAmount).toBe(180);
    expect(tax.lines.map((l) => l.key)).toEqual(['a', 'b']);
  });

  it('spreads an invoice-level discount over the lines before taxing them', () => {
    // 1380 billed as 1200: the value of the supply fell, so output VAT must
    // fall with it rather than staying at the undiscounted 180.
    const tax = computeSaleTax(lines, 1200);
    expect(tax.inclusiveTotal).toBe(1200);
    expect(roundMoney(tax.taxableValue + tax.vatAmount)).toBe(1200);
    expect(tax.vatAmount).toBeLessThan(180);
  });

  it('foots to the billed total exactly on an awkward discount', () => {
    const tax = computeSaleTax(lines, 999.99);
    const summed = roundMoney(
      tax.lines.reduce((sum, l) => sum + l.inclusiveTotal, 0),
    );
    expect(summed).toBe(999.99);
    expect(tax.inclusiveTotal).toBe(999.99);
  });

  it('leaves the lines alone when the total is above them', () => {
    // Transport or labour added on the entry form is not the value of a
    // supply, so it must not be dragged into the taxable value.
    const tax = computeSaleTax(lines, 1500);
    expect(tax.inclusiveTotal).toBe(1380);
    expect(tax.vatAmount).toBe(180);
  });

  it('mixes rates per line', () => {
    const tax = computeSaleTax([
      { key: 'standard', quantity: 1, unitPrice: 115, vatRate: 15, sdRate: 0 },
      { key: 'exempt', quantity: 1, unitPrice: 100, vatRate: 0, sdRate: 0 },
    ]);
    expect(tax.vatAmount).toBe(15);
    expect(tax.taxableValue).toBe(200);
  });

  it('handles an empty sale', () => {
    expect(computeSaleTax([])).toMatchObject({
      lines: [],
      taxableValue: 0,
      vatAmount: 0,
      inclusiveTotal: 0,
    });
  });

  it('keeps a zero-quantity line from dividing by zero', () => {
    const tax = computeSaleTax([{ key: 'z', quantity: 0, unitPrice: 115, vatRate: 15, sdRate: 0 }]);
    expect(tax.lines[0].unitPrice).toBe(115);
    expect(tax.inclusiveTotal).toBe(0);
  });
});

describe('resolveTaxRate', () => {
  it('prefers the product rate over the workspace default', () => {
    expect(resolveTaxRate(5, 15)).toBe(5);
  });

  it('treats an explicit product zero as exempt, not as "unset"', () => {
    expect(resolveTaxRate(0, 15)).toBe(0);
  });

  it('falls back to the workspace default when the product says nothing', () => {
    expect(resolveTaxRate(null, 15)).toBe(15);
    expect(resolveTaxRate(undefined, 15)).toBe(15);
  });

  it('is zero when neither is configured', () => {
    expect(resolveTaxRate(null, null)).toBe(0);
  });
});

describe('supply units and numerals', () => {
  it('maps catalogue unit types to a unit of supply', () => {
    expect(mushakSupplyUnit('kg_g').bn).toBe('কেজি');
    expect(mushakSupplyUnit('none').en).toBe('Pcs');
    expect(mushakSupplyUnit(null)).toEqual(mushakSupplyUnit('none'));
    expect(mushakSupplyUnit('something_else')).toEqual(mushakSupplyUnit('none'));
  });

  it('renders Bengali numerals for the gazetted column row', () => {
    expect(toBengaliDigits(10)).toBe('১০');
    expect(toBengaliDigits('6.3')).toBe('৬.৩');
  });
});

describe('checkMushakIssuer', () => {
  const complete = {
    vat_registration_no: '000123456-0101',
    mushak_issue_address: 'Dhaka',
    mushak_officer_name: 'Rahim',
    mushak_officer_designation: 'Manager',
  };

  it('passes a fully configured workspace', () => {
    expect(checkMushakIssuer(complete)).toEqual({ ready: true, missing: [] });
  });

  it('names every field a tax invoice cannot be issued without', () => {
    expect(checkMushakIssuer({}).missing).toEqual([
      'vat_registration_no',
      'mushak_issue_address',
      'mushak_officer_name',
      'mushak_officer_designation',
    ]);
  });

  it('does not accept whitespace as a BIN', () => {
    expect(checkMushakIssuer({ ...complete, vat_registration_no: '   ' })).toEqual({
      ready: false,
      missing: ['vat_registration_no'],
    });
  });
});

describe('thresholds', () => {
  it('states the rule 40(1)(ড) listing threshold once', () => {
    expect(MUSHAK_LARGE_SUPPLY_THRESHOLD_BDT).toBe(200000);
  });
});
