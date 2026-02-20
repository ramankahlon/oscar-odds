import js from "@eslint/js";
import globals from "globals";

export default [
  // Ignore generated and dependency directories
  {
    ignores: ["coverage/", "node_modules/"]
  },

  // Base recommended rules for all JS files
  js.configs.recommended,

  // Node.js server and utility files
  {
    files: ["server.mjs", "scraper-utils.js", "forecast-utils.js", "scoring-utils.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Browser app
  {
    files: ["app.js"],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },

  // Vitest test files — expose describe/it/expect globals
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly"
      }
    }
  },

  // Project-wide rule overrides
  {
    rules: {
      // Allow unused catch bindings and underscore-prefixed params
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      // console is intentional in a server/CLI project
      "no-console": "off"
    }
  }
];
