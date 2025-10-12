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


    revenueBeforeXYears = 1000; // millions

    revenueCurrentYear = 10000; // millions
    revenuePreviousYear = 9000; // millions
    revenueBeforeTwoYears = 8000; // millions
    revenueAverage = 0; // millions

    netProfitCurrentYear = 1500; // millions
    netProfitPreviousYear = 1200; // millions
    netProfitBeforeTwoYears = 1100; // millions
    netProfitAverage = 0; // millions

    capExCurrentYear = 150; // millions
    capExPreviousYear = 120; // millions
    capExPreviousBeforeTwoYears = 110; // millions

    nonCashExCurrentYear: number = 50; // millions
    nonCashExPreviousYear: number = 40
    nonCashExBeforeTwoYears: number = 30
    nonCashExAverage: number = 0; // millions

    capExAverage = 0; // millions

    revenueYears = 5; // years
    growthRate = 0; // %
    profitMargin = 0; // %

    freeCashFlowBaseYear = 0; // millions
    freeCashFlowAverage = 0; // millions
    freeCashFlowRate = 0; // %
    projectionsYears = 5; // years
    projections: any[] = [];

    discountRate = 10; // %
    terminalGrowthRate = 3; // %
    totalNoOfShares = 100; // millions
    intrinsicValuePerShare = 0; // $

    constructor(private csv: CsvService, private xlsx: XlsxService) {
    }

    toDec(x: number) {
        return Number(x) / 100
    }

    toFixed(x: number) {
        return Number(x.toFixed(2))
    }

    calculateGrowthRate(): void {
        // CAGR formula: (Ending Value / Beginning Value)^(1/years) - 1
        const cagr = Math.pow(this.revenueCurrentYear / this.revenueBeforeXYears, 1 / this.revenueYears) - 1;
        this.growthRate = Number((cagr * 100).toFixed(2)); // Convert to percentage and round to 2 decimal places
        this.revenueAverage = (this.revenueCurrentYear + this.revenuePreviousYear + this.revenueBeforeTwoYears) / 3;

    }

    calculateProfitMargin(): void {
        // Calculate profit margin for current year: (Net Profit / Revenue) * 100
        const currentYearMargin = (this.netProfitCurrentYear / this.revenueCurrentYear) * 100;
        const previousYearMargin = (this.netProfitPreviousYear / this.revenuePreviousYear) * 100;
        const twoYearsAgoMargin = (this.netProfitBeforeTwoYears / this.revenueBeforeTwoYears) * 100;

        // Calculate average profit margin over 3 years
        const averageMargin = (currentYearMargin + previousYearMargin + twoYearsAgoMargin) / 3;

        this.profitMargin = this.toFixed(averageMargin); // Round to 2 decimal places
        this.netProfitAverage = (this.netProfitCurrentYear + this.netProfitPreviousYear + this.netProfitBeforeTwoYears) / 3;

    }

    calculateAverageCapEx(): void {
        const averageCapEx = (this.capExCurrentYear + this.capExPreviousYear + this.capExPreviousBeforeTwoYears) / 3;
        this.capExAverage = this.toFixed(averageCapEx); // Round to 2 decimal places
    }

    calculateAverageNonCashEx(): void {
        this.nonCashExAverage = (this.nonCashExCurrentYear + this.nonCashExPreviousYear + this.nonCashExBeforeTwoYears) / 3;
    }

    calculateFreeCashFlow(): void {
        this.freeCashFlowAverage = this.netProfitAverage - this.capExAverage + this.nonCashExAverage;
        this.freeCashFlowRate = this.toFixed((this.freeCashFlowAverage/this.netProfitAverage) * 100);
        this.calculateProjections();
    }

    calculateProjections(): void {
        this.projections = [];
        let year: number;
        for (year = 1; year <= this.projectionsYears; year++) {
            const projectedRevenue = this.revenueAverage * Math.pow((1 + this.toDec(this.growthRate)), year);
            const projectedNetProfit = projectedRevenue * this.toDec(this.profitMargin);
            const projectedCapEx = this.capExAverage; // Assuming CapEx remains constant
            const projectedNonCashEx = this.nonCashExAverage; // Assuming Non-Cash Expenses remain constant
            const projectedFreeCashFlow = projectedNetProfit - projectedCapEx + projectedNonCashEx;

            this.projections.push({
                year: year,
                revenue: Number(projectedRevenue.toFixed(2)),
                netProfit: Number(projectedNetProfit.toFixed(2)),
                capEx: Number(projectedCapEx.toFixed(2)),
                nonCashEx: Number(projectedNonCashEx.toFixed(2)),
                freeCashFlow: Number(projectedFreeCashFlow.toFixed(2))
            });
        }
    }

    calculateIntrinsicValue(): void {
        let dcf = 0;
        for (const element of this.projections) {
            const year = element.year;
            const freeCashFlow = element.freeCashFlow;
            dcf += freeCashFlow / Math.pow((1 + this.toDec(this.discountRate)), year);
        }

        // Terminal Value using Gordon Growth Model
        const lastYearFCF = this.projections.at(this.projections.length - 1).freeCashFlow;
        const terminalValue = (lastYearFCF * (1 + this.toDec(this.terminalGrowthRate))) /
            (this.toDec(this.discountRate) - this.toDec(this.terminalGrowthRate));

        // Discount Terminal Value to Present Value
        const discountedTerminalValue = terminalValue / Math.pow((1 + this.toDec(this.discountRate)), this.projections.length);
        const totalValue = dcf + discountedTerminalValue;
        this.intrinsicValuePerShare = Number((totalValue / this.totalNoOfShares).toFixed(2));
    }
}