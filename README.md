# WalletLens

Web3 analytics for people who aren't blockchain experts. Paste an Ethereum address or ENS
name and get a plain-English report: what the wallet holds, how active it is, and what its
recent transactions actually mean.

## MVP scope

- Wallet lookup by address (`0x…`) or ENS name (`name.eth`)
- Headline summary + auto-generated insights (age, activity level, fees spent, habits)
- Token holdings with USD values
- Recent activity feed translated to plain English (swaps, staking, approvals, mints…)

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4
- Data: Blockscout public API (Ethereum mainnet) + ensdata.net for ENS — **no API keys needed**
- All chain calls are server-side (`app/api/analyze`), responses cached 60s

## Run

```
pnpm install
pnpm dev
```

## Scaling path (post-funding)

- Multi-chain support (Base, Arbitrum, Polygon via per-chain Blockscout instances)
- Dedicated indexer / paid RPC for rate limits and historical depth beyond recent txs
- LLM-generated narrative summaries layered on top of the rule-based engine
- Saved wallets, alerts, and portfolio tracking (auth + database)
