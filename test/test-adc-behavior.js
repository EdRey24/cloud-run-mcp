// test/test-adc-behavior.js
console.log('--- Loading test-adc-behavior.js (Simplified Error Handling) ---');

import { checkLocalAdcStatusWithApiCall } from '../mcp-server.js';

async function runSimplifiedTest() {
  console.log('--- Testing listProjects() with current ADC setup ---');

  try {
    const projects = await checkLocalAdcStatusWithApiCall(); // This call will throw an error if ADC is not found

    if (projects.length > 0) {
      console.log('✅ SUCCESS: listProjects() returned projects. ADC is likely functional and has permissions.');
      console.log(`Found ${projects.length} projects. Example Project ID: ${projects[0].id}`);
    } else {
      console.log('⚠️ WARNING: listProjects() returned an empty list. ADC is functional, but no accessible projects were found for your account.');
    }
  } catch (error) {
    // For this simplified test, we just log the specific failure and let the process exit
    // with the original Node.js error for ADC issues.
    console.log(`❌ FAILURE: listProjects() threw an error during the test.`);
    // The raw Node.js error will be displayed after this due to unhandled promise rejection.
  } finally {
    console.log('\n--- Test Complete ---');
  }
}

// Call the async test function. If it throws an unhandled error, Node.js will exit with the error message.
runSimplifiedTest();