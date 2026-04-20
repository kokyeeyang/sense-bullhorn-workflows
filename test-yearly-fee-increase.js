#!/usr/bin/env node

/**
 * Test script for placement-yearly-fee-increase-sync with test mode enabled
 *
 * This script runs the yearly fee increase workflow in test mode, which uses
 * relaxed criteria to match existing contract placements for testing purposes.
 *
 * Usage:
 *   PLACEMENT_YEARLY_FEE_INCREASE_TEST_MODE=true node test-yearly-fee-increase.js
 */

require("dotenv").config();

const { run } = require("./src/placementYearlyFeeIncreaseSync");

async function main() {
  console.log("🧪 Running placement yearly fee increase sync in TEST MODE");
  console.log("📋 Test mode criteria: Contract employment type + Future end date only");
  console.log("📧 Use DRY_RUN=true to prevent actual email sending\n");

  try {
    const result = await run();
    console.log("\n✅ Test completed successfully!");
    console.log("📊 Results:", result.totals);
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}