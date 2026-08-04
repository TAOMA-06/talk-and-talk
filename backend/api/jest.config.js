module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  transformIgnorePatterns: ["/node_modules/(?!jose)"],
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageThreshold: {
    global: {
      statements: 35,
      branches: 25,
      functions: 30,
      lines: 35
    },
    "./src/payments/": {
      statements: 40,
      lines: 40
    },
    "./src/orders/": {
      statements: 35,
      lines: 35
    },
    "./src/users/": {
      statements: 30,
      lines: 30
    },
    "./src/review/": {
      statements: 30,
      lines: 30
    }
  },
  testEnvironment: "node"
};
