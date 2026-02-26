/** @type {import('next').NextConfig} */
const nextConfig = {
    typescript: {
        ignoreBuildErrors: true,
    },
    // Required for the production Docker multi-stage build.
    // Produces .next/standalone — a self-contained server with minimal deps.
    output: process.env.NEXT_PUBLIC_ENV !== 'local' ? 'standalone' : undefined,
}

module.exports = nextConfig;
