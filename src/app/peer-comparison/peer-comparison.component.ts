import { Component, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PeerRow, marketCapCrores } from '../models/stock-metrics';

/** Peer comparison table; the row flagged `current` is the stock being analysed and is highlighted. */
@Component({
    selector: 'app-peer-comparison',
    standalone: true,
    imports: [DecimalPipe],
    templateUrl: './peer-comparison.component.html',
    styleUrls: ['./peer-comparison.component.css']
})
export class PeerComparisonComponent {
    @Input({ required: true }) rows: PeerRow[] = [];

    readonly marketCapCrores = marketCapCrores;
}
