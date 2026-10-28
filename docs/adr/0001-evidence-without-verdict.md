# Evidence without verdict

The dashboard serves long-term investors who must make their own decision, so an Analysis presents facts before judgement and ends in a Decision summary that lays out the evidence without a buy/sell verdict, recommendation, or nudging wording. For the same reason we show no Analyst consensus, no blended overall score, and no LLM-judged 1-5 scores (the Qualitative score and Management trustworthiness were retired; the Guidance scorecard stays as evidence). The only score left is the deterministic Quantitative score, shown inside Valuation and not repeated in the Decision summary.

## Considered Options

- **Overall rating / buy-sell signal**: rejected; it primes the user and hides the trade-offs they need to weigh.
- **Keep LLM 1-5 scores alongside facts**: rejected; they read as authoritative judgements while being experimental and hard to verify.

## Consequences

- Colour may mark a fact as better or worse than its benchmark (Strength / Weakness), but the Decision summary stays uncoloured.
- New features must add evidence, not conclusions; a proposal for any new score or verdict should supersede this ADR explicitly.
