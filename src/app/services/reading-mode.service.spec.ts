import { TestBed } from '@angular/core/testing';
import { READING_MODE_KEY, ReadingModeService } from './reading-mode.service';

describe('ReadingModeService', () => {
    beforeEach(() => localStorage.removeItem(READING_MODE_KEY));
    afterEach(() => localStorage.removeItem(READING_MODE_KEY));

    it('defaults to Dense on first visit', () => {
        expect(TestBed.inject(ReadingModeService).mode()).toBe('dense');
    });

    it('remembers the chosen mode in the browser', () => {
        TestBed.inject(ReadingModeService).set('explain');

        TestBed.resetTestingModule();
        expect(TestBed.inject(ReadingModeService).mode()).toBe('explain');
    });

    it('falls back to Dense when the stored value is not a mode', () => {
        localStorage.setItem(READING_MODE_KEY, 'verbose');
        expect(TestBed.inject(ReadingModeService).mode()).toBe('dense');
    });
});
