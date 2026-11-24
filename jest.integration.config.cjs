// Integration tests that talk to a REAL Azure DevOps Server (self-hosted). Run with `npm run test:selfhosted`.
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test/integration"],
  testMatch: ["**/*.integration.ts"],
  testTimeout: 60000,
  collectCoverage: false,
  transform: { "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }] },
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
};
