import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Privy's optional peers we don't use (Solana, Farcaster mini-apps, smart accounts, Abstract).
    const unused = ["@farcaster/mini-app-solana", "@solana/kit", "@solana-program/system", "@solana-program/token", "@solana-program/memo", "@abstract-foundation/agw-client", "permissionless"];
    config.resolve.alias = { ...(config.resolve.alias ?? {}), "@": root, ...Object.fromEntries(unused.map((m) => [m, false])) };
    return config;
  },
};
export default nextConfig;
