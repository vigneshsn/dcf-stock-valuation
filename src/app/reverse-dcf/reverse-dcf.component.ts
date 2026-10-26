import { Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ReverseDcfAnalysis, ReverseDcfVerdict } from '../models/analysis';

const VERDICT_LABELS: Record<ReverseDcfVerdict, string> = {
    'expects-acceleration': 'Market expects acceleration',
    'in-line': 'Market expects growth in line with history',
    'expects-slowdown': 'Market expects slowdown'
};

/** Reverse DCF: the growth the market price implies, beside what the company delivered and guided to. */
@Component({
    selector: 'app-reverse-dcf',
    standalone: true,
    imports: [DecimalPipe],
    styleUrls: ['./reverse-dcf.component.css'],
    template: `
        <p class="headline" data-testid="reverse-dcf-headline">{{ headline }}</p>
        @if (analysis.verdict) {
            <span class="verdict" [attr.data-verdict]="analysis.verdict">{{ verdictLabel }}</span>
        }
        @if (analysis.guidedGrowth != null) {
            <p class="detail">Management guided {{ analysis.guidedGrowth | number:'1.0-2' }}% growth.</p>
        }
        @if (analysis.assumptions; as a) {
            <p class="detail">
                Holding discount at {{ a.discountRate | number:'1.0-2' }}% and terminal growth at
                {{ a.terminalGrowthRate | number:'1.0-2' }}%, the same as the Fair value.
            </p>
        }
    `
})
export class ReverseDcfComponent {
    @Input({ required: true }) analysis!: ReverseDcfAnalysis;

    get headline(): string {
        const a = this.analysis;
        const implied = a.status === 'ok' && a.impliedGrowth != null
            ? `Price implies ${formatPct(a.impliedGrowth)} growth for 5 years`
            : a.message ?? 'Implied growth unavailable';
        const delivered = a.historicalCagr != null && (a.status === 'ok' || a.status === 'no-solution')
            ? `; company delivered ${formatPct(a.historicalCagr)}`
            : '';
        return implied + delivered;
    }

    get verdictLabel(): string {
        return this.analysis.verdict ? VERDICT_LABELS[this.analysis.verdict] : '';
    }
}

const formatPct = (v: number) => `${Number(v.toFixed(2))}%`;
