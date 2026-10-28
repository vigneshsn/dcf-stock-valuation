import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Features, FinancialStatements, GuidanceScorecard, MdnaInsights, Peer, QualitativeAnalysis, QuantitativeAnalysis, RedFlagScan, ReverseDcfAnalysis, StrengthsWeaknesses, SwotAnalysis } from '../models/analysis';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
    private readonly baseUrl = 'http://localhost:3000/api/analysis';

    constructor(private http: HttpClient) {}

    getFeatures(): Observable<Features> {
        return this.http.get<Features>(`${this.baseUrl}/features`);
    }

    getInsights(ticker: string): Observable<MdnaInsights> {
        return this.http.get<MdnaInsights>(`${this.baseUrl}/${encodeURIComponent(ticker)}/insights`);
    }

    getQuantitative(ticker: string, overrides: { growth?: number | null; discount?: number | null; terminal?: number | null } = {}): Observable<QuantitativeAnalysis> {
        return this.http.get<QuantitativeAnalysis>(`${this.baseUrl}/${encodeURIComponent(ticker)}/quantitative`, {
            params: overrideParams(overrides)
        });
    }

    /** Growth is what the reverse DCF solves for, so only discount and terminal growth can be overridden. */
    getReverseDcf(ticker: string, overrides: { discount?: number | null; terminal?: number | null } = {}): Observable<ReverseDcfAnalysis> {
        return this.http.get<ReverseDcfAnalysis>(`${this.baseUrl}/${encodeURIComponent(ticker)}/reverse-dcf`, {
            params: overrideParams(overrides)
        });
    }

    getRedFlags(ticker: string): Observable<RedFlagScan> {
        return this.http.get<RedFlagScan>(`${this.baseUrl}/${encodeURIComponent(ticker)}/red-flags`);
    }

    getStatements(ticker: string): Observable<FinancialStatements> {
        return this.http.get<FinancialStatements>(`${this.baseUrl}/${encodeURIComponent(ticker)}/statements`);
    }

    getStrengthsWeaknesses(ticker: string): Observable<StrengthsWeaknesses> {
        return this.http.get<StrengthsWeaknesses>(`${this.baseUrl}/${encodeURIComponent(ticker)}/strengths-weaknesses`);
    }

    getGuidance(ticker: string): Observable<GuidanceScorecard> {
        return this.http.post<GuidanceScorecard>(`${this.baseUrl}/${encodeURIComponent(ticker)}/guidance`, {});
    }

    getPeers(ticker: string): Observable<{ ticker: string; peers: Peer[] }> {
        return this.http.get<{ ticker: string; peers: Peer[] }>(`${this.baseUrl}/${encodeURIComponent(ticker)}/peers`);
    }

    getQualitative(ticker: string, peers?: string[]): Observable<QualitativeAnalysis> {
        return this.http.post<QualitativeAnalysis>(`${this.baseUrl}/${encodeURIComponent(ticker)}/qualitative`, peers ? { peers } : {});
    }

    getSwot(ticker: string): Observable<SwotAnalysis> {
        return this.http.post<SwotAnalysis>(`${this.baseUrl}/${encodeURIComponent(ticker)}/swot`, {});
    }

    uploadReport(ticker: string, year: number, file: File): Observable<{ year: number; bytes: number }> {
        return this.http.post<{ year: number; bytes: number }>(
            `${this.baseUrl}/${encodeURIComponent(ticker)}/reports?year=${year}`,
            file,
            { headers: { 'Content-Type': 'application/pdf' } }
        );
    }
}

function overrideParams(overrides: Record<string, number | null | undefined>): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== null && value !== undefined && String(value) !== '') {
            params = params.set(key, String(value));
        }
    }
    return params;
}
