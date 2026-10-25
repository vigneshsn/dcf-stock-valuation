import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Features, MdnaInsights, Peer, QualitativeAnalysis, QuantitativeAnalysis, SwotAnalysis } from '../models/analysis';

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
        let params = new HttpParams();
        for (const [key, value] of Object.entries(overrides)) {
            if (value !== null && value !== undefined && String(value) !== '') {
                params = params.set(key, String(value));
            }
        }
        return this.http.get<QuantitativeAnalysis>(`${this.baseUrl}/${encodeURIComponent(ticker)}/quantitative`, { params });
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
