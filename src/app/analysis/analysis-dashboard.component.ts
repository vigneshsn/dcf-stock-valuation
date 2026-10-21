import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { AnalysisService } from '../services/analysis.service';
import { QualitativeAnalysis, QuantitativeAnalysis } from '../models/analysis';

@Component({
    selector: 'app-analysis-dashboard',
    templateUrl: './analysis-dashboard.component.html',
    styleUrls: ['./analysis-dashboard.component.css'],
    imports: [CommonModule, FormsModule],
    standalone: true
})
export class AnalysisDashboardComponent {
    ticker = '';
    activeTicker = '';

    quant: QuantitativeAnalysis | null = null;
    quantLoading = false;
    quantError = '';

    growth: number | null = null;
    discount: number | null = null;
    terminal: number | null = null;

    qual: QualitativeAnalysis | null = null;
    qualLoading = false;
    qualError = '';
    needsUpload = false;
    peersText = '';
    uploadYear = new Date().getFullYear() - 1;
    uploadMessage = '';

    constructor(private analysis: AnalysisService) {}

    run(): void {
        this.activeTicker = this.ticker.trim();
        if (!this.activeTicker) {
            return;
        }
        this.growth = this.discount = this.terminal = null;
        this.qual = null;
        this.qualError = '';
        this.needsUpload = false;
        this.loadQuant();
    }

    loadQuant(): void {
        this.quantLoading = true;
        this.quantError = '';
        this.analysis.getQuantitative(this.activeTicker, { growth: this.growth, discount: this.discount, terminal: this.terminal }).subscribe({
            next: (q) => {
                this.quant = q;
                this.quantLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.quant = null;
                this.quantLoading = false;
                this.quantError = err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    resetOverrides(): void {
        this.growth = this.discount = this.terminal = null;
        this.loadQuant();
    }

    runQualitative(): void {
        this.qualLoading = true;
        this.qualError = '';
        this.needsUpload = false;
        const peers = this.peersText.split(',').map((p) => p.trim()).filter(Boolean);
        this.analysis.getQualitative(this.activeTicker, peers.length ? peers : undefined).subscribe({
            next: (q) => {
                this.qual = q;
                this.qualLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.qual = null;
                this.qualLoading = false;
                this.needsUpload = err.error?.error === 'no-reports';
                this.qualError = err.error?.message ?? err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    onFileSelected(event: Event): void {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) {
            return;
        }
        this.analysis.uploadReport(this.activeTicker, this.uploadYear, file).subscribe({
            next: (r) => (this.uploadMessage = `Uploaded ${r.year} annual report`),
            error: (err: HttpErrorResponse) => (this.uploadMessage = err.error?.error ?? 'Upload failed')
        });
    }
}
