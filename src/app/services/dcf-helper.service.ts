import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class DcfHelperService {
  toDec(x: number): number {
    return Number(x) / 100;
  }

  toFixed(x: number): number {
    return Number(x.toFixed(2));
  }

  cagr(start: number, end: number, years: number): number {
    const cagr = Math.pow(end / start, 1 / years) - 1;
    return this.toFixed(cagr * 100);
  }

  percentage(numerator: number, denominator: number): number {
    const val = numerator / denominator;
    return this.toFixed(val * 100);
  }

  futureValue(recentVal: number, rateInPercentage: number, years: number): number {
    const val = recentVal * Math.pow((1 + this.toDec(rateInPercentage)), years);
    return this.toFixed(val);
  }

  discountedValue(recentVal: number, rateInPercentage: number, years: number): number {
    const val = recentVal / Math.pow((1 + this.toDec(rateInPercentage)), years);
    return this.toFixed(val);
  }

  terminalValue(recentVal: number, terminalRateInPecentage: number, discountRateInPercentage: number, terminalGrowthRate: number): number {
    const val = (recentVal * (1 + this.toDec(terminalGrowthRate))) / (this.toDec(discountRateInPercentage) - this.toDec(terminalGrowthRate));
    return this.toFixed(val);
  }
}
