import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FundamentalsComponent } from './fundamentals.component';
import { StockMetrics } from '../models/stock-metrics';

describe('FundamentalsComponent', () => {
    let component: FundamentalsComponent;
    let httpMock: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [FundamentalsComponent, HttpClientTestingModule]
        }).compileComponents();

        const fixture = TestBed.createComponent(FundamentalsComponent);
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
            roe: 14
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
});
