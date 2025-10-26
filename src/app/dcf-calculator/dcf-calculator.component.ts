import {Component, OnInit} from '@angular/core';
import {CsvService} from '../services/csv.service';
import {FormsModule} from '@angular/forms';
import {XlsxService} from '../services/xlsx.service';
import {DcfHelperService} from '../services/dcf-helper.service';
import {Tooltip} from "../tooltip/tooltip";
import {Projections} from "../models/projections";

@Component({
    selector: 'app-dcf-calculator',
    templateUrl: './dcf-calculator.component.html',
    imports: [
        FormsModule,
        Tooltip
    ],
    standalone: true,
    styleUrls: ['./dcf-calculator.component.css']
})
export class DcfCalculatorComponent implements OnInit {

    revenueMostRecentAvg = 240558;
    revenueLeastRecentAvg = 95034;
    revenueYears = 10; // years

    netProfitAverage = 45733; // millions
    nonCashExAverage: number = 5083; // millions
    capExAverage = 2923; // millions

    growthRate = 0; // %
    profitMargin = 0; // %

    ownerEarningAverage = 0; // millions
    ownerEarningRate = 0; // %
    projectionsYears = 5; // years
    projections: Projections[] = [];

    discountRate = 12; // %
    terminalGrowthRate = 5; // %
    totalNoOfShares = 0; // millions
    intrinsicValuePerShare = 0; // $
    marketValue: number = 1071080;
    currentPrice: number = 2960;
    calculationResults = false;
    marginOfSafety = 0; // %

    showGuides = true;
    discountedTerminalValue = 0;
    dcfValue = 0;

    constructor(
        private csv: CsvService,
        private xlsx: XlsxService,
        private helper: DcfHelperService
    ) {}

    ngOnInit(): void {
        this.calculateGrowthRate();
    }

    calculateGrowthRate(): void {
        this.growthRate =  this.helper.cagr(this.revenueLeastRecentAvg, this.revenueMostRecentAvg, this.revenueYears)
    }

    calculateProfitMargin(): void {
        this.profitMargin = this.helper.percentage(this.netProfitAverage, this.revenueMostRecentAvg)
    }

    calculateTotalNoOfShares(): void {
        this.totalNoOfShares = (this.marketValue / this.currentPrice);
    }

    calculateOwnerEarnings(): void {
        this.calculateProfitMargin();
        this.ownerEarningAverage = this.netProfitAverage - this.capExAverage + this.nonCashExAverage;
        this.ownerEarningRate = this.helper.percentage(this.ownerEarningAverage, this.netProfitAverage)
    }

    generateProjections(): void {
        this.projections = [];
        let year: number;
        for (year = 1; year <= this.projectionsYears; year++) {
            const projectedRevenue = this.helper.futureValue(this.revenueMostRecentAvg, this.growthRate, year);
            const projectedNetProfit = projectedRevenue * this.helper.toDec(this.profitMargin);
            const projectedCapEx = this.capExAverage;
            const projectedNonCashEx = this.nonCashExAverage;
            const projectedFreeCashFlow = projectedNetProfit - projectedCapEx + projectedNonCashEx;
            const discountedOwnerEarning = this.helper.discountedValue(projectedFreeCashFlow, this.discountRate, year);

            this.projections.push({
                year: year,
                revenue: this.helper.toFixed(projectedRevenue),
                netProfit: this.helper.toFixed(projectedNetProfit),
                capEx: this.helper.toFixed(projectedCapEx),
                nonCashEx: this.helper.toFixed(projectedNonCashEx),
                ownerEarning: this.helper.toFixed(projectedFreeCashFlow),
                discountedOwnerEarning: discountedOwnerEarning
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
    const lastYearFCF = this.projections.at(- 1)?.ownerEarning ?? 0;
    const terminalValue = this.helper.terminalValue(lastYearFCF, this.terminalGrowthRate, this.discountRate, this.terminalGrowthRate);
    this.discountedTerminalValue = this.helper.discountedValue(terminalValue, this.discountRate, this.projections.length);
    this.dcfValue = this.helper.toFixed(dcf + this.discountedTerminalValue);
    this.intrinsicValuePerShare = this.helper.toFixed((this.dcfValue / this.totalNoOfShares));
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

    resetForm(): void {
        this.revenueMostRecentAvg = 240558;
        this.revenueLeastRecentAvg = 95034;
        this.revenueYears = 10; // years

        this.netProfitAverage = 45733; // millions
        this.nonCashExAverage = 5083; // millions
        this.capExAverage = 2923; // millions

        this.profitMargin = 0;
        this.ownerEarningAverage = 0;
        this.ownerEarningRate = 0;
        this.projectionsYears = 5;
        this.projections = [];
        this.discountRate = 12;
        this.terminalGrowthRate = 5;
        this.totalNoOfShares = 0;
        this.intrinsicValuePerShare = 0;
        this.marketValue = 1071080;
        this.currentPrice = 2960;
        this.calculationResults = false;
        this.marginOfSafety = 0;
        this.discountedTerminalValue = 0;
        this.dcfValue = 0;

        this.calculateGrowthRate();
    }

}
