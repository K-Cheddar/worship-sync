module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
    "^.+[\\\\/]context[\\\\/]controllerInfo(\\.tsx)?$":
      "<rootDir>/src/__mocks__/context/controllerInfo.tsx",
    "^.+[\\\\/]utils[\\\\/]environment(\\.ts)?$":
      "<rootDir>/src/__mocks__/utils/environment.ts",
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
      },
    ],
    "^.+\\.(js|jsx)$": "babel-jest",
  },
  transformIgnorePatterns: ["node_modules/(?!(gsap|@gsap|@cloudinary)/)"],
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
};
