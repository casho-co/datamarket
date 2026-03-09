import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "openai",
  ],
};

export default nextConfig;
