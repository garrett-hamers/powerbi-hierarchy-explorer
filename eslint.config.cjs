const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");
const powerBiPlugin = require("eslint-plugin-powerbi-visuals");

module.exports = [
  {
    ignores: ["dist/**", "node_modules/**", ".tmp/**"]
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        ecmaVersion: 2020,
        sourceType: "module"
      },
      globals: {
        document: "readonly",
        HTMLElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLLabelElement: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        SVGSVGElement: "readonly",
        console: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "powerbi-visuals": powerBiPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...powerBiPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "error"
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "powerbi-visuals/non-literal-fs-path": "off"
    }
  }
];
