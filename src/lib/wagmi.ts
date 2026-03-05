import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { bsc } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "Datalayer Market",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "datalayer-market-fallback",
  chains: [bsc],
  ssr: true,
});
