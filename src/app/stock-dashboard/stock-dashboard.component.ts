import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { StockService } from '../services/stock.service';
import { AnalysisService } from '../services/analysis.service';
import { PeerRow, StockMetrics, marketCapCrores } from '../models/stock-metrics';
import { PeerComparisonComponent } from '../peer-comparison/peer-comparison.component';
import { ScoreRingComponent } from '../score-ring/score-ring.component';
import { DcfAssumptions, GuidanceOutcome, MoatRating, QualitativeAnalysis, QuantitativeAnalysis, SwotAnalysis, SwotQuadrantKey } from '../models/analysis';

type LoadState = 'idle' | 'loading' | 'data' | 'error';
type Tone = 'good' | 'neutral' | 'warn' | 'bad';

interface Verdict {
    label: string;
    emoji: string;
    tone: Tone;
}

const QUANT_VERDICTS: Record<number, Verdict> = {
    5: { label: 'Steal zone', emoji: '🔥', tone: 'good' },
    4: { label: 'Undervalued', emoji: '💸', tone: 'good' },
    3: { label: 'Fairly priced', emoji: '⚖️', tone: 'neutral' },
    2: { label: 'Pricey', emoji: '😬', tone: 'warn' },
    1: { label: 'Overhyped', emoji: '🫠', tone: 'bad' }
};

const QUAL_VERDICTS: Record<number, Verdict> = {
    5: { label: 'Elite quality', emoji: '👑', tone: 'good' },
    4: { label: 'Solid business', emoji: '💪', tone: 'good' },
    3: { label: 'Mixed signals', emoji: '🤷', tone: 'neutral' },
    2: { label: 'Shaky', emoji: '⚠️', tone: 'warn' },
    1: { label: 'Red flags', emoji: '🚩', tone: 'bad' }
};

const SWOT_QUADRANTS: { key: SwotQuadrantKey; label: string; icon: string; tone: Tone }[] = [
    { key: 'strengths', label: 'Strengths', icon: 'trending_up', tone: 'good' },
    { key: 'weaknesses', label: 'Weaknesses', icon: 'trending_down', tone: 'bad' },
    { key: 'opportunities', label: 'Opportunities', icon: 'lightbulb', tone: 'neutral' },
    { key: 'threats', label: 'Threats', icon: 'warning_amber', tone: 'warn' }
];

const MOAT_TONES: Record<MoatRating, Tone> = { wide: 'good', narrow: 'neutral', none: 'bad' };
const OUTCOME_TONES: Record<GuidanceOutcome, Tone> = { met: 'good', partly: 'warn', missed: 'bad' };

@Component({
    selector: 'app-stock-dashboard',
    templateUrl: './stock-dashboard.component.html',
    styleUrls: ['./stock-dashboard.component.css'],
    imports: [CommonModule, FormsModule, ScoreRingComponent, PeerComparisonComponent],
    standalone: true
})
export class StockDashboardComponent implements OnInit, OnDestroy {
    private readonly stockService = inject(StockService);
    private readonly analysis = inject(AnalysisService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    readonly suggestions = ['TCS', 'RELIANCE', 'INFY', 'ITC', 'HDFCBANK'];

    query = '';
    ticker = '';

    stockState: LoadState = 'idle';
    stockError = '';
    metrics: StockMetrics | null = null;
    showFullDescription = false;

    quant: QuantitativeAnalysis | null = null;
    quantLoading = false;
    quantError = '';
    assumptions: DcfAssumptions | null = null;
    showAssumptions = true;

    qual: QualitativeAnalysis | null = null;
    qualLoading = false;
    qualError = '';
    needsUpload = false;
    peersText = '';
    uploadYear = new Date().getFullYear() - 1;
    uploadMessage = '';

    swot: SwotAnalysis | null = null;
    swotLoading = false;
    swotError = '';
    readonly swotQuadrants = SWOT_QUADRANTS;

    private stockSub?: Subscription;
    private quantSub?: Subscription;
    private qualSub?: Subscription;
    private swotSub?: Subscription;

    ngOnInit(): void {
        this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
            const q = this.normalise(params.get('q') ?? '');
            if (q && q !== this.ticker) {
                this.load(q);
            }
        });
    }

    ngOnDestroy(): void {
        this.stockSub?.unsubscribe();
        this.quantSub?.unsubscribe();
        this.qualSub?.unsubscribe();
        this.swotSub?.unsubscribe();
    }

    search(): void {
        const t = this.normalise(this.query);
        if (!t) {
            return;
        }
        this.load(t);
        this.router.navigate([], { relativeTo: this.route, queryParams: { q: t } });
    }

    pick(ticker: string): void {
        this.query = ticker;
        this.search();
    }

    load(ticker: string): void {
        this.ticker = ticker;
        this.query = ticker;
        this.showFullDescription = false;
        this.resetQualitative();
        this.resetSwot();
        this.loadStock();
        this.quant = null;
        this.assumptions = null;
        this.loadQuant();
    }

    // ---- Fundamentals -------------------------------------------------------

    loadStock(): void {
        this.stockSub?.unsubscribe();
        this.stockState = 'loading';
        this.stockError = '';
        this.metrics = null;
        this.stockSub = this.stockService.getStock(this.ticker).subscribe({
            next: (m) => {
                this.metrics = m;
                this.stockState = 'data';
            },
            error: (err: HttpErrorResponse) => {
                this.stockState = 'error';
                this.stockError = err.status === 404
                    ? 'Ticker not found'
                    : err.status === 502
                        ? 'Upstream data source failed, please retry'
                        : 'Network error, please retry';
            }
        });
    }

    get companyName(): string {
        return this.metrics?.companyIntroduction?.name || this.ticker;
    }

    get price(): number | null {
        return this.metrics?.currentPrice ?? this.quant?.price ?? null;
    }

    /** Position (0-100) of the current price inside the 52-week range, or null when unknown. */
    get rangePosition(): number | null {
        const low = this.metrics?.week52Low;
        const high = this.metrics?.week52High;
        const price = this.price;
        if (low == null || high == null || price == null || high <= low) {
            return null;
        }
        return Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
    }

    readonly marketCapCrores = marketCapCrores;

    get consensusSegments(): { key: string; label: string; count: number; pct: number }[] {
        const counts = this.metrics?.analystConsensus?.counts;
        if (!counts) {
            return [];
        }
        const rows = [
            { key: 'strong-buy', label: 'Strong buy', count: counts.strongBuy ?? 0 },
            { key: 'buy', label: 'Buy', count: counts.buy ?? 0 },
            { key: 'hold', label: 'Hold', count: counts.hold ?? 0 },
            { key: 'sell', label: 'Sell', count: counts.sell ?? 0 },
            { key: 'strong-sell', label: 'Strong sell', count: counts.strongSell ?? 0 }
        ];
        const total = rows.reduce((sum, r) => sum + r.count, 0);
        return rows.map((r) => ({ ...r, pct: total ? (r.count / total) * 100 : 0 }));
    }

    get analystTotal(): number {
        return this.consensusSegments.reduce((sum, s) => sum + s.count, 0);
    }

    /**
     * Peer table rows with the current stock pinned first and flagged. If the provider already lists the
     * company among its peers, that entry is reused (gap-filled from the stock's own metrics) instead of duplicated.
     */
    get peerRows(): PeerRow[] {
        const m = this.metrics;
        if (!m?.peers.length) {
            return [];
        }
        const name = this.companyName;
        const key = name.trim().toLowerCase();
        const listed = m.peers.find((p) => p.name.trim().toLowerCase() === key);
        const current: PeerRow = {
            name: listed?.name ?? name,
            price: m.currentPrice ?? listed?.price ?? null,
            marketCap: m.marketCap ?? listed?.marketCap ?? null,
            peRatio: m.peRatio ?? listed?.peRatio ?? null,
            pbRatio: this.quant?.ratios.pb ?? listed?.pbRatio ?? null,
            roe: m.roe ?? listed?.roe ?? null,
            debtToEquity: listed?.debtToEquity ?? null,
            profitMargin: listed?.profitMargin ?? null,
            dividendYield: m.dividendYield ?? listed?.dividendYield ?? null,
            current: true
        };
        return [current, ...m.peers.filter((p) => p !== listed).map((p) => ({ ...p, current: false }))];
    }

    // ---- Quantitative analysis ---------------------------------------------

    loadQuant(overrides: { growth?: number | null; discount?: number | null; terminal?: number | null } = {}): void {
        this.quantSub?.unsubscribe();
        this.quantLoading = true;
        this.quantError = '';
        this.quantSub = this.analysis.getQuantitative(this.ticker, overrides).subscribe({
            next: (q) => {
                this.quant = q;
                this.assumptions = { ...q.assumptions };
                this.quantLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.quantLoading = false;
                this.quantError = err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    /** Re-runs the DCF, sending only the assumptions that differ from the server defaults. */
    recalculate(): void {
        if (!this.quant || !this.assumptions) {
            return;
        }
        const d = this.quant.defaults;
        const a = this.assumptions;
        this.loadQuant({
            growth: a.growthRate !== d.growthRate ? a.growthRate : null,
            discount: a.discountRate !== d.discountRate ? a.discountRate : null,
            terminal: a.terminalGrowthRate !== d.terminalGrowthRate ? a.terminalGrowthRate : null
        });
    }

    resetAssumptions(): void {
        if (this.quant) {
            this.assumptions = { ...this.quant.defaults };
        }
        this.loadQuant();
    }

    get upside(): number | null {
        if (!this.quant || !this.quant.price) {
            return null;
        }
        return ((this.quant.fairValue - this.quant.price) / this.quant.price) * 100;
    }

    /** Keeps the server default reachable on the slider even when it exceeds the usual range. */
    sliderMax(defaultValue: number, usualMax: number): number {
        return Math.max(usualMax, Math.ceil(defaultValue + 5));
    }

    quantVerdict(score: number): Verdict {
        return QUANT_VERDICTS[score] ?? QUANT_VERDICTS[3];
    }

    // ---- Qualitative analysis ----------------------------------------------

    runQualitative(): void {
        this.qualSub?.unsubscribe();
        this.qualLoading = true;
        this.qualError = '';
        this.needsUpload = false;
        const peers = this.peersText.split(',').map((p) => p.trim()).filter(Boolean);
        this.qualSub = this.analysis.getQualitative(this.ticker, peers.length ? peers : undefined).subscribe({
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
        this.analysis.uploadReport(this.ticker, this.uploadYear, file).subscribe({
            next: (r) => (this.uploadMessage = `Uploaded ${r.year} annual report, run the analysis again`),
            error: (err: HttpErrorResponse) => (this.uploadMessage = err.error?.error ?? 'Upload failed')
        });
    }

    qualVerdict(score: number): Verdict {
        return QUAL_VERDICTS[score] ?? QUAL_VERDICTS[3];
    }

    moatTone(rating: MoatRating): Tone {
        return MOAT_TONES[rating] ?? 'neutral';
    }

    outcomeTone(outcome: GuidanceOutcome): Tone {
        return OUTCOME_TONES[outcome] ?? 'neutral';
    }

    // ---- SWOT analysis -------------------------------------------------------

    runSwot(): void {
        this.swotSub?.unsubscribe();
        this.swotLoading = true;
        this.swotError = '';
        this.swotSub = this.analysis.getSwot(this.ticker).subscribe({
            next: (s) => {
                this.swot = s;
                this.swotLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.swot = null;
                this.swotLoading = false;
                this.swotError = err.status === 404
                    ? 'Ticker not found'
                    : err.error?.message ?? err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    get swotReportLabel(): string | null {
        const r = this.swot?.report;
        if (!r?.year) {
            return null;
        }
        return `FY${r.year} · ${r.source === 'upload' ? 'uploaded' : 'fetched'}`;
    }

    private resetSwot(): void {
        this.swotSub?.unsubscribe();
        this.swot = null;
        this.swotLoading = false;
        this.swotError = '';
    }

    private resetQualitative(): void {
        this.qualSub?.unsubscribe();
        this.qual = null;
        this.qualLoading = false;
        this.qualError = '';
        this.needsUpload = false;
        this.uploadMessage = '';
        this.peersText = '';
    }

    private normalise(value: string): string {
        return value.trim().toUpperCase();
    }
}
