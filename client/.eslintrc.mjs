module.exports = {
  parser: "@typescript-eslint/parser",
  extends: [
    "react-app",
    "react-app/jest",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
  ],
  plugins: ["react-hooks", "@typescript-eslint", "prettier"],
  rules: {
    "no-console": "off",
    "@typescript-eslint/no-unused-vars": "warn",
    "prefer-const": "warn",
    "no-duplicate-imports": "off",
    "prettier/prettier": [
      "warn",
      {
        trailingComma: "always",
        tabWidth: 2,
        semi: true,
        singleQuote: false,
        jsxSingleQuote: false,
      },
    ],
  },
};
