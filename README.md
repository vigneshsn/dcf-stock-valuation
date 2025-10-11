# DCF Valuation App


An interactive Angular application to estimate the intrinsic value of a stock using Discounted Cash Flow (DCF). Features:


- Modern Angular + TypeScript
- Responsive UI styled with Angular Material
- Editable projection table (revenue growth %, profit margin %, FCF %)
- CSV and Excel (XLSX) export
- Printable report
- Unit tests (Jasmine + Karma)


## Setup


1. Ensure Node.js LTS (>=18) and npm are installed.
2. Clone the repo:


```bash
git clone https://github.com/YOUR_USERNAME/dcf-valuation-app.git
cd dcf-valuation-app
```


3. Install dependencies:


```bash
npm install
```


4. Run the app locally:


```bash
npm start
```


5. Run tests:


```bash
npm test
```


## Build


```bash
npm run build
```


## Notes
- Shares are expected in millions to match revenue units. Change units in the UI if needed.
- Be conservative with assumptions — DCF is sensitive to discount rate and terminal growth.


## Contributions
PRs welcome. If you'd like help wiring live financial data (e.g., company revenues, shares outstanding) I can add connectors to financial APIs.