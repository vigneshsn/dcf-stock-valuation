import { environment } from '../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MarketDescriptor, MarketFormat } from '../models/market';

/** Holds the deployment's Market edition. There is no default: an edition that failed to load must not render as another market. */
@Injectable({ providedIn: 'root' })
export class MarketService {
    private readonly baseUrl = `${environment.apiUrl}/api/market`;
    private current: { descriptor: MarketDescriptor; format: MarketFormat } | null = null;

    get descriptor(): MarketDescriptor {
        return this.loaded.descriptor;
    }

    get format(): MarketFormat {
        return this.loaded.format;
    }

    apply(descriptor: MarketDescriptor): void {
        this.current = { descriptor, format: new MarketFormat(descriptor) };
    }

    /** Fetches the server's descriptor; rejects when the edition cannot be determined. */
    async load(): Promise<void> {
        this.apply(await firstValueFrom(inject(HttpClient).get<MarketDescriptor>(this.baseUrl)));
    }

    private get loaded() {
        if (!this.current) {
            throw new Error('Market edition has not been loaded');
        }
        return this.current;
    }
}
