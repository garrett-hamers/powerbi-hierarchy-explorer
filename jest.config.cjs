module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/tests"],
  moduleFileExtensions: ["ts", "js"],
  moduleNameMapper: {
    "\\.less$": "<rootDir>/tests/style-stub.cjs"
  },
  collectCoverageFrom: ["src/**/*.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"]
};
