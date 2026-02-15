/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next < 15: use this key (renamed to serverExternalPackages in v15). [web:492]
    serverComponentsExternalPackages: ["ws"],
  },
};

module.exports = nextConfig;
