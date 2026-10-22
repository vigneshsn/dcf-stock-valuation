import {NgModule} from '@angular/core';
import {BrowserModule} from '@angular/platform-browser';
import {HttpClientModule} from '@angular/common/http';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {FormsModule} from '@angular/forms';


import {MatButtonModule} from '@angular/material/button';
import {MatInputModule} from '@angular/material/input';
import {MatCardModule} from '@angular/material/card';
import {MatTableModule} from '@angular/material/table';
import {MatIconModule} from '@angular/material/icon';
import {MatFormFieldModule} from '@angular/material/form-field';
import {AppComponent} from './app.component';
import {DcfCalculatorComponent} from './dcf-calculator/dcf-calculator.component';
import {CsvService} from './services/csv.service';
import {DcfHelperService} from './services/dcf-helper.service';
import {XlsxService} from './services/xlsx.service';
import {AppRoutingModule} from "./app-routing.module";


@NgModule({
    declarations: [
        AppComponent
    ],
    imports: [
        BrowserModule,
        BrowserAnimationsModule,
        FormsModule,
        MatButtonModule,
        MatInputModule,
        MatCardModule,
        MatTableModule,
        MatIconModule,
        MatFormFieldModule,
        DcfCalculatorComponent,
        AppRoutingModule,
        HttpClientModule
    ],
    providers: [CsvService, XlsxService, DcfHelperService],
    bootstrap: [AppComponent]
})
export class AppModule {
}