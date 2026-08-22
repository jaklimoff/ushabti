import next from "eslint-config-next/core-web-vitals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import playwright from "eslint-plugin-playwright";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "design-reference/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },

  ...next,
  ...tseslint.configs.recommended,

  {
    rules: {
      // An unused name is a mistake, unless it starts with an underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // The whole product depends on values whose shape the property type
      // decides at run time. `unknown` is the honest type; `any` is not.
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],

      // Two rules that arrived with eslint-config-next 16, kept as advice
      // rather than as a gate:
      //
      // `refs` reads dnd-kit's useSortable() result as if it were a ref
      // object, so every board component reports a false positive.
      //
      // `set-state-in-effect` catches a real pattern of ours: a panel field
      // that resets when the task changes. The React way out is to key the
      // component instead. That is a refactor with its own risk, so it is on
      // the roadmap, not in this release.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  {
    files: ["e2e/**/*.ts"],
    ...playwright.configs["flat/recommended"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      // A drag has an animation. The suite must let it finish before it looks
      // at the result, and there is no event that says "the card stopped".
      "playwright/no-wait-for-timeout": "off",
      "playwright/no-conditional-in-test": "off",
    },
  },

  {
    files: ["src/db/seed.ts", "scripts/**/*.mjs", "examples/**/*.mjs", "e2e/**/*.ts"],
    rules: { "no-console": "off" },
  },

  // Formatting belongs to Prettier. This must stay last.
  prettier,
);
