import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FundamentalsComponent } from './fundamentals.component';
import { StockMetrics } from '../models/stock-metrics';

describe('FundamentalsComponent', () => {
    let component: FundamentalsComponent;
    let fixture: ComponentFixture<FundamentalsComponent>;
    let httpMock: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [FundamentalsComponent, HttpClientTestingModule]
        }).compileComponents();

        fixture = TestBed.createComponent(FundamentalsComponent);
        component = fixture.componentInstance;
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('sets state to error and errorType to not-found on 404', () => {
        component.ticker = 'BADTICKER';
        component.search();
        const req = httpMock.expectOne('http://localhost:3000/api/stock/BADTICKER');
        req.flush('Not found', { status: 404, statusText: 'Not Found' });

        expect(component.state).toBe('error');
        expect(component.errorType).toBe('not-found');
    });

    it('sets errorType to upstream on 502', () => {
        component.ticker = 'RELIANCE';
        component.search();
        const req = httpMock.expectOne('http://localhost:3000/api/stock/RELIANCE');
        req.flush('Bad gateway', { status: 502, statusText: 'Bad Gateway' });

        expect(component.state).toBe('error');
        expect(component.errorType).toBe('upstream');
    });

    it('sets state to data and reflects nulls on valid partial payload', () => {
        const partial: StockMetrics = {
            marketCap: 100,
            currentPrice: null,
            week52High: 20,
            week52Low: null,
            peRatio: 15,
            bookValue: null,
            dividendYield: 1.5,
            roce: null,
            roe: 14,
            companyIntroduction: null,
            news: [],
            peers: [],
            analystConsensus: null
        };

        component.ticker = 'TCS';
        component.search();
        const req = httpMock.expectOne('http://localhost:3000/api/stock/TCS');
        req.flush(partial);

        expect(component.state).toBe('data');
        expect(component.metrics).toEqual(partial);
        expect(component.metrics?.currentPrice).toBeNull();
        expect(component.metrics?.roce).toBeNull();
    });

    it('renders the company context, peer comparison, current consensus and percentage-point returns', () => {
        const populated: StockMetrics = {
            marketCap: 125000000,
            currentPrice: 321.5,
            week52High: 350,
            week52Low: 250,
            peRatio: 18.5,
            bookValue: 42,
            dividendYield: 1.2,
            roce: 20,
            roe: 14,
            companyIntroduction: {
                name: 'Acme Industries',
                industry: 'Manufacturing',
                description: 'Makes useful things.'
            },
            news: [{
                headline: 'Acme expands production',
                publishedAt: '2026-10-20T10:00:00Z',
                source: null,
                url: 'https://www.livemint.com/news/acme'
            }],
            peers: [{
                name: 'Peer Corp',
                price: 200,
                marketCap: 50000000,
                peRatio: 12,
                pbRatio: 2,
                roe: 15,
                debtToEquity: 0.3,
                profitMargin: 9.5,
                dividendYield: 1.1
            }],
            analystConsensus: {
                source: 'IndianAPI',
                recommendation: 'Buy',
                counts: {
                    strongBuy: 2,
                    buy: 4,
                    hold: 1,
                    sell: 0,
                    strongSell: 0
                }
            }
        };

        component.ticker = 'ACME';
        component.search();
        httpMock.expectOne('http://localhost:3000/api/stock/ACME').flush(populated);
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('Acme Industries');
        expect(content).toContain('Makes useful things.');
        expect(content).toContain('Acme expands production');
        expect(content).toContain('Peer Corp');
        expect(content).toContain('Analyst consensus');
        expect(content).toContain('Source: IndianAPI');
        expect(content).toContain('20%');
        expect(content).toContain('14%');
        expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
    });

    it('keeps optional sections empty when the selected provider has no supplemental data', () => {
        const fmpMetrics: StockMetrics = {
            marketCap: 100,
            currentPrice: 10,
            week52High: 20,
            week52Low: 5,
            peRatio: null,
            bookValue: null,
            dividendYield: null,
            roce: null,
            roe: null,
            companyIntroduction: null,
            news: [],
            peers: [],
            analystConsensus: null
        };

        component.ticker = 'ACME';
        component.search();
        httpMock.expectOne('http://localhost:3000/api/stock/ACME').flush(fmpMetrics);
        fixture.detectChanges();

        const content = fixture.nativeElement.textContent as string;
        expect(content).toContain('No recent news available.');
        expect(content).toContain('No peer comparison data available.');
        expect(content).not.toContain('Analyst consensus');
        expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
    });
});
