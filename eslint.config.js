import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import security from "eslint-plugin-security";
import prettierRecommended from "eslint-plugin-prettier/recommended";

// Adapted from mulmoterminal's eslint.config.js.
//
// Take a preset at its word about WHICH rules to run, and overrule it on how much they matter: a
// warning does not fail CI, so a rule left at warn is a rule that reports a violation and ships it.
// Written as a transform rather than a list of rule names, so a preset that adds a warn-level rule
// in a future release arrives already enforced. Severity only — the preset's own options are kept,
// and a rule it ships as `off` stays off. A rule that genuinely must not fail the build is turned
// off, by name, with the reason, in one of the blocks below.
const raise = (entry) => {
  const severity = Array.isArray(entry) ? entry[0] : entry;
  if (severity !== 1 && severity !== "warn") return entry;
  return Array.isArray(entry) ? ["error", ...entry.slice(1)] : "error";
};

const enforced = (config) =>
  config.rules ? { ...config, rules: Object.fromEntries(Object.entries(config.rules).map(([id, entry]) => [id, raise(entry)])) } : config;

export default [
  { ignores: ["dist/", "node_modules/", "out/"] },
  {
    // A disable comment that no longer suppresses anything names a reason that has stopped being
    // true. At error the comment has to be removed when it goes stale.
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  enforced(js.configs.recommended),
  ...tseslint.configs.strict.map(enforced),
  enforced(sonarjs.configs.recommended),
  enforced(security.configs.recommended),
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Size and complexity guards, all errors. max-lines is per FILE: the per-function guards can
    // all pass while a file grows without bound.
    rules: {
      "max-lines": ["error", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true, IIFEs: true }],
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["error", 6],
      "max-nested-callbacks": ["error", 4],
    },
  },
  {
    // `const { secret, ...rest } = obj` drops a field by construction; the named sibling is the point.
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // No `as` casts: a cast asserts a type the compiler could not prove, and the difference shows
    // up at runtime on the data we least control (provider responses, JSON files, the render page).
    // Narrow with a type guard instead. Tests are exempt below.
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  {
    // Type-aware rules on shipped code. They catch what no syntactic rule can: a missing `await`
    // that makes a rejection vanish, an async callback handed to an API that ignores the promise,
    // and an `any` arriving from outside — JSON.parse, Response.json(), page.evaluate() — that then
    // type-checks against every use it reaches.
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "sonarjs/different-types-comparison": "error",
      "sonarjs/no-alphabetical-sort": "error",
      "sonarjs/no-misleading-array-reverse": "error",
      "sonarjs/deprecation": "error",
    },
  },
  {
    // Tests build values the types forbid on purpose (a malformed payload to prove it is rejected),
    // and the outermost describe() holds the whole file, so a per-function limit measures the file.
    // The per-FILE limit still applies.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "max-lines-per-function": "off",
    },
  },
  {
    // These run tools the user installs and that are found on PATH by design — ffmpeg to encode
    // the video, git and npx to build — which have no portable absolute path.
    files: ["src/render.ts", "scripts/build.ts"],
    rules: {
      "sonarjs/no-os-command-from-path": "off",
    },
  },
  {
    // eslint-plugin-security tuning (as in mulmoterminal): these fire on intentional patterns here —
    // fs paths built from the user's own arguments, `obj[key]` lookups in tables, and regexps.
    rules: {
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-object-injection": "off",
      "security/detect-non-literal-regexp": "off",
    },
  },
  prettierRecommended,
];
