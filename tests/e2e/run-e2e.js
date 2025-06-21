#!/usr/bin/env node

/**
 * E2E test runner for Video Speed Controller Chrome Extension
 * Usage: node tests/e2e/run-e2e.js [youtube|basic|all]
 */

import { pathToFileURL } from 'url';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if Puppeteer is available
let puppeteer;
try {
  puppeteer = await import('puppeteer');
} catch (error) {
  console.error('❌ Puppeteer not found. Install it with: npm install puppeteer');
  console.error('   Note: Puppeteer will download a Chrome binary (~170MB)');
  process.exit(1);
}

async function runE2ETests() {
  console.log('🎭 Video Speed Controller - E2E Test Runner\n');
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  // Determine which tests to run based on command line argument
  const testType = process.argv[2];
  let testFiles = [];
  
  if (testType === 'youtube') {
    testFiles = ['youtube.e2e.js'];
  } else if (testType === 'basic') {
    testFiles = ['basic.e2e.js'];
  } else if (testType === 'settings') {
    testFiles = ['settings-injection.e2e.js'];
  } else {
    // Run all tests
    testFiles = ['basic.e2e.js', 'youtube.e2e.js', 'settings-injection.e2e.js'];
  }
  
  console.log(`Running ${testFiles.length} E2E test suite(s)...\n`);
  
  for (const testFile of testFiles) {
    try {
      const testPath = join(__dirname, testFile);
      
      if (!existsSync(testPath)) {
        console.log(`   ⚠️  Test file not found: ${testFile}\n`);
        continue;
      }
      
      console.log(`🎭 Running ${testFile}...`);
      
      const testModule = await import(pathToFileURL(testPath).href);
      const testRunner = testModule.default || testModule.run;
      
      if (typeof testRunner === 'function') {
        const results = await testRunner();
        totalPassed += results.passed || 0;
        totalFailed += results.failed || 0;
        
        const status = (results.failed || 0) === 0 ? '✅' : '❌';
        console.log(`   ${status} ${results.passed || 0} passed, ${results.failed || 0} failed\n`);
      } else {
        console.log(`   ⚠️  No test runner found in ${testFile}\n`);
      }
    } catch (error) {
      console.log(`   💥 Error running ${testFile}:`);
      console.log(`      ${error.message}\n`);
      totalFailed++;
    }
  }
  
  console.log('📊 E2E Test Summary');
  console.log('===================');
  console.log(`Total Tests: ${totalPassed + totalFailed}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  
  if (totalPassed + totalFailed > 0) {
    const successRate = Math.round((totalPassed / (totalPassed + totalFailed)) * 100);
    console.log(`📈 Success Rate: ${successRate}%`);
  }
  
  if (totalFailed === 0) {
    console.log('\n🎉 All E2E tests passed!');
  } else {
    console.log('\n💥 Some E2E tests failed. Check the output above for details.');
  }
  
  process.exit(totalFailed > 0 ? 1 : 0);
}

runE2ETests().catch(error => {
  console.error('💥 E2E test runner failed:', error);
  process.exit(1);
});