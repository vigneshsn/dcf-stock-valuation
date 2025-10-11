import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { FormsModule } from '@angular/forms';


import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { AppComponent } from './app.component';
import { DcfCalculatorComponent } from './dcf-calculator/dcf-calculator.component';
import { CsvService } from './services/csv.service';
import { XlsxService } from './services/xlsx.service';


@NgModule({
    declarations: [AppComponent, DcfCalculatorComponent],
    imports: [
        BrowserModule,
        BrowserAnimationsModule,
        FormsModule,
        MatToolbarModule,
        MatButtonModule,
        MatInputModule,
        MatCardModule,
        MatTableModule,
        MatIconModule,
        MatFormFieldModule
    ],
    providers: [CsvService, XlsxService],
    bootstrap: [AppComponent]
})
export class AppModule {}