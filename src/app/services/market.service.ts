import { Injectable } from '@angular/core';
import { INDIA_MARKET, MarketDescriptor, MarketFormat } from '../models/market';

/** Holds the Market edition's formatter; defaults to India until the server's descriptor is applied. */
@Injectable({ providedIn: 'root' })
export class MarketService {
    format = new MarketFormat(INDIA_MARKET);

    apply(descriptor: MarketDescriptor): void {
        this.format = new MarketFormat(descriptor);
    }
}
