import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { StockService } from './stock.service';
import { StockMetrics } from '../models/stock-metrics';

describe('StockService', () => {
    let service: StockService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [StockService]
        });
        service = TestBed.inject(StockService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('should issue a GET to the expected URL and resolve with mocked metrics', () => {
        const mockMetrics: StockMetrics = {
            marketCap: 100,
            currentPrice: 10,
            week52High: 20,
            week52Low: 5,
            peRatio: 15,
            bookValue: 8,
            dividendYield: 1.5,
            roce: 12,
            roe: 14,
            companyIntroduction: null,
            news: [],
            peers: [],
            analystConsensus: null
        };

        service.getStock('RELIANCE').subscribe((res) => {
            expect(res).toEqual(mockMetrics);
        });

        const req = httpMock.expectOne('http://localhost:3000/api/stock/RELIANCE');
        expect(req.request.method).toBe('GET');
        req.flush(mockMetrics);
    });
});
