import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StockMetrics } from '../models/stock-metrics';

@Injectable({ providedIn: 'root' })
export class StockService {
    private readonly baseUrl = 'http://localhost:3000/api/stock';

    constructor(private http: HttpClient) {}

    getStock(ticker: string): Observable<StockMetrics> {
        return this.http.get<StockMetrics>(this.baseUrl + '/' + ticker);
    }
}
