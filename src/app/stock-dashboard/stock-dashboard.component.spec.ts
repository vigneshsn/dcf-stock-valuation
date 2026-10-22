import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { StockDashboardComponent } from './stock-dashboard.component';
import { StockMetrics } from '../models/stock-metrics';
import { QuantitativeAnalysis } from '../models/analysis';

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
        await TestBed.configureTestingModule({
            imports: [StockDashboardComponent],
            providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
        }).compileComponents();

        fixture = TestBed.createComponent(StockDashboardComponent);
        component = fixture.componentInstance;
        httpMock = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
    });

    afterEach(() => {
        httpMock.verify();
    });

    function search(ticker: string): void {
        component.query = ticker;
        component.search();
    }

    function expectQuant(ticker: string) {
        return httpMock.expectOne((r) => r.url === `${ANALYSIS_URL}${ticker}/quantitative`);
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

    it('renders company context, returns, news, peers and analyst consensus', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({
            marketCap: 125000000,
            currentPrice: 321.5,
            week52High: 350,
            week52Low: 250,
            roce: 20,
            roe: 14,
            companyIntroduction: { name: 'Acme Industries', industry: 'Manufacturing', description: 'Makes useful things.' },
            news: [{ headline: 'Acme expands production', publishedAt: '2026-10-20T10:00:00Z', source: null, url: 'https://www.livemint.com/news/acme' }],
            peers: [
                { name: 'Peer Corp', price: 200, marketCap: 50000, peRatio: 12, pbRatio: 2, roe: 15, debtToEquity: 0.3, profitMargin: 9.5, dividendYield: 1.1 },
                { name: 'Peer with missing metrics', price: null, marketCap: null, peRatio: null, pbRatio: null, roe: null, debtToEquity: null, profitMargin: null, dividendYield: null }
            ],
            analystConsensus: { source: 'IndianAPI', recommendation: 'Buy', counts: { strongBuy: 2, buy: 4, hold: 1, sell: 0, strongSell: 0 } }
        }));
        expectQuant('ACME').flush(quant());

        const content = text();
        expect(content).toContain('Acme Industries');
        expect(content).toContain('Makes useful things.');
        expect(content).toContain('Acme expands production');
        expect(content).toContain('Peer Corp');
        expect(content).toContain('Analyst consensus');
        expect(content).toContain('Source: IndianAPI');
        expect(content).toContain('20%');
        expect(content).toContain('14%');
        expect(component.rangePosition).toBeCloseTo(71.5, 1);
        expect(component.analystTotal).toBe(7);

        const rows = fixture.nativeElement.querySelectorAll('tbody tr');
        expect(rows.length).toBe(2);
        const missingRow = rows[1] as HTMLTableRowElement;
        expect(Array.from(missingRow.cells).slice(1).map((cell) => cell.textContent?.trim() ?? '')).toEqual([
            '', '', '', '', '', '', '', ''
        ]);
    });

    it('keeps optional sections empty when the provider has no supplemental data', () => {
        search('ACME');
        httpMock.expectOne(`${STOCK_URL}ACME`).flush(emptyMetrics({ marketCap: 100, currentPrice: 10 }));
        expectQuant('ACME').flush(quant());

        const content = text();
        expect(content).toContain('No recent news available.');
        expect(content).toContain('No peer comparison data available.');
        expect(content).not.toContain('Analyst consensus');
        expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
    });

    it('normalises market cap to crores for both providers', () => {
        expect(component.marketCapCrores(327900.15)).toBe(327900.15);
        expect(component.marketCapCrores(3279001500000)).toBeCloseTo(327900.15, 2);
        expect(component.marketCapCrores(null)).toBeNull();
    });

    it('shows the Quantitative score, verdict and upside side by side with the Qualitative panel', () => {
        search('TCS');
        httpMock.expectOne(`${STOCK_URL}TCS`).flush(emptyMetrics());
        expectQuant('TCS').flush(quant());

        const content = text();
        expect(fixture.nativeElement.querySelector('[data-testid="quant-score"]').textContent.trim()).toBe('5');
        expect(content).toContain('Steal zone');
        expect(component.upside).toBeCloseTo(50, 5);
        expect(content).toContain('+50%');
        expect(fixture.nativeElement.querySelector('[data-testid="qual-panel"]')).not.toBeNull();
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

        component.peersText = 'INFY, WIPRO';
        component.runQualitative();
        const req = httpMock.expectOne(`${ANALYSIS_URL}TCS/qualitative`);
        expect(req.request.body).toEqual({ peers: ['INFY', 'WIPRO'] });
        req.flush({ error: 'no-reports', message: 'Annual reports could not be fetched' }, { status: 422, statusText: 'Unprocessable' });

        expect(component.needsUpload).toBeTrue();
        expect(text()).toContain('Upload annual report PDF');
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
        httpMock.expectOne(`${STOCK_URL}ITC`).flush(emptyMetrics());
        httpMock.expectOne((r) => r.url === `${ANALYSIS_URL}ITC/quantitative`).flush(quant());
        httpMock.verify();
    });
});
