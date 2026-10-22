import { Component } from '@angular/core';

type Theme = 'dark' | 'light';
const THEME_KEY = 'vs360-theme';

@Component({
    selector: 'app-root',
    standalone: false,
    styleUrls: ['./app.component.css'],
    templateUrl: './app.component.html'
})
export class AppComponent {
    theme: Theme = this.initialTheme();

    constructor() {
        this.applyTheme();
    }

    toggleTheme(): void {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, this.theme);
        this.applyTheme();
    }

    private initialTheme(): Theme {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'dark' || saved === 'light') {
            return saved;
        }
        return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    private applyTheme(): void {
        document.documentElement.dataset['theme'] = this.theme;
    }
}
