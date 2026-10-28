import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { StockDashboardComponent } from './stock-dashboard.component';
import { StockMetrics } from '../models/stock-metrics';
import { READING_MODE_KEY, ReadingModeService } from '../services/reading-mode.service';
import { Features, MdnaInsights, QuantitativeAnalysis, RedFlagScan, ReverseDcfAnalysis, StatementYear } from '../models/analysis';

const STOCK_URL = 'http://localhost:3000/api/stock/';
const ANALYSIS_URL = 'http://localhost:3000/api/analysis/';

function emptyMetrics(overrides: Partial<StockMetrics> = {}): StockMetrics {
    return {
        marketCap: null,
        currentPrice: null,
        week52High: null,
        week52Low: null,
        peRatio: null,
        bookValue: null,
        dividendYield: null,
        roce: null,
        roe: null,
        companyIntroduction: null,
        news: [],
        peers: [],
        analystConsensus: null,
        ...overrides
    };
}

function quant(overrides: Partial<QuantitativeAnalysis> = {}): QuantitativeAnalysis {
    return {
        ticker: 'TCS',
        price: 100,
        ratios: { pe: 20, pb: 4, roe: 0.3 },
        defaults: { growthRate: 10, discountRate: 12, terminalGrowthRate: 5 },
        assumptions: { growthRate: 10, discountRate: 12, terminalGrowthRate: 5 },
        overridden: false,
        fairValue: 150,
        score: 5,
        explanation: 'Price is more than 30% below Fair value.',
        scenarios: {
            bear: { growthRate: 5, discountRate: 13, terminalGrowthRate: 5, fairValuePerShare: 80 },
            base: { growthRate: 10, discountRate: 12, terminalGrowthRate: 5, fairValuePerShare: 150 },
            bull: { growthRate: 15, discountRate: 11, terminalGrowthRate: 5, fairValuePerShare: 220 },
            grid: { growth: [8, 10, 12], discount: [12, 13], values: [[105, 80], [150, null], [-50, 0]] },
            impliedGrowth: 4.5
        },
        cached: false,
        cachedAt: 0,
        ...overrides
    };
}

function reverseDcf(overrides: Partial<ReverseDcfAnalysis> = {}): ReverseDcfAnalysis {
    return {
        ticker: 'TCS',
        status: 'ok',
        message: null,
        price: 100,
        assumptions: { discountRate: 12, terminalGrowthRate: 5 },
        impliedGrowth: 14,
        bound: null,
        historicalCagr: 9,
        guidedGrowth: null,
        verdict: 'expects-acceleration',
        cached: false,
        cachedAt: 0,
        ...overrides
    };
}

const DEFAULT_FEATURES: Features = { insights: true, qualitative: false, swot: false };

function redFlags(overrides: Partial<RedFlagScan> = {}): RedFlagScan {
    return {
        ticker: 'TCS',
        status: 'ok',
        message: null,
        flags: [
            { id: 'high-leverage', severity: 'warning', text: 'High leverage', evidence: 'Debt / equity 1.80 (FY25)' },
            { id: 'cash-conversion-drop', severity: 'watch', text: 'Cash conversion fell 40 pts in FY25', evidence: 'OCF/NI 0.95 → 0.55 (FY24 → FY25)' }
        ],
        skipped: [{ id: 'promoter-pledging', reason: 'not provided by data source' }],
        ...overrides
    };
}

function statementYear(year: number): StatementYear {
    return {
        year,
        revenue: 1000,
        ebitda: 200,
        netProfit: 100,
        netMargin: 10,
        totalAssets: 2000,
        borrowings: 100,
        equity: 1000,
        debtToEquity: 0.1,
        operatingCashFlow: 120,
        capex: 50,
        freeCashFlow: 70,
        cashConversion: 120
    };
}

function mdnaInsights(overrides: Partial<MdnaInsights> = {}): MdnaInsights {
    return {
        ticker: 'TCS',
        model: 'm',
        experimental: true,
        year: 2025,
        source: 'screener',
        status: 'ok',
        message: null,
        insights: {
            keyPoints: [{ point: 'Revenue grew 18%', quote: 'revenue grew 18% this year on strong demand' }],
            growthStrategy: [{ point: 'Expand into rural markets', quote: null }],
            tailwinds: [{ point: 'Rising rural demand', quote: null }],
            headwinds: [],
            risks: [{ point: 'Raw material price volatility', quote: 'volatile raw material prices could compress margins' }],
            moat: { rating: 'narrow', reasoning: 'Strong brand in the premium segment.', quote: null }
        },
        cached: false,
        cachedAt: 0,
        ...overrides
    };
}

describe('StockDashboardComponent', () => {
    let component: StockDashboardComponent;
    let fixture: ComponentFixture<StockDashboardComponent>;
    let httpMock: HttpTestingController;

    beforeEach(async () => {
        localStorage.removeItem(READING_MODE_KEY);
        await TestBed.configureTestingModule({
            imports: [StockDashboardComponent],
            providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
        }).compileComponents();

        fixture = TestBed.createComponent(StockDashboardComponent);
        component = fixture.componentInstance;
        httpMock = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        httpMock.expectOne(`${ANALYSIS_URL}features`).flush(DEFAULT_FEATURES);
    });

    afterEach(() => {
        localStorage.removeItem(READING_MODE_KEY);
        // MD&A insights, the reverse DCF, statements and red flags load automatically with every ticker; tests that don't assert on them leave them pending.
        httpMock.match((r) => ['/insights', '/reverse-dcf', '/statements', '/red-flags'].some((end) => r.url.endsWith(end)));
        httpMock.verify();
    });

    function search(ticker: string): void {
        component.query = ticker;
        component.search();
    }

    function expectQuant(ticker: string) {
        return httpMock.expectOne((r) => r.url === `${ANALYSIS_URL}${ticker}/quantitative`);
    }

    function expectReverseDcf(ticker: string) {
        return httpMock.expectOne((r) => r.url === `${ANALYSIS_URL}${ticker}/reverse-dcf`);
    }

    function expectRedFlags(ticker: string) {
        return httpMock.expectOne((r) => r.url === `${ANALYSIS_URL}${ticker}/red-flags`);
    }

    function text(): string {
        fixture.detectChanges();
        return fixture.nativeElement.textContent as string;
    }

    it('loads fundamentals and the Quantitative analysis together for one normalised ticker', () => {
        search('  tcs ');

        expect(component.ticker).toBe('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());

        expect(component.stockState).toBe('data');
        expect(component.quant?.fairValue).toBe(150);
    });

    it('shows a not-found message on 404', () => {
        search('BADTICKER');
        httpMock.expectOne(`${STOCK_URL}BADTICKER`).flush('Not found', { status: 404, statusText: 'Not Found' });
        expectQuant('BADTICKER').flush({ error: 'Ticker not found' }, { status: 404, statusText: 'Not Found' });

        expect(component.stockState).toBe('error');
        expect(text()).toContain('Ticker not found');
    });

    it('shows an upstream message on 502', () => {
        search('RELIANCE');
        httpMock.expectOne(`${STOCK_URL}RELIANCE`).flush('Bad gateway', { status: 502, statusText: 'Bad Gateway' });
        expectQuant('RELIANCE').flush(quant());

        expect(component.stockError).toBe('Upstream data source failed, please retry');
    });

    it('renders N/A for missing metrics on a partial payload', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics({ marketCap: 100, peRatio: 15, roe: 14 }));
        expectQuant('TCS').flush(quant());

        const content = text();
        expect(component.metrics?.currentPrice).toBeNull();
        expect(content).toContain('N/A');
        expect(content).toContain('14%');
    });

    it('renders company context, returns and peers', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({
            marketCap: 125000000,
            currentPrice: 321.5,
            week52High: 350,
            week52Low: 250,
            roce: 20,
            roe: 14,
            companyIntroduction: { name: 'Acme Industries', industry: 'Manufacturing', description: 'Makes useful things.' },
            peers: [
                { name: 'Peer Corp', price: 200, marketCap: 50000, peRatio: 12, pbRatio: 2, roe: 15, debtToEquity: 0.3, profitMargin: 9.5, dividendYield: 1.1 },
                { name: 'Peer with missing metrics', price: null, marketCap: null, peRatio: null, pbRatio: null, roe: null, debtToEquity: null, profitMargin: null, dividendYield: null }
            ]
        }));
        expectQuant('ACME').flush(quant());

        const content = text();
        expect(content).toContain('Acme Industries');
        expect(content).toContain('Makes useful things.');
        expect(content).toContain('Peer Corp');
        expect(content).toContain('20%');
        expect(content).toContain('14%');
        expect(component.rangePosition).toBeCloseTo(71.5, 1);

        const rows = fixture.nativeElement.querySelectorAll('tbody tr');
        expect(rows.length).toBe(3);
        const missingRow = rows[2] as HTMLTableRowElement;
        expect(Array.from(missingRow.cells).slice(1).map((cell) => cell.textContent?.trim() ?? '')).toEqual([
            '', '', '', '', '', '', '', ''
        ]);
    });

    it('pins and highlights the current stock at the top of the peer comparison', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({
            currentPrice: 321.5,
            marketCap: 125000,
            peRatio: 18.5,
            roe: 14,
            dividendYield: 1.2,
            companyIntroduction: { name: 'Acme Industries', industry: null, description: null },
            peers: [{ name: 'Peer Corp', price: 200, marketCap: 50000, peRatio: 12, pbRatio: 2, roe: 15, debtToEquity: 0.3, profitMargin: 9.5, dividendYield: 1.1 }]
        }));
        expectQuant('ACME').flush(quant({ ratios: { pe: 18.5, pb: 3.4, roe: 0.14 } }));
        fixture.detectChanges();

        const rows = fixture.nativeElement.querySelectorAll('tbody tr') as NodeListOf<HTMLTableRowElement>;
        expect(rows.length).toBe(2);
        expect(rows[0].classList).toContain('current');
        expect(rows[0].cells[0].textContent).toContain('Acme Industries');
        expect(rows[0].cells[0].textContent).toContain('This stock');
        expect(Array.from(rows[0].cells).slice(1).map((c) => c.textContent?.trim())).toEqual([
            '321.5', '125,000', '18.5', '3.4', '14%', '', '', '1.2%'
        ]);
        expect(rows[1].classList).not.toContain('current');
    });

    it('does not duplicate the current stock when the provider already lists it as a peer', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({
            currentPrice: 321.5,
            companyIntroduction: { name: 'Acme Industries', industry: null, description: null },
            peers: [
                { name: 'Peer Corp', price: 200, marketCap: null, peRatio: null, pbRatio: null, roe: null, debtToEquity: null, profitMargin: null, dividendYield: null },
                { name: 'ACME INDUSTRIES', price: 320, marketCap: null, peRatio: null, pbRatio: null, roe: null, debtToEquity: 0.1, profitMargin: 12, dividendYield: null }
            ]
        }));
        expectQuant('ACME').flush(quant());

        const rows = component.peerRows;
        expect(rows.length).toBe(2);
        expect(rows[0]).toEqual(jasmine.objectContaining({ current: true, price: 321.5, debtToEquity: 0.1, profitMargin: 12 }));
        expect(rows[1].name).toBe('Peer Corp');
    });

    it('reads in five blocks, each holding its sections in order', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics());
        expectQuant('ACME').flush(quant());
        fixture.detectChanges();

        const blocks = Array.from(fixture.nativeElement.querySelectorAll('[data-block]') as NodeListOf<HTMLElement>);
        expect(blocks.map((b) => b.dataset['block'])).toEqual(['overview', 'financials', 'management', 'valuation', 'decision']);
        expect(blocks.map((b) => b.querySelector('h2')?.textContent?.trim())).toEqual([
            'Business overview', 'Financials', 'Management & annual report', 'Valuation', 'Decision summary'
        ]);
        const sections = (b: HTMLElement) => Array.from(b.querySelectorAll('article[data-testid]') as NodeListOf<HTMLElement>)
            .map((el) => el.dataset['testid']);
        expect(sections(blocks[0])).toEqual(['company', 'key-stats']);
        expect(sections(blocks[1])).toEqual(['statements', 'red-flags', 'peers']);
        expect(sections(blocks[2])).toEqual(['insights-panel', 'guidance-panel']);
        expect(sections(blocks[3])).toEqual(['quant-panel', 'reverse-dcf']);
    });

    it('opens every block by default and collapses or expands one at a time', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics());
        expectQuant('ACME').flush(quant());
        fixture.detectChanges();

        const block = (id: string) => fixture.nativeElement.querySelector(`[data-block="${id}"]`) as HTMLElement;
        const toggle = (id: string) => block(id).querySelector('[data-testid="block-toggle"]') as HTMLButtonElement;
        for (const id of ['overview', 'financials', 'management', 'valuation', 'decision']) {
            expect(toggle(id).textContent?.trim()).toBe('Collapse');
            expect(toggle(id).getAttribute('aria-expanded')).toBe('true');
        }

        toggle('valuation').click();
        fixture.detectChanges();
        expect(toggle('valuation').textContent?.trim()).toBe('Expand');
        expect(toggle('valuation').getAttribute('aria-expanded')).toBe('false');
        expect(block('valuation').querySelector('[data-testid="quant-panel"]')).toBeNull();
        expect(block('financials').querySelector('[data-testid="red-flags"]')).not.toBeNull();

        toggle('valuation').click();
        fixture.detectChanges();
        expect(block('valuation').querySelector('[data-testid="quant-panel"]')).not.toBeNull();
    });

    it('opens every block again when another ticker is searched', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics());
        expectQuant('ACME').flush(quant());
        fixture.detectChanges();
        (fixture.nativeElement.querySelector('[data-block="overview"] [data-testid="block-toggle"]') as HTMLButtonElement).click();

        search('BADTICKER');
        httpMock.expectOne(`${STOCK_URL}BADTICKER`).flush('Not found', { status: 404, statusText: 'Not Found' });
        expectQuant('BADTICKER').flush({ error: 'Ticker not found' }, { status: 404, statusText: 'Not Found' });

        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-testid="company"]')?.textContent).toContain('Ticker not found');
    });

    it('scrolls to a block from the contents bar', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics());
        expectQuant('ACME').flush(quant());
        fixture.detectChanges();

        const target = fixture.nativeElement.querySelector('[data-block="valuation"]') as HTMLElement;
        const scroll = spyOn(target, 'scrollIntoView');
        const links = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="contents"] > button') as NodeListOf<HTMLButtonElement>);
        expect(links.map((l) => l.textContent?.replace(/^\s*\d+/, '').trim())).toEqual([
            'Business overview', 'Financials', 'Management & annual report', 'Valuation', 'Decision summary'
        ]);

        links[3].click();
        expect(scroll).toHaveBeenCalled();
    });

    describe('reading mode', () => {
        const notes = (root: HTMLElement) => root.querySelectorAll('[data-explain]').length;
        const modeButton = (label: string) =>
            Array.from(fixture.nativeElement.querySelectorAll('[data-testid="reading-mode"] button') as NodeListOf<HTMLButtonElement>)
                .find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

        beforeEach(() => {
            search('ACME');
            httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({ peRatio: 24.5 }));
            expectQuant('ACME').flush(quant());
            fixture.detectChanges();
        });

        it('defaults to Explain with a plain-language note on every block and Key stat', () => {
            expect(modeButton('Explain').getAttribute('aria-pressed')).toBe('true');
            expect(modeButton('Dense').getAttribute('aria-pressed')).toBe('false');

            const blocks = Array.from(fixture.nativeElement.querySelectorAll('[data-block]') as NodeListOf<HTMLElement>);
            for (const b of blocks) {
                expect(b.querySelector('[data-explain="block"]')?.textContent?.trim()).withContext(b.dataset['block']!).toBeTruthy();
            }
            const stats = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="key-stats"] .stat') as NodeListOf<HTMLElement>);
            expect(stats.length).toBeGreaterThan(0);
            for (const s of stats) {
                expect(notes(s)).withContext(s.querySelector('.label')!.textContent!).toBe(1);
            }
            const pe = stats.find((s) => s.querySelector('.label')?.textContent === 'P/E')!;
            expect(pe.querySelector('[data-explain]')?.textContent).toContain('earnings');
            for (const id of ['red-flags', 'peers', 'quant-panel', 'reverse-dcf']) {
                expect(notes(fixture.nativeElement.querySelector(`[data-testid="${id}"]`))).withContext(id).toBeGreaterThan(0);
            }
        });

        it('Dense drops every explanation but keeps the numbers, and is remembered', () => {
            modeButton('Dense').click();
            fixture.detectChanges();

            expect(modeButton('Dense').getAttribute('aria-pressed')).toBe('true');
            expect(notes(fixture.nativeElement)).toBe(0);
            expect(fixture.nativeElement.querySelector('[data-testid="decision-summary"]').textContent).toContain('There is no verdict');
            expect(fixture.nativeElement.querySelector('[data-testid="key-stats"]').textContent).toContain('24.5');
            expect(fixture.nativeElement.querySelector('[data-testid="quant-panel"]').textContent).toContain('₹150');
            expect(TestBed.inject(ReadingModeService).mode()).toBe('dense');

            modeButton('Explain').click();
            fixture.detectChanges();
            expect(notes(fixture.nativeElement)).toBeGreaterThan(0);
        });
    });

    it('shows no Analyst consensus or Recent news even when the provider sends them', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({
            news: [{ headline: 'Acme expands production', publishedAt: '2026-10-20T10:00:00Z', source: null, url: 'https://www.livemint.com/news/acme' }],
            analystConsensus: { source: 'IndianAPI', recommendation: 'Buy', counts: { strongBuy: 1, buy: 0, hold: 0, sell: 0, strongSell: 0 } }
        }));
        expectQuant('ACME').flush(quant());

        const content = text();
        expect(content).not.toContain('Analyst consensus');
        expect(content).not.toContain('Recent news');
        expect(content).not.toContain('Acme expands production');
    });

    it('keeps optional sections empty when the provider has no supplemental data', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({ marketCap: 100, currentPrice: 10 }));
        expectQuant('ACME').flush(quant());

        const content = text();
        expect(content).toContain('No peer comparison data available.');
        expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
    });

    it('normalises market cap to crores for both providers', () => {
        expect(component.marketCapCrores(327900.15)).toBe(327900.15);
        expect(component.marketCapCrores(3279001500000)).toBeCloseTo(327900.15, 2);
        expect(component.marketCapCrores(null)).toBeNull();
    });

    it('shows the Quantitative score, verdict and upside side by side with the MD&A insights panel', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());

        const content = text();
        expect(fixture.nativeElement.querySelector('[data-testid="quant-score"]').textContent.trim()).toBe('5');
        expect(content).toContain('Steal zone');
        expect(component.upside).toBeCloseTo(50, 5);
        expect(content).toContain('+50%');
        expect(fixture.nativeElement.querySelector('[data-testid="insights-panel"]')).not.toBeNull();
    });

    it('shows bear, base and bull Fair values, the Implied growth and a price-coloured sensitivity grid', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="scenarios"]');
        const range = Array.from(panel.querySelectorAll('[data-testid="scenario-range"] > *'))
            .map((el) => Array.from(el.children).map((c) => c.textContent!.trim()).join(' '));
        expect(range).toEqual(['Bear ₹80', 'Base ₹150', 'Bull ₹220']);
        expect(panel.querySelector('[data-testid="scenario-price-marker"]')).not.toBeNull();
        expect(panel.textContent).toContain('Needs 4.5% annual growth for 5 years to justify today\'s price');

        panel.querySelector<HTMLButtonElement>('[data-testid="sensitivity-toggle"]')!.click();
        fixture.detectChanges();
        const cells = Array.from(panel.querySelectorAll<HTMLElement>('[data-testid="sensitivity-cell"]'));
        // price 100: 105 is within ±10% (fair), 80 is below price (expensive), 150 is cheap, ≤ 0 is expensive
        expect(cells.map((c) => c.dataset['tone'])).toEqual(['neutral', 'bad', 'good', 'none', 'bad', 'bad']);
        expect(cells[3].textContent!.trim()).toBe('—');
    });

    it('shows the growth the price implies beside the growth the company delivered', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        expectReverseDcf('TCS').flush(reverseDcf());
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="reverse-dcf"]');
        expect(panel.textContent).toContain('Price implies 14% growth for 5 years; company delivered 9%');
        expect(panel.textContent).toContain('Market expects acceleration');
    });

    it('shows why the reverse DCF has no answer and omits a missing historical CAGR', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        expectReverseDcf('TCS').flush(reverseDcf({
            status: 'no-solution', message: 'Price implies more than 50% annual growth', impliedGrowth: null, bound: 50,
            historicalCagr: null, verdict: null
        }));
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="reverse-dcf"]');
        expect(panel.textContent).toContain('Price implies more than 50% annual growth');
        expect(panel.textContent).not.toContain('company delivered');
    });

    it('loads red flags automatically and shows each with its severity and evidence', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        expectRedFlags('TCS').flush(redFlags());
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="red-flags"]');
        const items = panel.querySelectorAll('[data-testid="red-flag"]');
        expect(items.length).toBe(2);
        expect(items[0].textContent).toContain('warning');
        expect(items[0].textContent).toContain('High leverage');
        expect(items[0].textContent).toContain('Debt / equity 1.80 (FY25)');
        expect(items[1].textContent).toContain('watch');
        expect(panel.textContent).toContain('Promoter pledging: not provided by data source');
        expect(panel.textContent).not.toContain('No red flags detected');
    });

    it('says no red flags were detected rather than giving a positive signal', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        expectRedFlags('TCS').flush(redFlags({ flags: [], skipped: [] }));
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="red-flags"]');
        expect(panel.textContent).toContain('No red flags detected on available data');
    });

    it('loads the financial statements automatically at the top of Financials', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        httpMock.expectOne(`${ANALYSIS_URL}TCS/statements`).flush({ ticker: 'TCS', years: [statementYear(2024), statementYear(2025)] });
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-block="financials"] [data-testid="statements"]');
        expect(panel.textContent).toContain('Income statement');
        expect(panel.textContent).toContain('Cash flow');
    });

    it('says when no annual statements are available and retries after an error', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        httpMock.expectOne(`${ANALYSIS_URL}TCS/statements`).flush({ error: 'Upstream fetch failed' }, { status: 502, statusText: 'Bad Gateway' });
        fixture.detectChanges();

        const panel = () => fixture.nativeElement.querySelector('[data-testid="statements"]') as HTMLElement;
        expect(panel().textContent).toContain('Upstream fetch failed');
        (panel().querySelector('[data-testid="statements-retry"]') as HTMLButtonElement).click();
        httpMock.expectOne(`${ANALYSIS_URL}TCS/statements`).flush({ ticker: 'TCS', years: [] });
        fixture.detectChanges();
        expect(panel().textContent).toContain('No annual financial statements available');
    });

    it('re-solves the reverse DCF with the discount and terminal growth from the sliders', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        expectReverseDcf('TCS').flush(reverseDcf());
        component.assumptions = { growthRate: 15, discountRate: 14, terminalGrowthRate: 5 };
        component.recalculate();

        expectQuant('TCS').flush(quant());
        const req = expectReverseDcf('TCS');
        expect(req.request.params.get('discount')).toBe('14');
        expect(req.request.params.has('terminal')).toBeFalse();
        expect(req.request.params.has('growth')).toBeFalse();
        req.flush(reverseDcf());
    });

    it('says when no growth rate justifies the price', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        const q = quant();
        expectQuant('TCS').flush(quant({ scenarios: { ...q.scenarios!, impliedGrowth: null } }));
        fixture.detectChanges();

        expect(text()).toContain('No growth rate between −20% and 50% justifies today\'s price');
    });

    it('explains when scenarios are not applicable to the latest year', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant({ scenarios: null }));
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('[data-testid="scenarios"]')).toBeNull();
        expect(text()).toContain('Scenario range not applicable');
    });

    it('loads MD&A insights automatically and shows each section with its verified quote', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        const req = httpMock.expectOne(`${ANALYSIS_URL}TCS/insights`);
        expect(req.request.method).toBe('GET');
        expect(component.insightsLoading).toBeTrue();
        req.flush(mdnaInsights());
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="insights-panel"]');
        expect(panel.querySelector('[data-testid="insights-report"]')?.textContent).toContain('FY2025 · fetched');
        expect(panel.querySelector('[data-testid="insights-moat"]')?.textContent).toContain('Moat: narrow');
        const keyPoints = panel.querySelector('[data-testid="insights-keyPoints"]')!;
        expect(keyPoints.textContent).toContain('Revenue grew 18%');
        expect(keyPoints.querySelector('blockquote')?.textContent).toContain('revenue grew 18% this year on strong demand');
        expect(panel.querySelector('[data-testid="insights-growthStrategy"]')?.textContent).toContain('Expand into rural markets');
        expect(panel.querySelector('[data-testid="insights-growthStrategy"] blockquote')).toBeNull();
        expect(panel.querySelector('[data-testid="insights-headwinds"]')?.textContent).toContain('Nothing identified.');
        expect(panel.querySelector('[data-testid="insights-risks"]')?.textContent).toContain('Raw material price volatility');
    });

    it('shows how long the MD&A insights took, also when they fail', () => {
        const now = spyOn(component as unknown as { now(): number }, 'now').and.returnValues(1000, 9240, 2000, 2350);
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        httpMock.expectOne(`${ANALYSIS_URL}TCS/insights`).flush(mdnaInsights());
        fixture.detectChanges();

        expect(component.insightsElapsedMs).toBe(8240);
        expect(fixture.nativeElement.querySelector('[data-testid="insights-time"]')?.textContent).toContain('8.2s');

        component.loadInsights();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-testid="insights-time"]')).toBeNull();
        httpMock.expectOne(`${ANALYSIS_URL}TCS/insights`).flush(
            { error: 'llm-unavailable', message: 'quota' },
            { status: 503, statusText: 'Service Unavailable' }
        );
        expect(component.insightsTimeLabel).toBe('350ms');
        expect(now).toHaveBeenCalledTimes(4);
    });

    it('offers a PDF upload when the latest report cannot be fetched and reloads insights after uploading', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        httpMock.expectOne(`${ANALYSIS_URL}TCS/insights`).flush(
            { error: 'no-reports', message: 'The latest annual report could not be fetched. Upload it as a PDF.' },
            { status: 422, statusText: 'Unprocessable' }
        );
        expect(component.insightsNeedsUpload).toBeTrue();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-testid="insights-upload"]')).not.toBeNull();

        component.uploadYear = 2025;
        const file = new File(['%PDF-'], 'ar.pdf', { type: 'application/pdf' });
        component.onFileSelected({ target: { files: [file] } } as unknown as Event);
        httpMock.expectOne(`${ANALYSIS_URL}TCS/reports?year=2025`).flush({ year: 2025, bytes: 5 });
        httpMock.expectOne(`${ANALYSIS_URL}TCS/insights`).flush(mdnaInsights({ source: 'upload' }));

        expect(component.insightsNeedsUpload).toBeFalse();
        expect(component.insightsReportLabel).toBe('FY2025 · uploaded');
    });

    it('explains a quota or model outage and offers a retry', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        httpMock.expectOne(`${ANALYSIS_URL}TCS/insights`).flush(
            { error: 'llm-unavailable', message: 'The language model is unavailable: quota exceeded' },
            { status: 503, statusText: 'Service Unavailable' }
        );

        expect(text()).toContain('The language model is unavailable: quota exceeded');
        component.loadInsights();
        httpMock.expectOne(`${ANALYSIS_URL}TCS/insights`).flush(mdnaInsights());
        expect(component.insightsError).toBe('');
    });

    it('hides the Qualitative and SWOT panels unless the server enables them', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-testid="qual-panel"]')).toBeNull();
        expect(fixture.nativeElement.querySelector('[data-testid="swot-panel"]')).toBeNull();

        component.features = { insights: true, qualitative: true, swot: true };
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-testid="qual-panel"]')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('[data-testid="swot-panel"]')).not.toBeNull();
    });

    it('sends only the DCF assumptions that differ from the defaults when recalculating', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());

        component.assumptions!.discountRate = 14;
        component.recalculate();
        const req = expectQuant('TCS');
        expect(req.request.params.get('discount')).toBe('14');
        expect(req.request.params.has('growth')).toBeFalse();
        expect(req.request.params.has('terminal')).toBeFalse();
        req.flush(quant({ overridden: true, assumptions: { growthRate: 10, discountRate: 14, terminalGrowthRate: 5 }, score: 4 }));

        expect(component.quant?.overridden).toBeTrue();
        expect(component.assumptions?.discountRate).toBe(14);
    });

    it('keeps the previous result visible when a recalculation fails', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());

        component.assumptions!.discountRate = 4;
        component.recalculate();
        expectQuant('TCS').flush({ error: 'Discount rate must be greater than terminal growth rate' }, { status: 400, statusText: 'Bad Request' });

        expect(component.quant).not.toBeNull();
        expect(text()).toContain('Discount rate must be greater than terminal growth rate');
    });

    it('offers a PDF upload when no annual reports can be fetched', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());

        component.features = { insights: true, qualitative: true, swot: false };
        component.peersText = 'INFY, WIPRO';
        component.runQualitative();
        const req = httpMock.expectOne(`${ANALYSIS_URL}TCS/qualitative`);
        expect(req.request.body).toEqual({ peers: ['INFY', 'WIPRO'] });
        req.flush({ error: 'no-reports', message: 'Annual reports could not be fetched' }, { status: 422, statusText: 'Unprocessable' });

        expect(component.needsUpload).toBeTrue();
        const qualPanel: HTMLElement = (fixture.detectChanges(), fixture.nativeElement.querySelector('[data-testid="qual-panel"]'));
        expect(qualPanel.textContent).toContain('Upload annual report PDF');
    });

    it('runs the SWOT analysis and shows a partial result when the report is unavailable', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());

        component.features = { insights: true, qualitative: false, swot: true };
        component.runSwot();
        const req = httpMock.expectOne(`${ANALYSIS_URL}TCS/swot`);
        expect(req.request.method).toBe('POST');
        const empty = { items: [], lowerConfidence: false };
        req.flush({
            ticker: 'TCS',
            model: 'm',
            experimental: true,
            report: { status: 'llm-unavailable', message: 'The local model is unavailable.', year: null, source: null, cached: false },
            financials: { status: 'ok', year: 2025, message: null },
            strengths: { items: [{ text: 'High ROE of 25.0%', source: 'financials', evidence: 'ROE: 25.0%' }], lowerConfidence: false },
            weaknesses: empty,
            opportunities: empty,
            threats: { items: [], lowerConfidence: true }
        });
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="swot-panel"]');
        expect(panel.querySelector('[data-testid="swot-report-status"]')?.textContent).toContain('The local model is unavailable.');
        const strengths = panel.querySelector('[data-testid="swot-strengths"]')!;
        expect(strengths.textContent).toContain('High ROE of 25.0%');
        expect(strengths.querySelector('[data-source="financials"]')).not.toBeNull();
        expect(strengths.textContent).toContain('ROE: 25.0%');
        expect(panel.querySelector('[data-testid="swot-threats"]')?.textContent).toContain('lower confidence');
        expect(panel.querySelector('[data-testid="swot-opportunities"]')?.textContent).toContain('Nothing identified.');
    });

    it('runs the Guidance scorecard on demand and shows each claim with its verdict', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[data-testid="guidance-panel"]')?.textContent).toContain('Run guidance scorecard');

        component.runGuidance();
        const req = httpMock.expectOne(`${ANALYSIS_URL}TCS/guidance`);
        expect(req.request.method).toBe('POST');
        req.flush({
            ticker: 'TCS',
            model: 'm',
            experimental: true,
            lowerConfidence: true,
            hitRate: 0,
            years: [
                {
                    year: 2023,
                    status: 'ok',
                    cached: true,
                    claims: [
                        { metric: 'revenueGrowth', target: { min: 0.15, max: 0.15 }, horizon: 2024, quote: 'We expect 15% growth in FY24', actual: 0.09, verdict: 'missed' },
                        { metric: 'other', target: null, horizon: null, quote: 'Strong growth ahead for our business', actual: null, verdict: 'unscored' }
                    ]
                },
                { year: 2022, status: 'llm-unavailable', cached: false, claims: [] }
            ]
        });
        fixture.detectChanges();

        const panel: HTMLElement = fixture.nativeElement.querySelector('[data-testid="guidance-panel"]');
        expect(panel.querySelector('[data-testid="guidance-hit-rate"]')?.textContent).toContain('0% met');
        expect(panel.querySelector('[data-testid="guidance-low-confidence"]')).not.toBeNull();
        const year = panel.querySelector('[data-testid="guidance-year-2023"]')!;
        expect(year.textContent?.replace(/\s+/g, ' ')).toContain('Revenue growth · target 15% for FY2024 · actual 9%');
        expect(year.querySelector('[data-tone="bad"]')?.textContent).toContain('missed');
        expect(year.textContent).toContain('Strong growth ahead for our business');
        expect(panel.querySelector('[data-testid="guidance-year-2022"]')?.textContent).toContain('language model is unavailable');
    });

    it('records the ticker in the URL so the page can be shared', () => {
        const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
        search('infy');
        httpMock.expectOne(`${STOCK_URL}INFY`).flush(emptyMetrics());
        expectQuant('INFY').flush(quant());

        expect(navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { q: 'INFY' } }));
    });
});

describe('StockDashboardComponent deep link', () => {
    it('loads the ticker from the ?q= query parameter', async () => {
        await TestBed.configureTestingModule({
            imports: [StockDashboardComponent],
            providers: [
                provideRouter([]),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ q: 'itc' })) } }
            ]
        }).compileComponents();

        const fixture = TestBed.createComponent(StockDashboardComponent);
        const httpMock = TestBed.inject(HttpTestingController);
        fixture.detectChanges();

        expect(fixture.componentInstance.ticker).toBe('ITC');
        httpMock.expectOne(`${ANALYSIS_URL}features`).flush(DEFAULT_FEATURES);
        httpMock.expectOne(`${STOCK_URL}ITC`).flush(emptyMetrics());
        httpMock.expectOne((r) => r.url === `${ANALYSIS_URL}ITC/quantitative`).flush(quant());
        httpMock.expectOne(`${ANALYSIS_URL}ITC/insights`).flush(mdnaInsights({ ticker: 'ITC' }));
        httpMock.expectOne((r) => r.url === `${ANALYSIS_URL}ITC/reverse-dcf`).flush(reverseDcf({ ticker: 'ITC' }));
        httpMock.expectOne(`${ANALYSIS_URL}ITC/statements`).flush({ ticker: 'ITC', years: [] });
        httpMock.expectOne(`${ANALYSIS_URL}ITC/red-flags`).flush(redFlags({ ticker: 'ITC' }));
        httpMock.verify();
    });
});
