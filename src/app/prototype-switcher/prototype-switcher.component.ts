// PROTOTYPE: throwaway variant switcher. Do not ship.
import {Component, HostListener, Input, inject, isDevMode} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';

@Component({
    selector: 'app-prototype-switcher',
    standalone: true,
    template: `
        @if (enabled) {
            <div class="bar">
                <button (click)="step(-1)" aria-label="Previous variant">←</button>
                <span>{{ current }} ({{ names[current] }})</span>
                <button (click)="step(1)" aria-label="Next variant">→</button>
            </div>
        }
    `,
    styles: [`
        .bar { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 9999;
            display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 999px;
            background: #fff; color: #111; font: 600 13px system-ui; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
        button { border: 0; background: #111; color: #fff; border-radius: 999px; width: 28px; height: 28px; cursor: pointer; }
    `]
})
export class PrototypeSwitcherComponent {
    @Input({required: true}) variants: string[] = [];
    @Input({required: true}) current = '';
    @Input() names: Record<string, string> = {};

    readonly enabled = isDevMode();
    private router = inject(Router);
    private route = inject(ActivatedRoute);

    step(delta: number): void {
        const i = this.variants.indexOf(this.current);
        const next = this.variants[(i + delta + this.variants.length) % this.variants.length];
        this.router.navigate([], {relativeTo: this.route, queryParams: {variant: next}, queryParamsHandling: 'merge', replaceUrl: true});
    }

    @HostListener('window:keydown', ['$event'])
    onKey(e: KeyboardEvent): void {
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, [contenteditable]')) return;
        if (e.key === 'ArrowLeft') this.step(-1);
        if (e.key === 'ArrowRight') this.step(1);
    }
}
