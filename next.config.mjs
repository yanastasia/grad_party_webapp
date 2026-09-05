const nextConfig = {
  outputFileTracingIncludes: {
    '/api/party': [
      './node_modules/@fontsource/allura/files/**/*',
      './node_modules/@fontsource/cormorant-garamond/files/**/*',
    ],
  },
};

export default nextConfig;
