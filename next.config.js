/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    config.experiments = {
      asyncWebAssembly: true,
      topLevelAwait: true,
      layers: true,
    };

    // Add FFmpeg core path resolution
    config.resolve.alias['@ffmpeg/core'] = '@ffmpeg/core/dist/ffmpeg-core.js';

    return config;
  },
  // Ensure static files are correctly served
  transpilePackages: ['@ffmpeg/ffmpeg', '@ffmpeg/core'],
};

module.exports = nextConfig;
