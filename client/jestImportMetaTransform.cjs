/**
 * After ts-jest compiles TS, rewrite Vite's import.meta.env for Node without running
 * babel-jest (which re-parses tests and breaks jest.mock() hoisting on compiled output).
 */
const { transformSync } = require("@babel/core");
const tsJest = require("ts-jest").default;

const tsJestTransformer = tsJest.createTransformer({
  // ts-jest defaults pair CommonJS with deprecated node10; keep bundler resolution (TS 6+).
  tsconfig: "tsconfig.jest.json",
});

module.exports = {
  process(sourceText, sourcePath, options) {
    const result = tsJestTransformer.process(sourceText, sourcePath, options);
    if (!result || result.code == null) {
      return result;
    }
    const out = transformSync(result.code, {
      filename: sourcePath,
      babelrc: false,
      configFile: false,
      presets: [],
      plugins: ["babel-plugin-transform-vite-meta-env"],
    });
    return { ...result, code: out.code };
  },
};
