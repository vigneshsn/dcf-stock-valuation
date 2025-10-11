import { Component } from '@angular/core';


@Component({
    selector: 'app-root',
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