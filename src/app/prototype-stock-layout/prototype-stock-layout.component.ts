// PROTOTYPE: throwaway dashboard-layout variants with mock data. Do not ship.
// Question: how should the stock dashboard be organised so a long-term investor
// understands the company first and sees the analysis gradually?
// Four layouts on /prototype/stock-layout?variant=A|B|C|D, plus an Explain/Dense toggle.
import {Component, computed, inject, signal} from '@angular/core';
import {DecimalPipe, NgTemplateOutlet} from '@angular/common';
import {ActivatedRoute} from '@angular/router';
import {toSignal} from '@angular/core/rxjs-interop';
import {map} from 'rxjs';
import {PrototypeSwitcherComponent} from '../prototype-switcher/prototype-switcher.component';

type ChapterId = 'overview' | 'statements' | 'strengths' | 'risks' | 'management' | 'valuation' | 'decision';

interface Chapter {
    id: ChapterId;
    title: string;
    question: string;
    headline: string;
}

interface LineItem {
    label: string;
    values: number[];
    explain: string;
    unit?: '%' | 'x';
}

interface Statement {
    key: string;
    title: string;
    what: string;
    takeaway: string;
    items: LineItem[];
}

const YEARS = [2021, 2022, 2023, 2024, 2025];
const revenue = [21712, 29101, 34489, 35495, 33906];
const ebitda = [5150, 5400, 7900, 8000, 6200];
const netProfit = [3135, 4106, 5460, 5558, 3667];
const totalAssets = [20000, 23000, 26000, 29000, 30000];
const debt = [900, 1300, 1700, 2100, 2500];
const equity = [15000, 16000, 19000, 21000, 21500];
const cfo = [3600, 1100, 6100, 5300, 4300];
const capex = [600, 1000, 2000, 2700, 1800];
const pct = (a: number[], b: number[]) => a.map((v, i) => +(100 * v / b[i]).toFixed(1));

@Component({
    selector: 'app-prototype-stock-layout',
    standalone: true,
    imports: [NgTemplateOutlet, DecimalPipe, PrototypeSwitcherComponent],
    templateUrl: './prototype-stock-layout.component.html',
    styleUrls: ['./prototype-stock-layout.component.css']
})
export class PrototypeStockLayoutComponent {
    readonly variants = ['A', 'B', 'C', 'D', 'E'];
    readonly variantNames: Record<string, string> = {
        A: 'Guided stepper',
        B: 'Tabs + company sidebar',
        C: 'Long-form report',
        D: 'Overview cockpit + drawer',
        E: 'C merged: 5 blocks, open by default'
    };
    readonly variant = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => p.get('variant') ?? 'A')), {initialValue: 'A'});

    readonly mode = signal<'explain' | 'dense'>('explain');
    readonly active = signal<ChapterId>('overview');
    readonly drawer = signal<ChapterId | null>(null);
    readonly expanded = signal<Set<string>>(new Set());

    readonly years = YEARS;

    readonly company = {
        name: 'Example Paints Ltd (DEMO DATA)',
        ticker: 'EXPAINT',
        industry: 'Paints & coatings',
        description: 'Makes and sells decorative and industrial paints across India and 14 other countries through ~1.6 lakh dealers. Decorative paints for homes are ~85% of revenue.',
        price: 2410,
        marketCap: 231000,
        week52Low: 2125,
        week52High: 3395,
        pe: 63,
        pb: 10.7,
        roe: 17.1,
        roce: 22.4,
        dividendYield: 1.1,
        segments: [{name: 'Decorative (India)', share: 85}, {name: 'International', share: 10}, {name: 'Industrial', share: 5}]
    };

    readonly statements: Statement[] = [
        {
            key: 'income',
            title: 'Income statement',
            what: 'How much the company sold and how much of it it kept as profit during each year.',
            takeaway: 'Revenue grew ~12% a year to 2024, then dipped 4% in 2025. Net margin fell from ~16% to ~11% in 2025.',
            items: [
                {label: 'Revenue (₹ cr)', values: revenue, explain: 'Total sales in the year.'},
                {label: 'EBITDA (₹ cr)', values: ebitda, explain: 'Operating profit before interest, tax and depreciation.'},
                {label: 'Net profit (₹ cr)', values: netProfit, explain: 'What is left for shareholders after every expense.'},
                {label: 'Net margin', values: pct(netProfit, revenue), unit: '%', explain: 'Net profit as a share of revenue.'}
            ]
        },
        {
            key: 'balance',
            title: 'Balance sheet',
            what: 'What the company owns (assets) and owes (debt) at year end, and what belongs to shareholders (equity).',
            takeaway: 'Debt is small compared with equity (0.12x), but it has risen every year since 2021.',
            items: [
                {label: 'Total assets (₹ cr)', values: totalAssets, explain: 'Everything the company owns.'},
                {label: 'Borrowings (₹ cr)', values: debt, explain: 'Money owed to lenders.'},
                {label: 'Shareholder equity (₹ cr)', values: equity, explain: 'Assets minus liabilities: the owners’ stake.'},
                {label: 'Debt / equity', values: debt.map((d, i) => +(d / equity[i]).toFixed(2)), unit: 'x', explain: 'Below 0.5x is generally considered low.'}
            ]
        },
        {
            key: 'cash',
            title: 'Cash flow',
            what: 'Actual cash that came in from operations and went out to investments (capex) in each year.',
            takeaway: 'Operations generated cash every year. Capex rose in 2023–24 for new plants, so free cash flow fell.',
            items: [
                {label: 'Cash from operations (₹ cr)', values: cfo, explain: 'Cash generated by the day-to-day business.'},
                {label: 'Capex (₹ cr)', values: capex, explain: 'Cash spent on plants and equipment.'},
                {label: 'Free cash flow (₹ cr)', values: cfo.map((c, i) => c - capex[i]), explain: 'Cash left after capex: what can be paid out or reinvested.'},
                {label: 'Cash conversion', values: pct(cfo, netProfit), unit: '%', explain: 'Operating cash as a share of net profit. Around 100% means profits turn into real cash.'}
            ]
        }
    ];

    readonly strengths = [
        {metric: 'ROCE', company: '22.4%', compare: 'Peer median 14.1%', basis: 'peers'},
        {metric: 'Debt / equity', company: '0.12x', compare: 'Peer median 0.41x', basis: 'peers'},
        {metric: 'Revenue CAGR (4y)', company: '11.8%', compare: 'Peer median 8.0%', basis: 'peers'}
    ];
    readonly weaknesses = [
        {metric: 'Net margin', company: '10.8%', compare: '5y average 14.9%', basis: 'history'},
        {metric: 'Revenue growth (2025)', company: '−4.5%', compare: '4y average +12.6%', basis: 'history'},
        {metric: 'Borrowings', company: '₹2,500 cr', compare: '2.8x the 2021 level', basis: 'history'}
    ];
    readonly redFlags = [
        {title: 'Rising borrowings', detail: 'Borrowings grew every year for 4 years while equity grew more slowly.'}
    ];
    readonly mdna = {
        tailwinds: ['Housing demand recovery in tier 2/3 cities', 'Lower crude-linked raw material costs'],
        headwinds: ['New, well-funded competitors entering decorative paints', 'Weak urban demand in H2'],
        guidance: {met: 3, missed: 2, pending: 1}
    };
    readonly valuation = {
        fairValue: 2050,
        bear: 1620,
        bull: 2710,
        impliedGrowth: 14.2,
        historicGrowth: 11.8,
        quantScore: 2
    };

    readonly chapters: Chapter[] = [
        {id: 'overview', title: 'Business overview', question: 'What does the company do?', headline: 'Paints maker, ₹2.3 lakh cr market cap, 85% decorative'},
        {id: 'statements', title: 'Financial statements', question: 'How has it performed?', headline: 'Revenue +12%/yr to 2024; dipped 2025'},
        {id: 'strengths', title: 'Strengths & weaknesses', question: 'Where is it strong, where does it lag?', headline: '3 strengths · 3 weaknesses'},
        {id: 'risks', title: 'Risks & red flags', question: 'What could go wrong?', headline: '1 red flag'},
        {id: 'management', title: 'Management & annual report', question: 'What does management say, and do they deliver?', headline: 'Guidance: 3 met · 2 missed'},
        {id: 'valuation', title: 'Valuation', question: 'What is it worth vs its price?', headline: 'Fair value ₹2,050 · price ₹2,410'},
        {id: 'decision', title: 'Decision summary', question: 'All the evidence, side by side', headline: 'Evidence only, no verdict'}
    ];

    readonly blocks: { id: string; title: string; headline: string; parts: ChapterId[] }[] = [
        {id: 'b-overview', title: 'Business overview', headline: 'Paints maker, ₹2.3 lakh cr market cap, 85% decorative', parts: ['overview']},
        {id: 'b-financials', title: 'Financials', headline: 'Statements · 3 strengths · 3 weaknesses · 1 red flag', parts: ['statements', 'strengths', 'risks']},
        {id: 'b-management', title: 'Management & annual report', headline: 'Tailwinds, headwinds, guidance track record', parts: ['management']},
        {id: 'b-valuation', title: 'Valuation', headline: 'Fair value ₹2,050 · price ₹2,410', parts: ['valuation']},
        {id: 'b-decision', title: 'Decision summary', headline: 'Evidence only, no verdict', parts: ['decision']}
    ];

    readonly activeIndex = computed(() => this.chapters.findIndex((c) => c.id === this.active()));

    chapter(id: ChapterId): Chapter {
        return this.chapters.find((c) => c.id === id)!;
    }

    go(delta: number): void {
        const i = Math.min(this.chapters.length - 1, Math.max(0, this.activeIndex() + delta));
        this.active.set(this.chapters[i].id);
        window.scrollTo({top: 0, behavior: 'smooth'});
    }

    toggle(key: string): void {
        const next = new Set(this.expanded());
        next.has(key) ? next.delete(key) : next.add(key);
        this.expanded.set(next);
    }

    isOpen(key: string): boolean {
        return this.expanded().has(key);
    }

    scrollTo(id: string): void {
        document.getElementById('c-' + id)?.scrollIntoView({behavior: 'smooth', block: 'start'});
    }

    bars(values: number[]): { x: number; y: number; h: number; neg: boolean }[] {
        const max = Math.max(...values.map(Math.abs), 1);
        return values.map((v, i) => {
            const h = Math.max(2, (Math.abs(v) / max) * 40);
            return {x: i * 22 + 2, y: 44 - h, h, neg: v < 0};
        });
    }

    fmt(v: number, unit?: string): string {
        if (unit === '%') return v.toFixed(1) + '%';
        if (unit === 'x') return v.toFixed(2) + 'x';
        return v.toLocaleString('en-IN');
    }

    rangePos(v: number): number {
        const lo = this.valuation.bear * 0.9;
        const hi = this.valuation.bull * 1.05;
        return ((v - lo) / (hi - lo)) * 100;
    }
}
