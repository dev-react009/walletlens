import { NextRequest, NextResponse } from "next/server";
import { analyzeWallet, isAddress, resolveEns } from "@/lib/analyze";

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("address") ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "Provide a wallet address or ENS name." }, { status: 400 });
  }

  let address = raw;
  if (!isAddress(raw)) {
    if (!raw.includes(".")) {
      return NextResponse.json(
        { error: "That doesn't look like a wallet address (0x…) or ENS name (name.eth)." },
        { status: 400 }
      );
    }
    const resolved = await resolveEns(raw);
    if (!resolved) {
      return NextResponse.json({ error: `Couldn't find a wallet for "${raw}".` }, { status: 404 });
    }
    address = resolved;
  }

  const report = await analyzeWallet(address);
  if (!report) {
    return NextResponse.json(
      { error: "Couldn't load data for that wallet right now. Try again shortly." },
      { status: 502 }
    );
  }
  return NextResponse.json(report);
}
