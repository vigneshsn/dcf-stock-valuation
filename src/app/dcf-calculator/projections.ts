class Projections {
    ownerEarning: number;
    revenue: number;
    netProfit: number;
    capEx: number;
    nonCashEx: number;
    year: number;

    constructor(ownerEarning: number, year: number, revenue: number, netProfit: number, capEx: number, nonCashEx: number) {
        this.revenue = revenue;
        this.netProfit = netProfit;
        this.capEx = capEx;
        this.nonCashEx = nonCashEx;
        this.ownerEarning = ownerEarning;
        this.year = year;
    }
}