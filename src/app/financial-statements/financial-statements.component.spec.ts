import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FinancialStatementsComponent } from './financial-statements.component';
import { StatementYear } from '../models/analysis';

function year(y: number, v: [number, number, number, number, number, number, number, number]): StatementYear {
    const [revenue, ebitda, netProfit, totalAssets, borrowings, equity, operatingCashFlow, capex] = v;
    return {
        year: y,
        revenue,
        ebitda,
        netProfit,
        netMargin: (netProfit / revenue) * 100,
        totalAssets,
        borrowings,
        equity,
        debtToEquity: borrowings / equity,
        operatingCashFlow,
        capex,
        freeCashFlow: operatingCashFlow - capex,
        cashConversion: (operatingCashFlow / netProfit) * 100
    };
}

const YEARS: StatementYear[] = [
    year(2021, [1000, 200, 100, 2000, 100, 1000, 120, 50]),
    year(2022, [1100, 220, 110, 2100, 150, 1050, 100, 60]),
    year(2023, [1210, 240, 130, 2200, 200, 1100, 150, 200]),
    year(2024, [1331, 260, 140, 2300, 250, 1200, 160, 220]),
    year(2025, [1278, 230, 115, 2400, 300, 1250, 130, 80])
];

describe('FinancialStatementsComponent', () => {
    let fixture: ComponentFixture<FinancialStatementsComponent>;

    function render(years: StatementYear[], dense = false): HTMLElement {
        fixture = TestBed.createComponent(FinancialStatementsComponent);
        fixture.componentRef.setInput('years', years);
        fixture.componentRef.setInput('dense', dense);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    const statement = (el: HTMLElement, key: string) => el.querySelector(`[data-statement="${key}"]`) as HTMLElement;
    const textOf = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    it('shows the income statement, balance sheet and cash flow, each with what it tells you and a takeaway', () => {
        const el = render(YEARS);

        expect(Array.from(el.querySelectorAll('[data-statement] h4')).map(textOf))
            .toEqual(['Income statement', 'Balance sheet', 'Cash flow']);
        for (const key of ['income', 'balance', 'cash']) {
            expect(textOf(statement(el, key).querySelector('[data-testid="statement-what"]'))).not.toBe('');
        }
        expect(textOf(statement(el, 'income').querySelector('[data-testid="statement-takeaway"]')))
            .toBe('Revenue grew 6.3% a year from FY2021 to FY2025; it fell 4.0% in FY2025. Net margin went from 10.0% to 9.0%.');
        expect(textOf(statement(el, 'balance').querySelector('[data-testid="statement-takeaway"]')))
            .toBe('Debt / equity went from 0.10× in FY2021 to 0.24× in FY2025; borrowings rose every year.');
        expect(textOf(statement(el, 'cash').querySelector('[data-testid="statement-takeaway"]')))
            .toBe('Cash from operations was positive in 5 of 5 years and free cash flow in 3 of 5; cash conversion averaged 111%.');
    });

    it('draws a small trend chart per line item with the latest value', () => {
        const el = render(YEARS);
        const charts = statement(el, 'cash').querySelectorAll('[data-testid="trend"]');

        expect(Array.from(charts).map((c) => textOf(c.querySelector('.trend-label'))))
            .toEqual(['Cash from operations (₹ cr)', 'Capex (₹ cr)', 'Free cash flow (₹ cr)', 'Cash conversion']);
        const fcf = charts[2];
        expect(fcf.querySelectorAll('rect').length).toBe(5);
        expect(fcf.querySelectorAll('rect.neg').length).toBe(2);
        expect(textOf(fcf.querySelector('.trend-last'))).toBe('50 FY2025');
    });

    it('keeps the full table behind an expand control', () => {
        const el = render(YEARS);
        const income = statement(el, 'income');
        expect(income.querySelector('table')).toBeNull();

        const toggle = income.querySelector('[data-testid="table-toggle"]') as HTMLButtonElement;
        expect(textOf(toggle)).toBe('Show full table');
        toggle.click();
        fixture.detectChanges();

        const rows = Array.from(income.querySelectorAll('table tr')).map((r) => Array.from(r.children).map(textOf));
        expect(rows[0]).toEqual(['', 'FY2021', 'FY2022', 'FY2023', 'FY2024', 'FY2025']);
        expect(rows[1]).toEqual(['Revenue (₹ cr)', '1,000', '1,100', '1,210', '1,331', '1,278']);
        expect(rows[4]).toEqual(['Net margin', '10.0%', '10.0%', '10.7%', '10.5%', '9.0%']);
        expect(textOf(toggle)).toBe('Hide full table');
        expect(statement(el, 'balance').querySelector('table')).toBeNull();
    });

    it('shows only the tables in Dense mode', () => {
        const el = render(YEARS, true);

        for (const key of ['income', 'balance', 'cash']) {
            expect(statement(el, key).querySelector('table')).not.toBeNull();
        }
        expect(el.querySelector('[data-testid="statement-what"]')).toBeNull();
        expect(el.querySelector('[data-testid="statement-takeaway"]')).toBeNull();
        expect(el.querySelector('[data-testid="trend"]')).toBeNull();
        expect(el.querySelector('[data-testid="table-toggle"]')).toBeNull();
        const balance = Array.from(statement(el, 'balance').querySelectorAll('tr')).map((r) => textOf(r.children[5]));
        expect(balance[4]).toBe('0.24×');
    });

    it('marks missing values and skips takeaways it cannot support', () => {
        const el = render([{ ...YEARS[4], ebitda: null, borrowings: null, debtToEquity: null }], true);

        const rows = Array.from(statement(el, 'income').querySelectorAll('tr')).map((r) => textOf(r.children[1]));
        expect(rows[2]).toBe('—');
        const single = render([YEARS[4]]);
        expect(single.querySelector('[data-testid="statement-takeaway"]')).toBeNull();
    });
});
