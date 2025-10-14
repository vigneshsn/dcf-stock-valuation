import {Component} from '@angular/core';
import {CsvService} from '../services/csv.service';
import {FormsModule} from '@angular/forms';
import {XlsxService} from '../services/xlsx.service';
import {NgForOf, NgIf} from "@angular/common";


@Component({
    selector: 'app-dcf-calculator',
    templateUrl: './dcf-calculator.component.html',
    imports: [
        FormsModule,
        NgIf,
        NgForOf
    ],
    styleUrls: ['./dcf-calculator.component.css']
})
export class DcfCalculatorComponent {

    revenueMostRecentAvg = 10000;
    revenueLeastRecentAvg = 8000;
    revenueYears = 5; // years

    netProfitAverage = 1000; // millions
    nonCashExAverage: number = 120; // millions
    capExAverage = 100; // millions


    growthRate = 0; // %
    profitMargin = 0; // %

    ownerEarningAverage = 0; // millions
    ownerEarningRate = 0; // %
    projectionsYears = 5; // years
    projections: any[] = [];

    discountRate = 10; // %
    terminalGrowthRate = 3; // %
    totalNoOfShares = 100; // millions
    intrinsicValuePerShare = 0; // $
    marketValue: number = 0;
    currentPrice: number = 0;
    calculationResults = false;
    marginOfSafety = 0; // %

    showGuides = false;
    discountedTerminalValue = 0;
    dcfValue = 0;

    constructor(private csv: CsvService, private xlsx: XlsxService) {
    }

    toggleGuides() {
        this.showGuides = !this.showGuides;
    }

    toDec(x: number) {
        return Number(x) / 100
    }

    toFixed(x: number) {
        return Number(x.toFixed(2))
    }

    calculateGrowthRate(): void {
        // CAGR formula: (Ending Value / Beginning Value)^(1/years) - 1
        const cagr = Math.pow(this.revenueMostRecentAvg / this.revenueLeastRecentAvg, 1 / this.revenueYears) - 1;
        this.growthRate = Number((cagr * 100).toFixed(2)); // Convert to percentage and round to 2 decimal places
    }

    calculateProfitMargin(): void {
        // Calculate profit margin for current year: (Net Profit / Revenue) * 100
        const avg = (this.netProfitAverage / this.revenueMostRecentAvg) * 100;
        this.profitMargin = this.toFixed(avg); // Round to 2 decimal places
    }

    calculateTotalNoOfShares(): void {
        this.totalNoOfShares = (this.marketValue / this.currentPrice);
    }

    calculateOwnerEarnings(): void {
        this.calculateProfitMargin();
        this.ownerEarningAverage = this.netProfitAverage - this.capExAverage + this.nonCashExAverage;
        this.ownerEarningRate = this.toFixed((this.ownerEarningAverage / this.netProfitAverage) * 100);
    }

    generateProjections(): void {
        this.projections = [];
        let year: number;
        for (year = 1; year <= this.projectionsYears; year++) {
            const projectedRevenue = this.revenueMostRecentAvg * Math.pow((1 + this.toDec(this.growthRate)), year);
            const projectedNetProfit = projectedRevenue * this.toDec(this.profitMargin);
            const projectedCapEx = this.capExAverage; // Assuming CapEx remains constant
            const projectedNonCashEx = this.nonCashExAverage; // Assuming Non-Cash Expenses remain constant
            const projectedFreeCashFlow = projectedNetProfit - projectedCapEx + projectedNonCashEx;

            this.projections.push({
                year: year,
                revenue: this.toFixed(projectedRevenue),
                netProfit: this.toFixed(projectedNetProfit),
                capEx: this.toFixed(projectedCapEx),
                nonCashEx: this.toFixed(projectedNonCashEx),
                ownerEarning: this.toFixed(projectedFreeCashFlow),
                discountedOwnerEarning: this.toFixed(projectedFreeCashFlow / Math.pow((1 + this.toDec(this.discountRate)), year))
            });
        }
    }

    calculateIntrinsicValue(): void {
        this.calculateOwnerEarnings();
        this.generateProjections()
        this.calculateTotalNoOfShares();

        let dcf = 0;
        for (const element of this.projections) {
            dcf += element.discountedOwnerEarning;
        }

        // Terminal Value using Gordon Growth Model
        const lastYearFCF = this.projections.at(this.projections.length - 1).ownerEarning;
        const terminalValue = (lastYearFCF * (1 + this.toDec(this.terminalGrowthRate))) /
            (this.toDec(this.discountRate) - this.toDec(this.terminalGrowthRate));

        // Discount Terminal Value to Present Value
        this.discountedTerminalValue = this.toFixed(terminalValue / Math.pow((1 + this.toDec(this.discountRate)), this.projections.length));
        this.dcfValue = dcf + this.discountedTerminalValue;
        this.intrinsicValuePerShare = this.toFixed((this.dcfValue / this.totalNoOfShares));
        this.marginOfSafety = ((this.intrinsicValuePerShare - this.currentPrice) / this.intrinsicValuePerShare) * 100;
        this.calculationResults = true;
    }

    getValuationClass(): string {
        if (this.marginOfSafety > 20) return 'undervalued';
        if (this.marginOfSafety < -10) return 'overvalued';
        return 'fairly-valued';
    }

    getValuationText(): string {
        if (this.marginOfSafety > 20) return 'Undervalued';
        if (this.marginOfSafety < -10) return 'Overvalued';
        return 'Fairly Valued';
    }
}
