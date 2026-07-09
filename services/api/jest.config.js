module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  transformIgnorePatterns: ["/node_modules/(?!jose)"],
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  testEnvironment: "node"
};
