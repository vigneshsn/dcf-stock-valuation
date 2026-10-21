import {FeedbackComponent} from './feedback/feedback.component';
import {DcfCalculatorComponent} from "./dcf-calculator/dcf-calculator.component";
import {Routes, RouterModule} from "@angular/router";
import {NgModule} from '@angular/core';
import {PageNotFound} from "./page-not-found/page-not-found";
import {AnalysisDashboardComponent} from "./analysis/analysis-dashboard.component";
import {FundamentalsComponent} from "./fundamentals/fundamentals.component";

const routes: Routes = [
    {path: '', component: DcfCalculatorComponent},
    {path: 'feedback', component: FeedbackComponent},
    {path: 'fundamentals', component: FundamentalsComponent},
    {path: 'analysis', component: AnalysisDashboardComponent},
    {path: '**', component: PageNotFound}
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule {
}