## Goal
I'm trying to build a stock analysis agent which will read the live financial data & annual reports.
The agent should do a fundamental analysis on two angles,

1. Quantitave analysis
    - Based on key financial ratio's like P/E, P/B, ROE etc
    - Run DCF calculation and comeup with Fair value of stock
    - Come up with Quantitave score (1-5) and explain why

2. Qualitative analysis
    The annual report `management analysis` section is read and compares with other company from same industry to identity moat.
    Also, scan last few year annual report and analyse if the management is trustworthy.
    Come up with Qualitative score (1-5) and explain why

The result of the analysis will be shown in a dashboard

## scope
- Focus on indian stock market first.
- Look for Free financial API's 

## NFRs
- The financial data should be cached to avoid too many API calls.
- if an analysis is already made, cache it with ttl.

## guardrails
- Always get a confirmation before adding any new third party libraries

## Constraint


## verification
- UAT testing from UI