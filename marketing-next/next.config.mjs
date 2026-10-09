/** Static export — the marketing site ships as plain files, same as today.
    trailingSlash gives every route a directory index.html so any static
    file server serves /game, /world etc. without rewrites. */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  devIndicators: false,
};

export default nextConfig;
