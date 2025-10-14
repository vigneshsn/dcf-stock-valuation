class Projections {
    ownerEarning: number;
    discountedOwnerEarning?: number;
    revenue: number;
    netProfit: number;
    capEx: number;
    nonCashEx: number;
    year: number;

    constructor(ownerEarning: number, year: number, revenue: number, netProfit: number, capEx: number, nonCashEx: number, discountedOwnerEarning?: number) {
        this.discountedOwnerEarning = discountedOwnerEarning;
        this.revenue = revenue;
        this.netProfit = netProfit;
        this.capEx = capEx;
        this.nonCashEx = nonCashEx;
        this.ownerEarning = ownerEarning;
        this.year = year;
    }
}