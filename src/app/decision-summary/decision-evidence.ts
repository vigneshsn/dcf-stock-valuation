import {
    QuantitativeAnalysis,
    RED_FLAG_NAMES,
    RedFlagScan,
    ReverseDcfAnalysis,
    StatementYear,
    StrengthsWeaknesses
} from '../models/analysis';
import { StockMetrics } from '../models/stock-metrics';

/** Everything the Decision summary draws on; null while a source is loading or after it failed. */
export interface EvidenceSources {
    metrics: StockMetrics | null;
    /** Oldest first. */
    statements: StatementYear[] | null;
    strengths: StrengthsWeaknesses | null;
    redFlags: RedFlagScan | null;
    quant: QuantitativeAnalysis | null;
    reverseDcf: ReverseDcfAnalysis | null;
}

export interface EvidenceRow {
    label: string;
    /** null when the source has not arrived or cannot supply this row. */
    text: string | null;
}

/**
 * The Decision summary's evidence, one neutral sentence per row. Facts only: no verdict, no nudging wording,
 * and the Quantitative score is not repeated (docs/adr/0001-evidence-without-verdict.md).
 */
export function decisionEvidence(s: EvidenceSources): EvidenceRow[] {
    const years = s.statements ?? [];
    return [
        { label: 'Business', text: business(s.metrics) },
        { label: 'Growth', text: growth(years) },
        { label: 'Profitability', text: profitability(s.metrics, years) },
        { label: 'Financial health', text: health(years) },
        { label: 'Cash', text: cash(years) },
        { label: 'Strengths / Weaknesses', text: strengths(s.strengths) },
        { label: 'Red flags', text: redFlags(s.redFlags) },
        { label: 'Valuation', text: valuation(s) }
    ];
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const ratio = (v: number) => `${v.toFixed(2)}×`;
const rupees = (v: number) => `${v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const joined = (parts: (string | null)[]) => {
    const kept = parts.filter((p): p is string => !!p);
    return kept.length ? kept.join('; ') : null;
};

function business(m: StockMetrics | null): string | null {
    const intro = m?.companyIntroduction;
    if (!intro) {
        return null;
    }
    const firstSentence = intro.description?.trim().match(/^.+?[.!?](?=\s|$)/)?.[0] ?? intro.description?.trim() ?? null;
    const parts = [intro.industry ? `${intro.industry}.` : null, firstSentence].filter((p): p is string => !!p);
    return parts.length ? parts.join(' ') : null;
}

function growth(years: StatementYear[]): string | null {
    const known = years.filter((y) => (y.revenue ?? 0) > 0);
    if (known.length < 2) {
        return null;
    }
    const first = known[0];
    const last = known[known.length - 1];
    const cagr = (Math.pow(last.revenue! / first.revenue!, 1 / (last.year - first.year)) - 1) * 100;
    let text = `Revenue ${cagr >= 0 ? 'grew' : 'fell'} ${pct(Math.abs(cagr))} a year from FY${first.year} to FY${last.year}`;
    const prior = known.find((y) => y.year === last.year - 1);
    if (prior && last.year - first.year > 1) {
        const change = (last.revenue! / prior.revenue! - 1) * 100;
        text += `; it ${change >= 0 ? 'grew' : 'fell'} ${pct(Math.abs(change))} in FY${last.year}`;
    }
    return text;
}

function profitability(m: StockMetrics | null, years: StatementYear[]): string | null {
    const margins = years.filter((y) => y.netMargin != null);
    let margin: string | null = null;
    if (margins.length) {
        const last = margins[margins.length - 1];
        margin = `net margin ${pct(last.netMargin!)} in FY${last.year}`;
        if (margins.length >= 2) {
            const avg = margins.reduce((sum, y) => sum + y.netMargin!, 0) / margins.length;
            margin += ` (FY${margins[0].year}–FY${last.year} average ${pct(avg)})`;
        }
    }
    return joined([
        m?.roce != null ? `ROCE ${pct(m.roce)}` : null,
        m?.roe != null ? `ROE ${pct(m.roe)}` : null,
        margin
    ]);
}

function health(years: StatementYear[]): string | null {
    const known = years.filter((y) => y.debtToEquity != null);
    if (!known.length) {
        return null;
    }
    const first = known[0];
    const last = known[known.length - 1];
    let text = `Debt / equity ${ratio(last.debtToEquity!)} in FY${last.year}`;
    if (known.length >= 2) {
        text += ` (${ratio(first.debtToEquity!)} in FY${first.year})`;
    }
    const borrowings = years.map((y) => y.borrowings);
    if (borrowings.length >= 3 && borrowings.every((b) => b != null)) {
        const steps = borrowings.slice(1).map((b, i) => b! - borrowings[i]!);
        if (steps.every((d) => d > 0)) {
            text += '; borrowings rose every year';
        } else if (steps.every((d) => d < 0)) {
            text += '; borrowings fell every year';
        }
    }
    return text;
}

function cash(years: StatementYear[]): string | null {
    const cfo = years.filter((y) => y.operatingCashFlow != null);
    const lastFcf = years.filter((y) => y.freeCashFlow != null).at(-1);
    return joined([
        cfo.length ? `Cash from operations positive in ${cfo.filter((y) => y.operatingCashFlow! > 0).length} of ${plural(cfo.length, 'year')}` : null,
        lastFcf ? `free cash flow ${rupees(lastFcf.freeCashFlow!)} cr in FY${lastFcf.year}` : null
    ]);
}

function strengths(sw: StrengthsWeaknesses | null): string | null {
    if (!sw) {
        return null;
    }
    if (sw.status !== 'ok') {
        return sw.message;
    }
    return `${plural(sw.strengths.length, 'Strength')} · ${sw.weaknesses.length} ${sw.weaknesses.length === 1 ? 'Weakness' : 'Weaknesses'}`;
}

function redFlags(scan: RedFlagScan | null): string | null {
    if (!scan) {
        return null;
    }
    if (scan.status !== 'ok') {
        return scan.message;
    }
    if (scan.flags.length) {
        return `${scan.flags.length}: ${scan.flags.map((f) => RED_FLAG_NAMES[f.id]).join(', ')}`;
    }
    // The scan only covers its fixed rules, so no flags is never presented as an all-clear.
    const skipped = scan.skipped.length;
    return `None raised on available data${skipped ? `; ${plural(skipped, 'rule')} could not run` : ''}`;
}

/** Always names all four items, with "—" for any not yet loaded or unavailable, so none silently drops out. */
function valuation({ metrics, quant, reverseDcf }: EvidenceSources): string | null {
    const price = quant?.price ?? metrics?.currentPrice ?? null;
    if (price == null && !quant && !reverseDcf) {
        return null;
    }
    const bear = quant?.scenarios?.bear.fairValuePerShare;
    const bull = quant?.scenarios?.bull.fairValuePerShare;
    let range = 'Scenario range —';
    if (quant && !quant.scenarios) {
        range = 'Scenario range not applicable';
    } else if (bear != null && bull != null) {
        range = `Scenario range ${rupees(bear)}–${rupees(bull)}`;
    }
    let implied = 'Implied growth —';
    if (reverseDcf?.status === 'ok' && reverseDcf.impliedGrowth != null) {
        implied = `Implied growth ${Number(reverseDcf.impliedGrowth.toFixed(1))}%`;
    } else if (reverseDcf?.message) {
        implied = `Implied growth: ${reverseDcf.message}`;
    }
    return [
        `Price ${price != null ? rupees(price) : '—'}`,
        `Fair value ${quant ? rupees(quant.fairValue) : '—'}`,
        range,
        implied
    ].join(' · ');
}
