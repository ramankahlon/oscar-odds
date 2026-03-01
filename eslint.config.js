import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignore generated and dependency directories
  {
    ignores: ["coverage/", "node_modules/", "app.js", "wasm/"]
  },

  // Base recommended rules for all files
  js.configs.recommended,

  // TypeScript recommended rules for all TS files
  ...tseslint.configs.recommended,

  // Node.js server and utility files
  {
    files: ["server.ts", "scraper-utils.ts", "forecast-utils.ts", "scoring-utils.ts", "app-logic.ts", "types.ts", "scripts/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Browser app
  {
    files: ["app.ts"],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },

  // Service worker — runs in a restricted worker scope, not the browser window
  {
    files: ["sw.js"],
    languageOptions: {
      globals: { ...globals.serviceworker }
    }
  },

  // Vitest test files — expose describe/it/expect globals
  {
    files: ["**/*.test.ts"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },

  // Project-wide rule overrides
  {
    rules: {
      // TypeScript handles unused vars; configure via @typescript-eslint rule
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      // Allow explicit any where intentional
      "@typescript-eslint/no-explicit-any": "off",
      // Allow namespace inside declare global {} blocks (needed for Express type augmentation)
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      // console is intentional in a server/CLI project
      "no-console": "off"
    }
  }
);
