export interface Peer {
  symbol: string;
  name: string;
  marketCap: number | null;
}

// The Peer set: the 3-5 companies closest in market cap to the target.
export function selectPeers(target: Peer, candidates: Peer[]): Peer[] {
  const seen = new Set<string>([target.symbol]);
  const unique = candidates.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)));
  if (target.marketCap == null) {
    return unique.slice(0, 5);
  }
  const distance = (p: Peer) => (p.marketCap == null ? Infinity : Math.abs(p.marketCap - target.marketCap!));
  return [...unique].sort((a, b) => distance(a) - distance(b)).slice(0, 5);
}
