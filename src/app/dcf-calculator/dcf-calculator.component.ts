import { Component, OnInit } from '@angular/core';
import { CsvService } from '../services/csv.service';
import { FormsModule } from '@angular/forms';
import { XlsxService } from '../services/xlsx.service';
import {MatCard} from "@angular/material/card";
import {MatFormField, MatLabel} from "@angular/material/form-field";


@Component({
    selector: 'app-dcf-calculator',
    templateUrl: './dcf-calculator.component.html',
    imports: [
        MatCard,
        MatFormField,
        MatLabel,
        FormsModule
    ],
    styleUrls: ['./dcf-calculator.component.css']
})
export class DcfCalculatorComponent implements OnInit {
// (properties & methods same as earlier component)


    constructor(private csv: CsvService, private xlsx: XlsxService) {}

    ngOnInit(): void {
        throw new Error("Method not implemented.");
    }


// ... calculate, onCellEdit, round, exportCsv, printReport identical to earlier

    baseRevenue: number = 100;
    exportXlsx(){
        // const rows = this.table.map(r => ({
        //     Year: r.yearLabel,
        //     Revenue: r.revenue,
        //     RevenueGrowthPct: r.revenueGrowthPct,
        //     ProfitMarginPct: r.profitMarginPct,
        //     FCFpct: r.fcfPct,
        //     FCF: r.fcf,
        //     Discounted: r.discounted
        // }));
        // rows.push({Year: 'Terminal (discounted)', Discounted: this.discountedTerminal});
        // rows.push({Year: 'Total discounted value', Discounted: this.totalValue});
        // rows.push({Year: 'Equity value (after cash & debt)', Discounted: this.equityValue});
        // rows.push({Year: 'Value per share', Discounted: this.valuePerShare});
        //
        //
        // this.xlsx.exportToXlsx('dcf_projection.xlsx', 'Projections', rows);
    }


    printReport(): void{
        //todo: implement
    }

    exportCsv(): void{

    }

    calculate(): void{

    }
}