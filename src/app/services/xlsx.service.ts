import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';


@Injectable()
export class XlsxService {
    exportToXlsx(filename: string, worksheetName: string, data: any[]) {
        const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(data);
        const wb: XLSX.WorkBook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, worksheetName || 'Sheet1');
        XLSX.writeFile(wb, filename);
    }
}