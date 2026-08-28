// Server-side wallet analysis built on free public APIs (Blockscout v2, ensdata).
// No API keys required — suitable for MVP; swap in dedicated indexers when scaling.

const BLOCKSCOUT = "https://eth.blockscout.com/api/v2";

export interface TokenHolding {
  name: string;
  symbol: string;
  amount: number;
  usdValue: number | null;
  likelySpam: boolean;
}

export interface PortfolioBreakdown {
  totalUsd: number;
  ethPct: number;
  stablePct: number;
  bluechipPct: number;
  speculativePct: number;
  riskProfile: "conservative" | "balanced" | "aggressive" | "degen";
  whaleTier: "shrimp" | "fish" | "dolphin" | "whale";
}

export interface ActivityItem {
  hash: string;
  timestamp: string;
  label: string;
  description: string;
  direction: "in" | "out" | "self";
}

export interface WalletReport {
  address: string;
  ensName: string | null;
  isContract: boolean;
  ethBalance: number;
  ethPriceUsd: number | null;
  balanceUsd: number | null;
  txCount: number;
  gasSpentEth: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  activityLevel: "dormant" | "occasional" | "active" | "power user";
  headline: string;
  insights: string[];
  traderTake: string[];
  portfolio: PortfolioBreakdown | null;
  holdings: TokenHolding[];
  recentActivity: ActivityItem[];
}

interface BlockscoutTx {
  hash: string;
  timestamp: string;
  method: string | null;
  status: string;
  value: string;
  fee?: { value: string };
  from: { hash: string; name?: string | null };
  to: { hash: string; name?: string | null } | null;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isAddress(input: string): boolean {
  return ADDRESS_RE.test(input);
}

export async function resolveEns(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.ensdata.net/${encodeURIComponent(name)}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.address === "string" && isAddress(data.address) ? data.address : null;
  } catch {
    return null;
  }
}

async function getJson<T>(url: string, noStore = false): Promise<T | null> {
  try {
    const res = await fetch(url, noStore ? { cache: "no-store" } : { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const weiToEth = (wei: string) => Number(wei) / 1e18;

const STABLECOINS = new Set(["USDT", "USDC", "DAI", "USDS", "USDE", "TUSD", "FDUSD", "PYUSD", "GUSD", "USDP", "FRAX", "LUSD"]);
const BLUECHIPS = new Set(["WETH", "WBTC", "CBBTC", "STETH", "WSTETH", "RETH", "CBETH", "UNI", "LINK", "AAVE", "MKR", "SKY", "LDO", "ENS", "CRV", "COMP", "SNX"]);
const CEX_RE = /binance|coinbase|kraken|okx|bybit|bitget|gate\.io|kucoin|bitfinex|htx|huobi|crypto\.com|gemini|upbit|mexc/i;

function buildPortfolio(
  ethUsd: number | null,
  holdings: TokenHolding[]
): PortfolioBreakdown | null {
  const priced = holdings.filter((h) => h.usdValue !== null && !h.likelySpam);
  const stable = priced.filter((h) => STABLECOINS.has(h.symbol.toUpperCase())).reduce((s, h) => s + h.usdValue!, 0);
  const bluechip = priced.filter((h) => BLUECHIPS.has(h.symbol.toUpperCase())).reduce((s, h) => s + h.usdValue!, 0);
  const eth = ethUsd ?? 0;
  const totalUsd = eth + priced.reduce((s, h) => s + h.usdValue!, 0);
  if (totalUsd < 1) return null;

  const speculative = totalUsd - eth - stable - bluechip;
  const pct = (n: number) => Math.round((n / totalUsd) * 100);
  const stablePct = pct(stable);
  const speculativePct = pct(speculative);

  const riskProfile: PortfolioBreakdown["riskProfile"] =
    speculativePct >= 50 ? "degen" : speculativePct >= 25 ? "aggressive" : stablePct >= 30 ? "conservative" : "balanced";

  const whaleTier: PortfolioBreakdown["whaleTier"] =
    totalUsd >= 1_000_000 ? "whale" : totalUsd >= 100_000 ? "dolphin" : totalUsd >= 10_000 ? "fish" : "shrimp";

  return { totalUsd, ethPct: pct(eth), stablePct, bluechipPct: pct(bluechip), speculativePct, riskProfile, whaleTier };
}

/** Expert-trader style read of recent flows, counterparties, and portfolio posture. */
function buildTraderTake(
  txs: BlockscoutTx[],
  wallet: string,
  portfolio: PortfolioBreakdown | null,
  holdings: TokenHolding[]
): string[] {
  const take: string[] = [];

  if (portfolio) {
    const mix = `Portfolio mix: ${portfolio.ethPct}% ETH, ${portfolio.stablePct}% stablecoins, ${portfolio.bluechipPct}% blue-chip tokens, ${portfolio.speculativePct}% speculative.`;
    const reads: Record<PortfolioBreakdown["riskProfile"], string> = {
      conservative: "A defensive posture — plenty of \"dry powder\" (stablecoins) ready to buy dips.",
      balanced: "A balanced posture — mostly core assets, limited gambling.",
      aggressive: "A risk-on posture — meaningful exposure to volatile small tokens.",
      degen: "A high-risk posture — most value sits in speculative tokens that can move 50%+ in a day.",
    };
    take.push(`${mix} ${reads[portfolio.riskProfile]}`);
    take.push(
      `Size class: ${portfolio.whaleTier} (total ~$${portfolio.totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}). ${
        portfolio.whaleTier === "whale" ? "Large enough that its trades can move thin markets." : ""
      }`.trim()
    );
  }

  const lower = wallet.toLowerCase();
  let ethIn = 0;
  let ethOut = 0;
  let cexDeposits = 0;
  let cexWithdrawals = 0;
  let approvals = 0;
  for (const tx of txs) {
    const isOut = tx.from.hash.toLowerCase() === lower;
    const eth = weiToEth(tx.value);
    if (isOut) ethOut += eth;
    else ethIn += eth;
    const cpName = (isOut ? tx.to?.name : tx.from.name) ?? "";
    if (CEX_RE.test(cpName)) {
      if (isOut) cexDeposits++;
      else cexWithdrawals++;
    }
    const m = (tx.method ?? "").toLowerCase();
    if (isOut && (m === "approve" || m === "setapprovalforall")) approvals++;
  }

  const net = ethIn - ethOut;
  if (txs.length >= 5 && Math.abs(net) >= 0.01) {
    take.push(
      net > 0
        ? `Accumulating: over the last ${txs.length} transactions, ${net.toLocaleString("en-US", { maximumFractionDigits: 2 })} more ETH came in than went out.`
        : `Distributing: over the last ${txs.length} transactions, ${(-net).toLocaleString("en-US", { maximumFractionDigits: 2 })} more ETH went out than came in.`
    );
  }

  if (cexDeposits > cexWithdrawals && cexDeposits > 0) {
    take.push(`${cexDeposits} recent transfer${cexDeposits > 1 ? "s" : ""} TO exchanges — moving funds where they can be sold. Traders read this as potential sell pressure.`);
  } else if (cexWithdrawals > 0) {
    take.push(`${cexWithdrawals} recent withdrawal${cexWithdrawals > 1 ? "s" : ""} FROM exchanges into self-custody — typically a long-term holding signal.`);
  }

  if (approvals >= 2) {
    take.push(`${approvals} recent token approvals — active trading behavior. Pros periodically revoke unused permissions (e.g. revoke.cash) to reduce hack risk.`);
  }

  const spam = holdings.filter((h) => h.likelySpam).length;
  if (spam > 0) {
    take.push(`${spam} token${spam > 1 ? "s" : ""} look like spam airdrops (no real market price). Experts ignore these — interacting with them can drain a wallet.`);
  }

  return take;
}

/** Map raw contract method names to language a non-crypto user understands. */
function describeTx(tx: BlockscoutTx, wallet: string): ActivityItem {
  const isOut = tx.from.hash.toLowerCase() === wallet.toLowerCase();
  const isIn = tx.to?.hash.toLowerCase() === wallet.toLowerCase();
  const direction: ActivityItem["direction"] = isOut && isIn ? "self" : isOut ? "out" : "in";
  const eth = weiToEth(tx.value);
  const ethStr =
    eth >= 0.0001
      ? `${eth.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`
      : "a small amount of ETH";
  const counterparty = tx.to?.name || null;
  const method = (tx.method || "").toLowerCase();

  let label = "Contract interaction";
  let description = counterparty
    ? `Interacted with ${counterparty}`
    : "Interacted with a smart contract (an automated program on the blockchain)";

  if (!tx.method && eth > 0) {
    label = direction === "out" ? "Sent money" : "Received money";
    description =
      direction === "out"
        ? `Sent ${ethStr} to another wallet`
        : `Received ${ethStr} from another wallet`;
  } else if (method === "transfer" || method === "transferfrom") {
    label = "Token transfer";
    description = direction === "out" ? "Sent tokens to another wallet" : "Received tokens";
  } else if (method === "approve" || method === "setapprovalforall") {
    label = "Gave permission";
    description = `Allowed an app${counterparty ? ` (${counterparty})` : ""} to move tokens on this wallet's behalf — common before trading`;
  } else if (method.includes("swap")) {
    label = "Token swap";
    description = `Exchanged one token for another${counterparty ? ` on ${counterparty}` : ""}`;
  } else if (method.includes("deposit") || method.includes("stake")) {
    label = "Deposit / stake";
    description = `Put funds into an app${counterparty ? ` (${counterparty})` : ""} — usually to earn rewards`;
  } else if (method.includes("withdraw") || method.includes("unstake") || method.includes("claim")) {
    label = "Withdrawal / claim";
    description = `Took funds or rewards out of an app${counterparty ? ` (${counterparty})` : ""}`;
  } else if (method.includes("mint")) {
    label = "Mint";
    description = "Created a new token or NFT (often buying a collectible at launch)";
  }

  if (tx.status !== "ok") {
    label = "Failed transaction";
    description = "This attempt didn't go through — the network fee was still paid";
  }

  return { hash: tx.hash, timestamp: tx.timestamp, label, description, direction };
}

function buildInsights(r: Omit<WalletReport, "headline" | "insights">): {
  headline: string;
  insights: string[];
} {
  const insights: string[] = [];
  const name = r.ensName ?? "This wallet";

  const balanceStr =
    r.balanceUsd !== null
      ? `about $${r.balanceUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      : `${r.ethBalance.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`;

  const headline = r.isContract
    ? `This address is a smart contract — an automated program, not a personal wallet.`
    : `${name} holds ${balanceStr} in ETH and has made ${r.txCount.toLocaleString("en-US")} transactions.`;

  // firstSeen only covers the most recent page of txs, so age is only reliable
  // when we've seen the wallet's full history.
  if (r.firstSeen) {
    const years = (Date.now() - new Date(r.firstSeen).getTime()) / (365.25 * 24 * 3600 * 1000);
    insights.push(
      years >= 1
        ? `Active on Ethereum for about ${years.toFixed(1)} years — an established wallet, not a throwaway.`
        : `First seen less than a year ago — a relatively new wallet.`
    );
  }

  if (r.lastSeen) {
    const days = (Date.now() - new Date(r.lastSeen).getTime()) / (24 * 3600 * 1000);
    if (days < 7) insights.push("Recently active — used within the last week.");
    else if (days > 180)
      insights.push(`Dormant — no activity for about ${Math.round(days / 30)} months.`);
  }

  if (r.gasSpentEth !== null && r.ethPriceUsd !== null && r.gasSpentEth * r.ethPriceUsd >= 1) {
    insights.push(
      `Recent transactions cost about $${(r.gasSpentEth * r.ethPriceUsd).toLocaleString("en-US", {
        maximumFractionDigits: 0,
      })} in network fees (the cost of using the blockchain).`
    );
  }

  const tokenValue = r.holdings.reduce((s, h) => s + (h.usdValue ?? 0), 0);
  if (r.holdings.length > 0) {
    insights.push(
      `Holds ${r.holdings.length} different token${r.holdings.length > 1 ? "s" : ""}` +
        (tokenValue > 0
          ? ` worth about $${tokenValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} on top of the ETH balance.`
          : ".")
    );
  }

  const swaps = r.recentActivity.filter((a) => a.label === "Token swap").length;
  const defi = r.recentActivity.filter((a) => a.label === "Deposit / stake").length;
  if (swaps >= 3) insights.push("Trades frequently — several recent token swaps.");
  if (defi >= 2) insights.push("Uses DeFi apps — deposits funds to earn rewards.");

  const failed = r.recentActivity.filter((a) => a.label === "Failed transaction").length;
  if (failed >= 3)
    insights.push(`${failed} recent transactions failed — possibly bot activity or fee misconfiguration.`);

  return { headline, insights };
}

export async function analyzeWallet(address: string): Promise<WalletReport | null> {
  const [info, counters, txPage, tokens] = await Promise.all([
    getJson<{
      coin_balance: string | null;
      exchange_rate: string | null;
      is_contract: boolean;
      proxy_type: string | null;
      ens_domain_name: string | null;
    }>(`${BLOCKSCOUT}/addresses/${address}`),
    getJson<{ transactions_count: string; gas_usage_count: string }>(
      `${BLOCKSCOUT}/addresses/${address}/counters`
    ),
    getJson<{ items: BlockscoutTx[] }>(`${BLOCKSCOUT}/addresses/${address}/transactions`),
    // Response can exceed Next's 2MB fetch-cache limit for busy wallets — skip caching.
    getJson<
      { token: { name: string; symbol: string; decimals: string | null; exchange_rate: string | null; type: string }; value: string }[]
    >(`${BLOCKSCOUT}/addresses/${address}/token-balances`, true),
  ]);

  if (!info) return null;

  const ethPriceUsd = info.exchange_rate ? Number(info.exchange_rate) : null;
  const ethBalance = info.coin_balance ? weiToEth(info.coin_balance) : 0;
  // Blockscout includes pending txs with empty timestamp/status — exclude them.
  const txs = (txPage?.items ?? []).filter((tx) => tx.timestamp && tx.status);
  const recentActivity = txs.slice(0, 12).map((tx) => describeTx(tx, address));

  const gasSpentEth = txs.length
    ? txs.reduce((s, tx) => s + (tx.fee ? weiToEth(tx.fee.value) : 0), 0)
    : null;

  const holdings: TokenHolding[] = (tokens ?? [])
    .filter((t) => t.token.type === "ERC-20" && t.token.symbol)
    .map((t) => {
      const decimals = Number(t.token.decimals ?? "18");
      const amount = Number(t.value) / 10 ** decimals;
      const rate = t.token.exchange_rate ? Number(t.token.exchange_rate) : null;
      return {
        name: t.token.name,
        symbol: t.token.symbol,
        amount,
        usdValue: rate !== null ? amount * rate : null,
        // Unpriced tokens showered in huge quantities are almost always airdrop spam.
        likelySpam: rate === null && amount >= 1_000,
      };
    })
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
    .slice(0, 10);

  const txCount = counters ? Number(counters.transactions_count) : txs.length;
  const lastSeen = txs[0]?.timestamp ?? null;
  // Only claim dormancy when we have a confirmed tx sample; very busy wallets can
  // have their first page flooded by pending txs.
  const daysSinceLast = lastSeen
    ? (Date.now() - new Date(lastSeen).getTime()) / (24 * 3600 * 1000)
    : null;

  const activityLevel: WalletReport["activityLevel"] =
    txCount === 0 || (daysSinceLast !== null && daysSinceLast > 180)
      ? "dormant"
      : txCount > 1000
        ? "power user"
        : txCount > 100
          ? "active"
          : "occasional";

  // EIP-7702 delegated EOAs report is_contract=true but are still personal wallets.
  const isContract = info.is_contract && info.proxy_type !== "eip7702";

  const balanceUsd = ethPriceUsd !== null ? ethBalance * ethPriceUsd : null;
  const portfolio = buildPortfolio(balanceUsd, holdings);
  const traderTake = buildTraderTake(txs, address, portfolio, holdings);

  const base = {
    address,
    ensName: info.ens_domain_name,
    isContract,
    ethBalance,
    ethPriceUsd,
    balanceUsd,
    txCount,
    gasSpentEth,
    firstSeen: txs.length && txCount <= txs.length ? txs[txs.length - 1].timestamp : null,
    lastSeen,
    activityLevel,
    portfolio,
    traderTake,
    holdings,
    recentActivity,
  };

  return { ...base, ...buildInsights(base) };
}
