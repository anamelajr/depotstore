/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Affects next/image call sites only — the Shopify product photos are
    // plain <img> tags and are untouched by this. First hit on a given
    // derivative pays a slower AVIF encode; every hit after is cached.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
