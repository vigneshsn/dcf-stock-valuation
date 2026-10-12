import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { StockService } from '../services/stock.service';
import { StockMetrics } from '../models/stock-metrics';

type ViewState = 'idle' | 'loading' | 'data' | 'error';
type ErrorType = 'not-found' | 'upstream' | 'network' | null;

@Component({
    selector: 'app-fundamentals',
    templateUrl: './fundamentals.component.html',
    imports: [
        CommonModule,
        FormsModule
    ],
    standalone: true,
    styleUrls: ['./fundamentals.component.css']
})
export class FundamentalsComponent {

    ticker = '';
    state: ViewState = 'idle';
    errorType: ErrorType = null;
    metrics: StockMetrics | null = null;

    constructor(private stockService: StockService) {}

    search(): void {
        this.state = 'loading';
        this.errorType = null;
        this.stockService.getStock(this.ticker.trim()).subscribe({
            next: (m) => {
                this.metrics = m;
                this.state = 'data';
            },
            error: (err: HttpErrorResponse) => {
                console.error('StockService.getStock failed', err);
                this.state = 'error';
                this.errorType = err.status === 404 ? 'not-found' : err.status === 502 ? 'upstream' : 'network';
            }
        });
    }

    getErrorMessage(): string {
        switch (this.errorType) {
            case 'not-found':
                return 'Ticker not found';
            case 'upstream':
                return 'Upstream data source failed, please retry';
            case 'network':
                return 'Network error, please retry';
            default:
                return '';
        }
    }
}
