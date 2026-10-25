export interface Features {
  // Latest-report MD&A insights: one LLM call per report, always on.
  insights: boolean;
  // Moat + Management trustworthiness over 3 annual reports: many LLM calls, off unless ENABLE_QUALITATIVE is set.
  qualitative: boolean;
  // SWOT from the latest report: several LLM calls, off unless ENABLE_SWOT is set.
  swot: boolean;
}

const enabled = (v: string | undefined) => /^(?:1|true|yes|on)$/i.test(v?.trim() ?? '');

export function features(): Features {
  return {
    insights: true,
    qualitative: enabled(process.env.ENABLE_QUALITATIVE),
    swot: enabled(process.env.ENABLE_SWOT),
  };
}
