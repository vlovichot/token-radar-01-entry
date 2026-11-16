// The radar model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// Implied value is derived only from figures the snapshot itself carries. Protocols that already
// trade a token show what the market pays per dollar of TVL in each category; a pre-token
// protocol is priced off its own category's median multiple, then adjusted for its recent
// growth and for how long it has run with no token:
//
//   multiple = median(mcap_usd / tvl_usd) over the category's tokenized protocols in the snapshot
//              (the global median when the category has fewer than 3 tokenized peers)
//   base     = tvl_usd x multiple
//   growth   = 1 + clamp(change_7d, -50, 200) / 100 x 0.5      (no reported change: 1)
//   age      = 1 + min(years listed with no token, 5) x 0.06    (no listed day: 1)
//   implied  = round(base x growth x age), capped at 1e12
//
// No protocol name is ever special-cased: the same arithmetic scores every row.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** One scored protocol with every model component, for the dashboard's detail view. */
export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  chains: string[];
  tvl: number;
  chg: number | null;
  listed: string | null;
  mult: number;
  gf: number;
  af: number;
  implied: number;
  watch: boolean;
  steps: string[];
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  total: number;
  tokenless: number;
  watchlist: number;
  global_multiple: number;
  multiples: { category: string; multiple: number; peers: number }[];
  rows: RadarRow[];
}

export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return doc;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Median mcap/TVL multiple per category over tokenized protocols, plus the global median. */
export function categoryMultiples(snapshot: Snapshot): {
  byCategory: Map<string, { multiple: number; peers: number }>;
  global: number;
} {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '';
    const list = ratios.get(key);
    if (list) list.push(ratio);
    else ratios.set(key, [ratio]);
  }
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, list] of ratios) byCategory.set(key, { multiple: median(list), peers: list.length });
  return { byCategory, global: median(all) };
}

const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 4,
  Arbitrum: 0.15,
  Base: 0.08,
  Solana: 0.02,
  Binance: 0.2,
  'BNB Chain': 0.2,
  Polygon: 0.03,
  Avalanche: 0.25,
  Optimism: 0.12,
};

function gasFor(chain: string): string {
  const cost = GAS_BY_CHAIN[chain] ?? 0.5;
  return cost < 1 ? cost.toFixed(2) : cost.toFixed(0);
}

/** Position-size wording by TVL tier, so plans scale with the protocol's weight. */
function sizeFor(tvl: number): string {
  if (tvl >= 500_000_000) return '$2,000-$5,000';
  if (tvl >= 100_000_000) return '$1,000-$2,000';
  if (tvl >= 25_000_000) return '$400-$1,000';
  return '$100-$400';
}

type PlanKind = 'dexs' | 'lending' | 'staking' | 'bridge' | 'yield' | 'perps' | 'core';

function planKind(category: string | null): PlanKind {
  switch (category) {
    case 'Dexs':
      return 'dexs';
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'CDP':
    case 'CDP Manager':
      return 'lending';
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaking':
    case 'Staking Pool':
    case 'Restaked BTC':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return 'staking';
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return 'bridge';
    case 'Yield':
    case 'Yield Aggregator':
    case 'Leveraged Farming':
    case 'Farm':
    case 'Liquidity Manager':
    case 'Basis Trading':
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Options Vault':
      return 'yield';
    case 'Derivatives':
    case 'Synthetics':
    case 'Options':
    case 'Interest Rate Derivatives':
      return 'perps';
    default:
      return 'core';
  }
}

/** A concrete farm plan for one protocol, written from its category, main chain and TVL tier. */
export function farmSteps(p: SnapshotProtocol): string[] {
  const name = p.name;
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasFor(chain);
  const size = sizeFor(p.tvl_usd);
  const kind = planKind(p.category);
  const plans: Record<PlanKind, string[]> = {
    dexs: [
      `Open ${name} on ${chain} and make a first swap of about ${size} between two liquid assets to learn the interface and fees. Gas about $${gas}; ~10 minutes.`,
      `Add about ${size} of liquidity to one of ${name}'s main pools on ${chain} and keep the position open; liquidity providers are the users such launches usually recognise first. Gas about $${gas}; ~15 minutes, then hold at least 4 weeks.`,
      `Swap through ${name} once a week for 6 weeks, varying the pair and the size so the activity reads as ordinary use rather than a single visit. Gas about $${gas} per swap; ~5 minutes each.`,
      `Claim any fees or points ${name} shows in its interface each week and re-add claimed fees to the pool position instead of withdrawing them. Gas about $${gas} per claim; ~5 minutes each week.`,
      `Keep the liquidity position open until ${name} announces a token or a points snapshot; withdrawing early is the most common way farmers lose eligibility. No gas while holding; review monthly, ~5 minutes.`,
    ],
    lending: [
      `Open ${name} on ${chain} and supply about ${size} of a major stablecoin or ETH as collateral in its main market. Gas about $${gas}; ~10 minutes.`,
      `Borrow a small amount, roughly 20% of what you supplied, against the position on ${name}, then repay it in full a few days later; one clean borrow-and-repay loop shows real use. Gas about $${gas} per transaction; ~10 minutes per leg.`,
      `Repeat the supply and small borrow cycle once a month for at least 3 months, so the address builds a history on ${name} rather than a single spike. Gas about $${gas} per cycle; ~15 minutes each month.`,
      `Keep the supplied collateral in place and check the position's health factor weekly; top up or repay if it drifts toward liquidation. Gas about $${gas} only when you act; ~5 minutes per check.`,
      `Stay supplied until ${name} announces a token or the end of a points program; leaving before a snapshot is the usual reason wallets miss out. No gas while holding; ~5 minutes a month to review.`,
    ],
    staking: [
      `Open ${name} on ${chain} and stake about ${size} of the base asset through its main staking flow. Gas about $${gas}; ~10 minutes.`,
      `Hold the receipt token ${name} issues in the same wallet and do not sell or bridge it away, since the receipt is the record of your stake. No gas while holding; check in monthly, ~5 minutes.`,
      `Add a second, smaller stake of about a quarter of the first after 4 weeks, so the position shows continued use over time rather than one deposit. Gas about $${gas}; ~10 minutes.`,
      `Put a small part of the receipt token to work in one integration ${name} lists, such as a lending market or pool, keeping most of the stake untouched. Gas about $${gas}; ~15 minutes.`,
      `Keep staking until ${name} announces a token or a snapshot date; unstaking in full before then usually ends eligibility. Gas about $${gas} if you unstake; review quarterly, ~5 minutes.`,
    ],
    bridge: [
      `Open ${name} and bridge about ${size} from ${chain} to one of the networks it serves, and keep the transaction hashes. Gas about $${gas} plus any bridge fee shown; ~15 minutes.`,
      `Bridge a similar amount back, or onward to a second network, after about 2 weeks, so the route shows two-way use rather than a one-off hop. Gas about $${gas} plus bridge fee; ~15 minutes.`,
      `Repeat one bridge a month for at least 3 months, varying the amount slightly each time. Gas about $${gas} per trip; ~15 minutes each month.`,
      `Hold some of the bridged funds on the destination chain and use one local application there, so the activity continues past the bridge itself. Gas varies by chain; ~20 minutes.`,
      `Keep a small balance moving through ${name} until it announces a token or a points program; dormant one-trip wallets are the first filtered out. Gas about $${gas} per trip; ~10 minutes a month.`,
    ],
    yield: [
      `Open ${name} on ${chain} and deposit about ${size} into one of its main vaults or strategies. Gas about $${gas}; ~10 minutes.`,
      `Leave the deposit in place for at least 6 weeks; a vault balance held over time is the record most points programs read. No gas while holding; ~5 minutes a week to check.`,
      `Claim and re-deposit any rewards ${name} accrues to the position once a month, compounding instead of withdrawing. Gas about $${gas} per claim; ~10 minutes each month.`,
      `Add a second, smaller deposit of about a third of the first in a later month, so the history spans more than one period. Gas about $${gas}; ~10 minutes.`,
      `Withdraw only after ${name} announces a token, a points end or a snapshot; exiting the vault early is the standard way to forfeit a season. Gas about $${gas} on exit; review monthly, ~5 minutes.`,
    ],
    perps: [
      `Open ${name} on ${chain}, deposit about ${size} as margin and place one small trade to learn the interface, fees and funding. Gas about $${gas}; ~15 minutes.`,
      `Trade modest volume on ${name} each week for 6 weeks, sized to the deposit rather than chasing volume records; steady weeks count for more than one large day. Gas about $${gas} per trade; ~10 minutes each.`,
      `Keep margin in the account between sessions instead of withdrawing everything after each trade. No gas while idle; ~5 minutes a week to check funding and open positions.`,
      `Try a second market or contract type ${name} offers with a small position, so the account shows breadth of use. Gas about $${gas}; ~15 minutes.`,
      `Stay active until ${name} announces a token or a points snapshot; accounts that stopped months earlier are rarely the ones rewarded. Gas about $${gas} per trade; ~10 minutes a week.`,
    ],
    core: [
      `Open ${name} on ${chain}, connect a wallet and complete its core action once with about ${size}, so the address appears in its user set. Gas about $${gas}; ~15 minutes.`,
      `Use ${name}'s main product once a week for at least 6 weeks; repeated ordinary use is what most retroactive programs measure. Gas about $${gas} per session; ~10 minutes each.`,
      `Hold a position or balance with ${name} between sessions rather than withdrawing after every visit. No gas while holding; ~5 minutes a week to check.`,
      `Try one secondary feature ${name} offers, such as a second market, chain or product line, with a small amount. Gas about $${gas}; ~15 minutes.`,
      `Keep the activity going until ${name} announces a token or a points program; stopping months before a snapshot is the usual reason wallets are skipped. Gas about $${gas} per session; review monthly, ~5 minutes.`,
    ],
  };
  return plans[kind];
}

/** Score every pre-token protocol and return the ranked board plus the dashboard's data. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { byCategory, global } = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const asOf = new Date(`${snapshot.as_of}T00:00:00Z`).getTime();

  const scored: RadarRow[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null) continue; // records a token already: not the radar's subject
    const entry = byCategory.get(p.category ?? '');
    const mult = entry !== undefined && entry.peers >= 3 ? entry.multiple : global;
    const gf = p.change_7d === null ? 1 : 1 + (clamp(p.change_7d, -50, 200) / 100) * 0.5;
    let af = 1;
    if (p.listed_at !== null) {
      const listed = new Date(`${p.listed_at}T00:00:00Z`).getTime();
      const years = Math.max(0, (asOf - listed) / (365.25 * 24 * 3600 * 1000));
      af = 1 + Math.min(years, 5) * 0.06;
    }
    const implied = Math.min(1e12, Math.max(1, Math.round(p.tvl_usd * mult * gf * af)));
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      chg: p.change_7d,
      listed: p.listed_at,
      mult,
      gf,
      af,
      implied,
      watch: watch.has(p.slug),
      steps: farmSteps(p),
    });
  }

  scored.sort((a, b) => b.implied - a.implied || b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1));
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const board: BoardRow[] = scored.map((row) => ({
    slug: row.slug,
    name: row.name,
    rank: row.rank,
    implied_value_usd: row.implied,
    farm_steps: row.steps,
  }));

  const multiples = [...byCategory.entries()]
    .map(([category, v]) => ({ category: category === '' ? 'Uncategorised' : category, multiple: v.multiple, peers: v.peers }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));

  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      total: snapshot.protocols.length,
      tokenless: scored.length,
      watchlist: snapshot.watchlist.length,
      global_multiple: global,
      multiples,
      rows: scored,
    },
  };
}

/** The dashboard's data as the script the page loads beside dashboard/. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** Null when the board passes the gate's shape, else the first problem found. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  let previous = Number.POSITIVE_INFINITY;
  for (const row of [...board].sort((a, b) => a.rank - b.rank)) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!Number.isInteger(row.rank) || row.rank <= 0 || ranks.has(row.rank)) return `rank ${row.rank} is not a clean positive rank`;
    ranks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 1e14) {
      return `implied value for ${row.slug} is out of range`;
    }
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    previous = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `farm_steps for ${row.slug} is not 3 to 12 steps`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `a farm step for ${row.slug} is ${len} characters`;
    }
  }
  for (let rank = 1; rank <= board.length; rank += 1) {
    if (!ranks.has(rank)) return `rank ${rank} is missing`;
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
