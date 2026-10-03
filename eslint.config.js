// ESLint flat config (ESLint 10).
//
// Two environments share this repo: Node.js server modules (root *.js,
// test/, electron/) and plain-script browser code (public/*.js, no build
// step / no ESM). Each gets its own languageOptions block; the "no build
// step, minimal deps" philosophy extends here too — nothing beyond ESLint
// itself and the standard recommended ruleset.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'data/**',
      'mobile/**', // separate Flutter project with its own tooling
      'mobile-rn/**', // separate React Native project with its own tooling
      'python_app/**', // separate Python app (vendored venv JS is not ours)
      'scratchpad/**', // throwaway debug/demo scripts
      'public/fonts/**',
      'marketing/**', // plain-script browser game/site code, no build step (verified via node --check)
      '.pixis/**', // agent scratch space and one-off scripts
      'unity/**', // Unity C# project; JS here is vendored tooling
    ],
  },
  js.configs.recommended,
  {
    // Node-side code: Express server modules, tests, Electron shell.
    files: ['*.js', 'test/**/*.js', 'electron/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // Unused catch variables are common in this codebase's
      // deliberately-ignored error paths (see the "ignore" comments in
      // server.js); allow them but keep everything else strict.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // Browser code: plain <script> files, no modules.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: globals.browser,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // chat-helpers.js is browser code, but it carries a CommonJS export
    // guard so the Node test suite can require the very same file — hence
    // the `module` global on top of the browser set.
    files: ['public/chat-helpers.js'],
    languageOptions: {
      globals: { ...globals.browser, module: 'readonly' },
    },
  },
];
