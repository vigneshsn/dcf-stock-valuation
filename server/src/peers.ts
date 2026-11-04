export interface Peer {
  symbol: string;
  name: string;
  marketCap: number | null;
}

// Share classes (BRK.B) are US listings; any other dotted suffix is a foreign exchange (.KS, .HK, .NS).
export function listedInMarket(edition: 'india' | 'us', symbol: string): boolean {
  const suffix = symbol.includes('.') ? symbol.split('.').pop()!.toUpperCase() : '';
  return edition === 'india' ? suffix === 'NS' : suffix === '' || suffix.length === 1;
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
