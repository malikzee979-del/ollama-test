/** Static export — the marketing site ships as plain files, same as today.
    trailingSlash gives every route a directory index.html so any static
    file server serves /game, /world etc. without rewrites. */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  devIndicators: false,
  // Two lockfiles exist (root project + this app); Turbopack was inferring the
  // parent dir as workspace root, which mis-resolves React in build workers
  // ("useContext of null" while prerendering /_global-error and /_not-found).
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
