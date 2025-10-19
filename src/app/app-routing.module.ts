import {FeedbackComponent} from './feedback/feedback.component';
import {DcfCalculatorComponent} from "./dcf-calculator/dcf-calculator.component";
import {Routes, RouterModule} from "@angular/router";
import {NgModule} from '@angular/core';
import {PageNotFound} from "./page-not-found/page-not-found";

const routes: Routes = [
    {path: '', component: DcfCalculatorComponent},
    {path: 'feedback', component: FeedbackComponent},
    {path: '**', component: PageNotFound}
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule {
}