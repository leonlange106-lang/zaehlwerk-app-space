import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright output. The HTML report ships bundled, minified vendor JS
    // (CodeMirror et al.) which ESLint would otherwise lint as project source —
    // thousands of warnings from code we neither wrote nor ship.
    "e2e/.report/**",
    "e2e/.test-results/**",
    "e2e/.data/**",
    "e2e/.auth/**",
  ]),
]);

export default eslintConfig;
