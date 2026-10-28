import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DecisionSummaryComponent } from './decision-summary.component';
import { EvidenceSources, decisionEvidence } from './decision-evidence';
import {
    QuantitativeAnalysis,
    RedFlagScan,
    ReverseDcfAnalysis,
    StatementYear,
    StrengthFinding,
    StrengthsWeaknesses
} from '../models/analysis';
import { StockMetrics } from '../models/stock-metrics';

function year(y: number, revenue: number, netProfit: number, borrowings: number, equity: number, cfo: number, capex: number): StatementYear {
    return {
        year: y,
        revenue,
        ebitda: null,
        netProfit,
        netMargin: (netProfit / revenue) * 100,
        totalAssets: null,
        borrowings,
        equity,
        debtToEquity: borrowings / equity,
        operatingCashFlow: cfo,
        capex,
        freeCashFlow: cfo - capex,
        cashConversion: (cfo / netProfit) * 100
    };
}

const YEARS: StatementYear[] = [
    year(2021, 1000, 100, 100, 1000, 120, 50),
    year(2022, 1100, 110, 150, 1050, 100, 60),
    year(2023, 1210, 130, 200, 1100, 150, 200),
    year(2024, 1331, 140, 250, 1200, 160, 220),
    year(2025, 1278, 115, 300, 1250, 130, 80)
];

const METRICS = {
    currentPrice: 2410,
    roce: 22.4,
    roe: 18.1,
    companyIntroduction: {
        name: 'Acme Paints',
        industry: 'Paints',
        description: 'Acme makes decorative paints for Indian homes. It was founded in 1942 and sells through dealers.'
    }
} as StockMetrics;

const finding = (text: string) => ({ text }) as StrengthFinding;
const STRENGTHS = {
    status: 'ok',
    message: null,
    strengths: [finding('a'), finding('b'), finding('c')],
    weaknesses: [finding('d')],
    skipped: []
} as unknown as StrengthsWeaknesses;

const RED_FLAGS = {
    status: 'ok',
    message: null,
    flags: [{ id: 'debt-outpacing-revenue', severity: 'watch', text: '', evidence: '' }],
    skipped: [{ id: 'promoter-pledging', reason: 'not supplied' }]
} as unknown as RedFlagScan;

const QUANT = {
    price: 2410,
    fairValue: 2050,
    score: 2,
    scenarios: { bear: { fairValuePerShare: 1620 }, base: { fairValuePerShare: 2050 }, bull: { fairValuePerShare: 2710 }, impliedGrowth: 14 }
} as unknown as QuantitativeAnalysis;

const REVERSE = { status: 'ok', impliedGrowth: 14.2, message: null } as unknown as ReverseDcfAnalysis;

const ALL: EvidenceSources = {
    metrics: METRICS,
    statements: YEARS,
    strengths: STRENGTHS,
    redFlags: RED_FLAGS,
    quant: QUANT,
    reverseDcf: REVERSE
};

const NONE: EvidenceSources = { metrics: null, statements: null, strengths: null, redFlags: null, quant: null, reverseDcf: null };

describe('decisionEvidence', () => {
    it('lays out every row of evidence side by side, in reading order', () => {
        expect(decisionEvidence(ALL)).toEqual([
            { label: 'Business', text: 'Paints. Acme makes decorative paints for Indian homes.' },
            { label: 'Growth', text: 'Revenue grew 6.3% a year from FY2021 to FY2025; it fell 4.0% in FY2025' },
            { label: 'Profitability', text: 'ROCE 22.4%; ROE 18.1%; net margin 9.0% in FY2025 (FY2021–FY2025 average 10.1%)' },
            { label: 'Financial health', text: 'Debt / equity 0.24× in FY2025 (0.10× in FY2021); borrowings rose every year' },
            { label: 'Cash', text: 'Cash from operations positive in 5 of 5 years; free cash flow ₹50 cr in FY2025' },
            { label: 'Strengths / Weaknesses', text: '3 Strengths · 1 Weakness' },
            { label: 'Red flags', text: '1: Debt outpacing revenue' },
            { label: 'Valuation', text: 'Price ₹2,410 · Fair value ₹2,050 · Scenario range ₹1,620–₹2,710 · Implied growth 14.2%' }
        ]);
    });

    it('never repeats the Quantitative score or adds a verdict', () => {
        const text = decisionEvidence(ALL).map((r) => r.text).join(' ').toLowerCase();
        for (const word of ['score', '/5', 'undervalued', 'overvalued', 'buy', 'sell', 'upside', 'downside']) {
            expect(text).withContext(word).not.toContain(word);
        }
    });

    it('leaves a row empty when its source has not arrived', () => {
        expect(decisionEvidence(NONE).map((r) => r.text)).toEqual(Array(8).fill(null));
    });

    it('does not present the absence of Red flags as a positive', () => {
        const rows = decisionEvidence({ ...ALL, redFlags: { ...RED_FLAGS, flags: [] } });
        expect(rows.find((r) => r.label === 'Red flags')!.text).toBe('None raised on available data; 1 rule could not run');
        const clean = decisionEvidence({ ...ALL, redFlags: { ...RED_FLAGS, flags: [], skipped: [] } });
        expect(clean.find((r) => r.label === 'Red flags')!.text).toBe('None raised on available data');
    });

    it('states why a source is unavailable', () => {
        const rows = decisionEvidence({
            ...ALL,
            strengths: { ...STRENGTHS, status: 'unavailable', message: 'No financials' },
            reverseDcf: { ...REVERSE, status: 'not-applicable', impliedGrowth: null, message: 'Loss-making' },
            quant: { ...QUANT, scenarios: null }
        });
        expect(rows.find((r) => r.label === 'Strengths / Weaknesses')!.text).toBe('No financials');
        expect(rows.find((r) => r.label === 'Valuation')!.text).toBe('Price ₹2,410 · Fair value ₹2,050 · Scenario range not applicable · Implied growth: Loss-making');
    });

    it('keeps every valuation item visible while the DCF is loading or after it failed', () => {
        const rows = decisionEvidence({ ...NONE, metrics: METRICS });
        expect(rows.find((r) => r.label === 'Valuation')!.text).toBe('Price ₹2,410 · Fair value — · Scenario range — · Implied growth —');
    });

    it('shows negative free cash flow with a leading minus', () => {
        const years = [...YEARS.slice(0, 4), { ...YEARS[4], freeCashFlow: -1234 }];
        expect(decisionEvidence({ ...ALL, statements: years }).find((r) => r.label === 'Cash')!.text)
            .toBe('Cash from operations positive in 5 of 5 years; free cash flow −₹1,234 cr in FY2025');
    });
});

describe('DecisionSummaryComponent', () => {
    let fixture: ComponentFixture<DecisionSummaryComponent>;

    function render(inputs: Partial<{ ticker: string; sources: EvidenceSources; loading: boolean; dense: boolean }> = {}): HTMLElement {
        fixture = TestBed.createComponent(DecisionSummaryComponent);
        fixture.componentRef.setInput('ticker', inputs.ticker ?? 'ACME');
        fixture.componentRef.setInput('sources', inputs.sources ?? ALL);
        fixture.componentRef.setInput('loading', inputs.loading ?? false);
        fixture.componentRef.setInput('dense', inputs.dense ?? false);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    const textOf = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const boxes = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-testid="self-check"] input[type="checkbox"]')) as HTMLInputElement[];

    it('shows the evidence uncoloured, with no verdict', () => {
        const el = render();
        const rows = Array.from(el.querySelectorAll('[data-testid="evidence"] tr'));
        expect(rows.map((r) => textOf(r.querySelector('th')))).toEqual([
            'Business', 'Growth', 'Profitability', 'Financial health', 'Cash', 'Strengths / Weaknesses', 'Red flags', 'Valuation'
        ]);
        expect(textOf(el)).toContain('There is no verdict');
        expect(el.querySelector('[class*="good"], [class*="bad"], [class*="warn"], [data-tone]')).toBeNull();
    });

    it('marks rows still loading, then not available', () => {
        let el = render({ sources: NONE, loading: true });
        expect(textOf(el.querySelector('[data-testid="evidence"] td'))).toBe('Loading…');
        el = render({ sources: NONE, loading: false });
        expect(textOf(el.querySelector('[data-testid="evidence"] td'))).toBe('Not available');
    });

    it('offers an unticked Self-check that only the user ticks', () => {
        const el = render();
        const items = boxes(el);
        expect(items.map((b) => textOf(b.closest('label')))).toEqual([
            'I can explain how this company makes money',
            'I have read the three financial statements',
            'I know which weaknesses would change my view',
            'I am comfortable with the price against the Scenario range'
        ]);
        expect(items.every((b) => !b.checked)).toBeTrue();

        items[0].click();
        fixture.detectChanges();
        expect(boxes(el).map((b) => b.checked)).toEqual([true, false, false, false]);
    });

    it('clears the Self-check for a different stock', () => {
        const el = render();
        boxes(el)[1].click();
        fixture.detectChanges();

        fixture.componentRef.setInput('ticker', 'OTHER');
        fixture.detectChanges();
        expect(boxes(el).some((b) => b.checked)).toBeFalse();
    });

    it('explains the Self-check in Explain mode only', () => {
        expect(render().querySelectorAll('[data-explain]').length).toBeGreaterThan(0);
        const dense = render({ dense: true });
        expect(dense.querySelectorAll('[data-explain]').length).toBe(0);
        expect(textOf(dense)).toContain('There is no verdict');
        expect(textOf(dense)).toContain('Not saved');
    });
});
