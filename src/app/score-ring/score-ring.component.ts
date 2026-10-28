import { Component, Input } from '@angular/core';

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Circular 0-5 gauge used for the Quantitative score. */
@Component({
    selector: 'app-score-ring',
    standalone: true,
    styleUrls: ['./score-ring.component.css'],
    template: `
        <div class="ring" [attr.data-tone]="tone">
            <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle class="ring-bg" cx="60" cy="60" [attr.r]="radius"></circle>
                <circle class="ring-fg" cx="60" cy="60" [attr.r]="radius"
                        [attr.stroke-dasharray]="circumference" [attr.stroke-dashoffset]="offset"></circle>
            </svg>
            <div class="ring-label" [attr.aria-label]="'Score ' + score + ' out of 5'">
                <span class="ring-score" [attr.data-testid]="testId">{{ score }}</span><span class="ring-max">/5</span>
            </div>
        </div>
    `
})
export class ScoreRingComponent {
    @Input({ required: true }) score = 0;
    @Input() tone: 'good' | 'neutral' | 'warn' | 'bad' = 'neutral';
    @Input() testId: string | null = null;

    readonly radius = RADIUS;
    readonly circumference = CIRCUMFERENCE;

    get offset(): number {
        const clamped = Math.min(5, Math.max(0, this.score));
        return CIRCUMFERENCE * (1 - clamped / 5);
    }
}
