import { test } from 'node:test';
import assert from 'node:assert';
import { Peer, selectPeers } from './peers.js';

const p = (symbol: string, marketCap: number | null): Peer => ({ symbol, name: symbol, marketCap });

test('selectPeers: nearest 5 by market cap, excludes target and duplicates', () => {
  const target = p('T', 1000);
  const peers = selectPeers(target, [p('A', 100), p('B', 900), p('C', 1100), p('T', 1000), p('B', 900), p('D', 1300), p('E', 5000), p('F', 990), p('G', null)]);
  assert.deepStrictEqual(peers.map((x) => x.symbol), ['F', 'B', 'C', 'D', 'A']);
});
