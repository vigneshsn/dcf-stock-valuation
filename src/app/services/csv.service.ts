import { Injectable } from '@angular/core';


@Injectable()
export class CsvService {
    downloadCsv(filename: string, rows: any[]) {
        // if(!rows || !rows.length) return;
        // const keys = Object.keys(rows[0]);
        // const csv = [keys.join(',')].concat(rows.map(r => keys.map(k => this.stringify(r[k])).join(','))).join(''));
        // const blob = new Blob([csv], { type: 'text/csv' });
        // const url = window.URL.createObjectURL(blob);
        // const a = document.createElement('a');
        // a.href = url; a.download = filename; a.click();
        // window.URL.revokeObjectURL(url);
    }
    private stringify(val: any){
        // if(val === null || val === undefined) return '';
        // const s = String(val);
        // if(s.includes(',') || s.includes('
        //     ')|| s.includes('"')) return '"'+s.replace(/"/g,'""')+'"';
        // return s;
        return "";
    }
}