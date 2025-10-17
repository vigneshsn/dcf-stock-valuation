// src/app/dcf-calculator/dcf-calculator.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { DcfCalculatorComponent } from './dcf-calculator.component';
import { CsvService } from '../services/csv.service';
import { XlsxService } from '../services/xlsx.service';

describe('DcfCalculatorComponent', () => {
    let component: DcfCalculatorComponent;
    let fixture: ComponentFixture<DcfCalculatorComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            declarations: [DcfCalculatorComponent],
            imports: [FormsModule],
            providers: [CsvService, XlsxService]
        }).compileComponents();

        fixture = TestBed.createComponent(DcfCalculatorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should calculate growth rate correctly', () => {
        component.revenueMostRecentAvg = 12000;
        component.revenueLeastRecentAvg = 8000;
        component.revenueYears = 4;
        component.calculateGrowthRate();
        expect(component.growthRate).toBeCloseTo(10.67, 1);
    });

    it('should calculate intrinsic value and set calculationResults to true', () => {
        component.marketValue = 10000;
        component.currentPrice = 100;
        component.calculateIntrinsicValue();
        expect(component.calculationResults).toBeTrue();
        expect(component.intrinsicValuePerShare).toBeGreaterThan(0);
    });
});