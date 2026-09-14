import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  assetPrefix: process.env.GITHUB_ACTIONS ? 'https://blarphus.github.io/whisperbook-reader' : '',
};

export default nextConfig;
