"use client";

import dynamic from "next/dynamic";

const TradePage = dynamic(() => import("./TradeContent"), { ssr: false });

export default function TradeRoute() {
  return <TradePage />;
}
