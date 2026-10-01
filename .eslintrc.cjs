module.exports = {
  root: true,
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: { jsx: true },
    ecmaVersion: "latest",
    sourceType: "module",
    project: true,
  },
  plugins: [
    "@typescript-eslint",
    "react",
    "react-hooks",
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
  ],
  settings: {
    react: { version: "detect" },
  },
  rules: {
    // TypeScript - prevent build errors
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    
    // React
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off",
    
    // General - catch real issues
    "no-console": "warn",
    "no-constant-condition": "warn",
    "eqeqeq": ["error", "always"],
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-fallthrough": "error",
    "prefer-const": "error",
    
    // Relax style rules
    "indent": "off",
    "quotes": "off",
    "semi": "off",
    "comma-dangle": "off",
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    ".cache/",
    ".idea/",
    ".vscode/",
    "*.swp",
    "*.swo",
    ".DS_Store",
    "Thumbs.db",
    ".env",
    ".env.*",
    "*.log",
    "vite.config.ts",
  ],
};
