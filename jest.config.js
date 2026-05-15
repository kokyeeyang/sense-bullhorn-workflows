/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.js"],
  modulePathIgnorePatterns: ["<rootDir>/frontend-dashboard/.next"],
  watchPathIgnorePatterns: ["<rootDir>/frontend-dashboard/.next", "<rootDir>/frontend-dashboard/node_modules"],
  clearMocks: true,
};
