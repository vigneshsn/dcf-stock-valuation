class Projections {
    freeCashFlow: number;
    revenue: number;
    netProfit: number;
    capEx: number;
    nonCashEx: number;
    year: number;

    constructor(freeCashFlow: number, year: number, revenue: number, netProfit: number, capEx: number, nonCashEx: number) {
        this.revenue = revenue;
        this.netProfit = netProfit;
        this.capEx = capEx;
        this.nonCashEx = nonCashEx;
        this.freeCashFlow = freeCashFlow;
        this.year = year;
    }
}