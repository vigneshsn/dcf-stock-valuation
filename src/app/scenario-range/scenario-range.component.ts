import { Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Scenario, Scenarios } from '../models/analysis';

type CellTone = 'good' | 'neutral' | 'bad' | 'none';

/** Bear / base / bull Fair values, Implied growth and the growth × discount sensitivity grid. */
@Component({
    selector: 'app-scenario-range',
    standalone: true,
    imports: [DecimalPipe],
    templateUrl: './scenario-range.component.html',
    styleUrls: ['./scenario-range.component.css']
})
export class ScenarioRangeComponent {
    @Input({ required: true }) scenarios!: Scenarios;
    @Input({ required: true }) price = 0;

    showSensitivity = false;

    get scenarioList(): { name: string; scenario: Scenario }[] {
        return [
            { name: 'Bear', scenario: this.scenarios.bear },
            { name: 'Base', scenario: this.scenarios.base },
            { name: 'Bull', scenario: this.scenarios.bull }
        ];
    }

    /** Price marker position (0-100%) on a bar spanning the bear and bull values and the price. */
    get marker(): number | null {
        const values = [this.scenarios.bear.fairValuePerShare, this.scenarios.bull.fairValuePerShare, this.price]
            .filter((v): v is number => v != null);
        const min = Math.min(...values);
        const max = Math.max(...values);
        return max > min ? ((this.price - min) / (max - min)) * 100 : null;
    }

    /** Same ±10% band as the Quantitative score: good = cheap, bad = expensive. */
    tone(value: number | null): CellTone {
        if (value == null) {
            return 'none';
        }
        if (value <= 0) {
            return 'bad';
        }
        const gap = (this.price - value) / value;
        return gap < -0.1 ? 'good' : gap > 0.1 ? 'bad' : 'neutral';
    }
}
