import { Component, computed, input, linkedSignal } from '@angular/core';
import { EvidenceSources, decisionEvidence } from './decision-evidence';

const SELF_CHECK = [
    'I can explain how this company makes money',
    'I have read the three financial statements',
    'I know which weaknesses would change my view',
    'I am comfortable with the price against the Scenario range'
];

/**
 * The closing view of an Analysis: the evidence side by side, uncoloured and without a verdict, and the user's
 * own Self-check (docs/adr/0001-evidence-without-verdict.md). Ticks are not saved and reset on reload.
 */
@Component({
    selector: 'app-decision-summary',
    standalone: true,
    styleUrls: ['./decision-summary.component.css'],
    template: `
        <p class="lead">The evidence, side by side. There is no verdict: the decision is yours.</p>
        <table class="evidence" data-testid="evidence">
            <tbody>
                @for (row of rows(); track row.label) {
                    <tr>
                        <th scope="row">{{ row.label }}</th>
                        <td [class.missing]="!row.text">{{ row.text ?? (loading() ? 'Loading…' : 'Not available') }}</td>
                    </tr>
                }
            </tbody>
        </table>

        <fieldset class="self-check" data-testid="self-check">
            <legend>Self-check</legend>
            @if (!dense()) {
                <p class="hint" data-explain>Questions to answer for yourself before you decide. Only you tick them; the app never does.</p>
            }
            @for (item of items; track item; let i = $index) {
                <label>
                    <input type="checkbox" [checked]="ticked().has(i)" (change)="toggle(i)"/>
                    {{ item }}
                </label>
            }
            <p class="note">Not saved: ticks clear when you reload or open another stock.</p>
        </fieldset>
    `
})
export class DecisionSummaryComponent {
    readonly ticker = input.required<string>();
    readonly sources = input.required<EvidenceSources>();
    /** True while any source is still loading. */
    readonly loading = input(false);
    /** Dense mode: no explanations. */
    readonly dense = input(false);

    readonly items = SELF_CHECK;
    readonly rows = computed(() => decisionEvidence(this.sources()));

    /** Indexes of ticked items; starts empty for each stock. */
    readonly ticked = linkedSignal<string, ReadonlySet<number>>({ source: this.ticker, computation: () => new Set() });

    toggle(index: number): void {
        const next = new Set(this.ticked());
        if (!next.delete(index)) {
            next.add(index);
        }
        this.ticked.set(next);
    }
}
