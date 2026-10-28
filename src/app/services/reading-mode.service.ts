import { Injectable, signal } from '@angular/core';

export type ReadingMode = 'explain' | 'dense';

export const READING_MODE_KEY = 'vs360-reading-mode';

/** The global Explain / Dense toggle for the dashboard, remembered in the browser. */
@Injectable({ providedIn: 'root' })
export class ReadingModeService {
    private readonly current = signal<ReadingMode>(this.stored());
    readonly mode = this.current.asReadonly();

    set(mode: ReadingMode): void {
        this.current.set(mode);
        try {
            localStorage.setItem(READING_MODE_KEY, mode);
        } catch {
            // Storage can be unavailable (private mode, quota); the choice then lasts for this visit only.
        }
    }

    private stored(): ReadingMode {
        try {
            return localStorage.getItem(READING_MODE_KEY) === 'dense' ? 'dense' : 'explain';
        } catch {
            return 'explain';
        }
    }
}
