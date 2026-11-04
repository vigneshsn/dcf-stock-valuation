import { environment } from '../../environments/environment';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StockMetrics } from '../models/stock-metrics';

@Injectable({ providedIn: 'root' })
export class StockService {
    private readonly baseUrl = `${environment.apiUrl}/api/stock`;

    constructor(private http: HttpClient) {}

    getStock(ticker: string): Observable<StockMetrics> {
        return this.http.get<StockMetrics>(this.baseUrl + '/' + encodeURIComponent(ticker.trim()));
    }
}
