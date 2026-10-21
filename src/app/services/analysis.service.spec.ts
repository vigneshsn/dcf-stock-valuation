import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AnalysisService } from './analysis.service';

describe('AnalysisService', () => {
    let service: AnalysisService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
        service = TestBed.inject(AnalysisService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    it('sends only provided DCF overrides as query params', () => {
        service.getQuantitative('ABC', { growth: 8, discount: null }).subscribe();
        const req = httpMock.expectOne((r) => r.url === 'http://localhost:3000/api/analysis/ABC/quantitative');
        expect(req.request.params.get('growth')).toBe('8');
        expect(req.request.params.has('discount')).toBeFalse();
        req.flush({});
    });

    it('posts the peer override to the qualitative endpoint', () => {
        service.getQualitative('ABC', ['X', 'Y']).subscribe();
        const req = httpMock.expectOne('http://localhost:3000/api/analysis/ABC/qualitative');
        expect(req.request.body).toEqual({ peers: ['X', 'Y'] });
        req.flush({});
    });
});
