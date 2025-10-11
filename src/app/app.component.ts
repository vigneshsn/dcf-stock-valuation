import { Component } from '@angular/core';
import {MatToolbar} from "@angular/material/toolbar";
import {DcfCalculatorComponent} from "./dcf-calculator/dcf-calculator.component";


@Component({
    selector: 'app-root',
    imports: [
        MatToolbar,
        DcfCalculatorComponent
    ],
    template: `
        <mat-toolbar color="primary">
            <span>DCF Stock Valuation</span>
        </mat-toolbar>
        <div class="container">
            <app-dcf-calculator></app-dcf-calculator>
        </div>
    `
})
export class AppComponent {}