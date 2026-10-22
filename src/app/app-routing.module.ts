import {FeedbackComponent} from './feedback/feedback.component';
import {DcfCalculatorComponent} from "./dcf-calculator/dcf-calculator.component";
import {Routes, RouterModule} from "@angular/router";
import {NgModule} from '@angular/core';
import {PageNotFound} from "./page-not-found/page-not-found";
import {StockDashboardComponent} from "./stock-dashboard/stock-dashboard.component";

const routes: Routes = [
    {path: '', component: DcfCalculatorComponent},
    {path: 'feedback', component: FeedbackComponent},
    {path: 'stock', component: StockDashboardComponent},
    // Fundamentals and Analysis used to be separate pages; both now live on /stock.
    {path: 'fundamentals', redirectTo: 'stock'},
    {path: 'analysis', redirectTo: 'stock'},
    {path: '**', component: PageNotFound}
];

@NgModule({
    imports: [RouterModule.forRoot(routes, {scrollPositionRestoration: 'enabled'})],
    exports: [RouterModule]
})
export class AppRoutingModule {
}
