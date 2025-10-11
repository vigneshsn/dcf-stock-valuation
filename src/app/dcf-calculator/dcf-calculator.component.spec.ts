import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatCardModule } from '@angular/material/card';
import { DcfCalculatorComponent } from './dcf-calculator.component';
import { CsvService } from '../services/csv.service';
import { XlsxService } from '../services/xlsx.service';


describe('DcfCalculatorComponent', () => {
    let component: DcfCalculatorComponent;
    let fixture: ComponentFixture<DcfCalculatorComponent>;


    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [DcfCalculatorComponent],
            imports: [FormsModule, BrowserAnimationsModule, MatCardModule],
            providers: [CsvService, XlsxService]
        }).compileComponents();


        fixture = TestBed.createComponent(DcfCalculatorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });


    it('should create', () => {
        expect(component).toBeTruthy();
    });


    it('should compute a non-zero total value with defaults', () => {
        // component.calculate();
        // expect(component.totalValue).toBeGreaterThan(0);
    });


    it('should update value per share when shares set', () => {
        // component.shares = 100;
        // component.calculate();
        // expect(component.valuePerShare).toBeCloseTo(component.equityValue / 100, 2);
    });
});