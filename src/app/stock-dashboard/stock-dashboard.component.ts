import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { StockService } from '../services/stock.service';
import { AnalysisService } from '../services/analysis.service';
import { ReadingModeService } from '../services/reading-mode.service';
import { PeerRow, StockMetrics, marketCapCrores } from '../models/stock-metrics';
import { PeerComparisonComponent } from '../peer-comparison/peer-comparison.component';
import { ScoreRingComponent } from '../score-ring/score-ring.component';
import { ScenarioRangeComponent } from '../scenario-range/scenario-range.component';
import { ReverseDcfComponent } from '../reverse-dcf/reverse-dcf.component';
import { FinancialStatementsComponent } from '../financial-statements/financial-statements.component';
import {
    DcfAssumptions,
    FinancialStatements,
    InsightListKey,
    MdnaInsights,
    MoatRating,
    QuantitativeAnalysis,
    RedFlagId,
    RedFlagScan,
    ReverseDcfAnalysis,
    GuidanceClaim,
    GuidanceMetric,
    GuidanceScorecard,
    GuidanceVerdict
} from '../models/analysis';

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

const INSIGHT_SECTIONS: { key: InsightListKey; label: string; icon: string; tone: Tone }[] = [
    { key: 'keyPoints', label: 'Key points', icon: 'summarize', tone: 'neutral' },
    { key: 'growthStrategy', label: 'Revenue growth strategy', icon: 'rocket_launch', tone: 'good' },
    { key: 'tailwinds', label: 'Tailwinds', icon: 'trending_up', tone: 'good' },
    { key: 'headwinds', label: 'Headwinds', icon: 'trending_down', tone: 'warn' },
    { key: 'risks', label: 'Investment risks', icon: 'warning_amber', tone: 'bad' }
];

const RED_FLAG_NAMES: Record<RedFlagId, string> = {
    'profit-not-backed-by-cash': 'Profit not backed by cash',
    'cash-conversion-drop': 'Cash conversion drop',
    'receivables-outpacing-sales': 'Receivables outpacing sales',
    'debt-outpacing-revenue': 'Debt outpacing revenue',
    'high-leverage': 'High leverage',
    'shrinking-margins': 'Shrinking margins, 3 years',
    'promoter-stake-falling': 'Promoter stake falling',
    'promoter-pledging': 'Promoter pledging',
    'negative-free-cash-flow': 'Negative free cash flow, 3 years'
};

type BlockId = 'overview' | 'financials' | 'management' | 'valuation' | 'decision';

/**
 * The Analysis reading order: facts before judgement (docs/adr/0001-evidence-without-verdict.md).
 * `explain` is the block's plain-language note, shown in Explain mode only.
 */
const BLOCKS: { id: BlockId; title: string; explain: string }[] = [
    {
        id: 'overview',
        title: 'Business overview',
        explain: 'What the company does and the headline numbers the market uses to size it up.'
    },
    {
        id: 'financials',
        title: 'Financials',
        explain: 'What the reported numbers say: warnings raised by fixed rules, and how the company compares with its nearest peers.'
    },
    {
        id: 'management',
        title: 'Management & annual report',
        explain: 'What management says in its annual report, read by a language model, and whether its past targets came true. Quotes let you check the source.'
    },
    {
        id: 'valuation',
        title: 'Valuation',
        explain: 'Estimates of what the business is worth from the cash it may generate, set against the market price. They rest on assumptions, so read them as a range, not a fact.'
    },
    {
        id: 'decision',
        title: 'Decision summary',
        explain: 'The evidence from the blocks above, gathered in one place so you can weigh it yourself.'
    }
];

const MOAT_TONES: Record<MoatRating, Tone> = { wide: 'good', narrow: 'neutral', none: 'bad' };
const VERDICT_TONES: Record<GuidanceVerdict, Tone> = { met: 'good', near: 'warn', missed: 'bad', pending: 'neutral', unscored: 'neutral' };
const GUIDANCE_METRICS: Record<GuidanceMetric, string> = {
    revenueGrowth: 'Revenue growth',
    netProfitGrowth: 'Net profit growth',
    margin: 'Net margin',
    capex: 'Capex / revenue',
    debt: 'Debt / equity',
    other: 'Other'
};

@Component({
    selector: 'app-stock-dashboard',
    templateUrl: './stock-dashboard.component.html',
    styleUrls: ['./stock-dashboard.component.css'],
    imports: [CommonModule, FormsModule, ScoreRingComponent, PeerComparisonComponent, ScenarioRangeComponent, ReverseDcfComponent, FinancialStatementsComponent],
    standalone: true
})
export class StockDashboardComponent implements OnInit, OnDestroy {
    private readonly stockService = inject(StockService);
    private readonly analysis = inject(AnalysisService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    readonly readingMode = inject(ReadingModeService);

    readonly suggestions = ['TCS', 'RELIANCE', 'INFY', 'ITC', 'HDFCBANK'];

    query = '';
    ticker = '';

    readonly blocks = BLOCKS;
    private readonly collapsedBlocks = new Set<BlockId>();

    stockState: LoadState = 'idle';
    stockError = '';
    metrics: StockMetrics | null = null;
    showFullDescription = false;

    quant: QuantitativeAnalysis | null = null;
    quantLoading = false;
    quantError = '';
    assumptions: DcfAssumptions | null = null;
    showAssumptions = true;

    reverseDcf: ReverseDcfAnalysis | null = null;
    reverseDcfLoading = false;
    reverseDcfError = '';

    statements: FinancialStatements | null = null;
    statementsLoading = false;
    statementsError = '';

    redFlags: RedFlagScan | null = null;
    redFlagsLoading = false;
    redFlagsError = '';
    readonly redFlagNames = RED_FLAG_NAMES;

    insights: MdnaInsights | null = null;
    insightsLoading = false;
    insightsError = '';
    insightsNeedsUpload = false;
    /** Wall-clock time of the last insights request as seen by the browser, including network and cache lookups. */
    insightsElapsedMs: number | null = null;
    readonly insightSections = INSIGHT_SECTIONS;

    uploadYear = new Date().getFullYear() - 1;
    uploadMessage = '';

    guidance: GuidanceScorecard | null = null;
    guidanceLoading = false;
    guidanceError = '';

    private stockSub?: Subscription;
    private quantSub?: Subscription;
    private reverseDcfSub?: Subscription;
    private statementsSub?: Subscription;
    private redFlagsSub?: Subscription;
    private insightsSub?: Subscription;
    private guidanceSub?: Subscription;

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
        this.reverseDcfSub?.unsubscribe();
        this.statementsSub?.unsubscribe();
        this.redFlagsSub?.unsubscribe();
        this.insightsSub?.unsubscribe();
        this.guidanceSub?.unsubscribe();
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
        this.collapsedBlocks.clear();
        this.uploadMessage = '';
        this.resetGuidance();
        this.loadStock();
        this.quant = null;
        this.reverseDcf = null;
        this.assumptions = null;
        this.loadQuant();
        this.loadStatements();
        this.loadRedFlags();
        this.loadInsights();
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

    // ---- Blocks -----------------------------------------------------------------

    isCollapsed(id: BlockId): boolean {
        return this.collapsedBlocks.has(id);
    }

    toggleBlock(id: BlockId): void {
        if (!this.collapsedBlocks.delete(id)) {
            this.collapsedBlocks.add(id);
        }
    }

    /** True in Explain mode: plain-language notes are shown next to the numbers. */
    get explain(): boolean {
        return this.readingMode.mode() === 'explain';
    }

    scrollToBlock(id: BlockId): void {
        this.host.nativeElement.querySelector(`[data-block="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        this.loadReverseDcf({ discount: overrides.discount, terminal: overrides.terminal });
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

    /** Uses the same discount and terminal growth as the Fair value so both tiles agree. */
    private loadReverseDcf(overrides: { discount?: number | null; terminal?: number | null }): void {
        this.reverseDcfSub?.unsubscribe();
        this.reverseDcfLoading = true;
        this.reverseDcfError = '';
        this.reverseDcfSub = this.analysis.getReverseDcf(this.ticker, overrides).subscribe({
            next: (r) => {
                this.reverseDcf = r;
                this.reverseDcfLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.reverseDcfLoading = false;
                this.reverseDcfError = err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    // ---- Financial statements -------------------------------------------------

    loadStatements(): void {
        this.statementsSub?.unsubscribe();
        this.statements = null;
        this.statementsLoading = true;
        this.statementsError = '';
        this.statementsSub = this.analysis.getStatements(this.ticker).subscribe({
            next: (s) => {
                this.statements = s;
                this.statementsLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.statementsLoading = false;
                this.statementsError = err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    // ---- Red-flag scan --------------------------------------------------------

    loadRedFlags(): void {
        this.redFlagsSub?.unsubscribe();
        this.redFlags = null;
        this.redFlagsLoading = true;
        this.redFlagsError = '';
        this.redFlagsSub = this.analysis.getRedFlags(this.ticker).subscribe({
            next: (r) => {
                this.redFlags = r;
                this.redFlagsLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.redFlagsLoading = false;
                this.redFlagsError = err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
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

    // ---- MD&A insights (Latest annual report) -------------------------------

    loadInsights(): void {
        this.insightsSub?.unsubscribe();
        this.insights = null;
        this.insightsLoading = true;
        this.insightsError = '';
        this.insightsNeedsUpload = false;
        this.insightsElapsedMs = null;
        const started = this.now();
        this.insightsSub = this.analysis.getInsights(this.ticker).subscribe({
            next: (i) => {
                this.insights = i;
                this.insightsLoading = false;
                this.insightsElapsedMs = this.now() - started;
            },
            error: (err: HttpErrorResponse) => {
                this.insightsLoading = false;
                this.insightsElapsedMs = this.now() - started;
                this.insightsNeedsUpload = err.error?.error === 'no-reports';
                this.insightsError = err.error?.message ?? err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    get insightsTimeLabel(): string | null {
        const ms = this.insightsElapsedMs;
        if (ms == null) {
            return null;
        }
        return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
    }

    protected now(): number {
        return performance.now();
    }

    get insightsReportLabel(): string | null {
        const i = this.insights;
        return i ? `FY${i.year} · ${i.source === 'upload' ? 'uploaded' : 'fetched'}` : null;
    }

    onFileSelected(event: Event): void {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) {
            return;
        }
        this.analysis.uploadReport(this.ticker, this.uploadYear, file).subscribe({
            next: (r) => {
                this.uploadMessage = `Uploaded the FY${r.year} annual report`;
                this.loadInsights();
            },
            error: (err: HttpErrorResponse) => (this.uploadMessage = err.error?.error ?? 'Upload failed')
        });
    }

    moatTone(rating: MoatRating): Tone {
        return MOAT_TONES[rating] ?? 'neutral';
    }

    // ---- Guidance scorecard --------------------------------------------------

    runGuidance(): void {
        this.guidanceSub?.unsubscribe();
        this.guidanceLoading = true;
        this.guidanceError = '';
        this.guidanceSub = this.analysis.getGuidance(this.ticker).subscribe({
            next: (g) => {
                this.guidance = g;
                this.guidanceLoading = false;
            },
            error: (err: HttpErrorResponse) => {
                this.guidance = null;
                this.guidanceLoading = false;
                this.guidanceError = err.status === 404
                    ? 'Ticker not found'
                    : err.error?.message ?? err.error?.error ?? (err.status === 0 ? 'Network error, please retry' : 'Request failed');
            }
        });
    }

    /** How many claims were met, near, missed or are still pending; unscored claims are not counted. */
    get guidanceCounts(): Record<Exclude<GuidanceVerdict, 'unscored'>, number> {
        const counts = { met: 0, near: 0, missed: 0, pending: 0 };
        for (const claim of this.guidance?.years.flatMap((y) => y.claims) ?? []) {
            if (claim.verdict !== 'unscored') {
                counts[claim.verdict]++;
            }
        }
        return counts;
    }

    verdictTone(verdict: GuidanceVerdict): Tone {
        return VERDICT_TONES[verdict];
    }

    guidanceMetricLabel(metric: GuidanceMetric): string {
        return GUIDANCE_METRICS[metric];
    }

    /** "15%" or "12–15%" for ratio metrics; "0.5×" for debt-to-equity. */
    guidanceValue(metric: GuidanceMetric, value: number | null | undefined): string {
        if (value == null) {
            return '—';
        }
        return metric === 'debt' ? `${+value.toFixed(2)}×` : `${+(value * 100).toFixed(1)}%`;
    }

    guidanceTarget(claim: GuidanceClaim): string {
        if (!claim.target) {
            return '—';
        }
        const { min, max } = claim.target;
        return min === max
            ? this.guidanceValue(claim.metric, min)
            : `${this.guidanceValue(claim.metric, min)} – ${this.guidanceValue(claim.metric, max)}`;
    }

    private resetGuidance(): void {
        this.guidanceSub?.unsubscribe();
        this.guidance = null;
        this.guidanceLoading = false;
        this.guidanceError = '';
    }

    private normalise(value: string): string {
        return value.trim().toUpperCase();
    }
}
