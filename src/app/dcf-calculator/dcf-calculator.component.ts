import { Component, OnInit } from '@angular/core';
import { CsvService } from '../services/csv.service';
import { XlsxService } from '../services/xlsx.service';


// (ProjectionRow interface same as before)


@Component({
    selector: 'app-dcf-calculator',
    templateUrl: './dcf-calculator.component.html',
    styleUrls: ['./dcf-calculator.component.css']
})
export class DcfCalculatorComponent implements OnInit {
// (properties & methods same as earlier component)


    constructor(private csv: CsvService, private xlsx: XlsxService) {}


// ... calculate, onCellEdit, round, exportCsv, printReport identical to earlier


    exportXlsx(){
        const rows = this.table.map(r => ({
            Year: r.yearLabel,
            Revenue: r.revenue,
            RevenueGrowthPct: r.revenueGrowthPct,
            ProfitMarginPct: r.profitMarginPct,
            FCFpct: r.fcfPct,
            FCF: r.fcf,
            Discounted: r.discounted
        }));
        rows.push({Year: 'Terminal (discounted)', Discounted: this.discountedTerminal});
        rows.push({Year: 'Total discounted value', Discounted: this.totalValue});
        rows.push({Year: 'Equity value (after cash & debt)', Discounted: this.equityValue});
        rows.push({Year: 'Value per share', Discounted: this.valuePerShare});


        this.xlsx.exportToXlsx('dcf_projection.xlsx', 'Projections', rows);
    }
}