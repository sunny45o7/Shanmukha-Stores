const { CircuitBreaker, CircuitBreakerOpenError, TimeoutError } = require("../utils/circuitBreaker");

async function runTests() {
  console.log("🧪 Testing Circuit Breaker & Retry Mechanism\n");
  const testBreaker = new CircuitBreaker({ name: 'TestAPI', failureThreshold: 2, cooldownPeriod: 3000 });

  let callCount = 0;
  const failingApiCall = async () => {
    callCount++;
    throw new Error("API Failure");
  };

  const timeoutApiCall = async () => {
    callCount++;
    await new Promise(r => setTimeout(r, 2000));
    return "Success after long wait";
  };

  const successfulApiCall = async () => {
    return "Success!";
  };

  try {
    console.log("--- Test 1: Immediate Failure with Retries ---");
    callCount = 0;
    await testBreaker.executeWithResilience(failingApiCall, { timeout: 1000, retries: 1, retryDelayMs: 100 });
  } catch (err) {
    console.log(`Expected Error caught: ${err.message}`);
    console.log(`Total API Calls made (including retries): ${callCount}`);
    if (callCount !== 2) throw new Error("Retry didn't work properly");
  }

  try {
    console.log("\n--- Test 2: Tripping the Circuit Breaker ---");
    callCount = 0;
    // Let's do another failure (failure 2) which should trip it, since threshold is 2.
    // Wait, the previous test threw an error which recorded 1 failure.
    // This one will do 0 retries and fail immediately, making it 2 failures.
    await testBreaker.executeWithResilience(failingApiCall, { timeout: 1000, retries: 0 });
  } catch (err) {
    console.log(`Expected Error caught: ${err.message}`);
  }

  console.log(`Circuit Breaker State: ${testBreaker.state}`);
  if (testBreaker.state !== 'OPEN') {
    throw new Error("Circuit breaker should be OPEN");
  }

  try {
    console.log("\n--- Test 3: Fast Failure when OPEN ---");
    await testBreaker.executeWithResilience(successfulApiCall, { timeout: 1000, retries: 0 });
    throw new Error("Should not reach here");
  } catch (err) {
    console.log(`Expected Error caught: ${err.name} - ${err.message}`);
    if (!(err instanceof CircuitBreakerOpenError) && err.name !== 'CircuitBreakerOpenError') {
      throw new Error("Should throw CircuitBreakerOpenError");
    }
  }

  console.log("\n--- Test 4: Timeout Handling ---");
  const timeoutBreaker = new CircuitBreaker({ name: 'TimeoutAPI', failureThreshold: 3 });
  try {
    await timeoutBreaker.executeWithResilience(timeoutApiCall, { timeout: 500, retries: 0 });
    throw new Error("Should not reach here");
  } catch (err) {
    console.log(`Expected Error caught: ${err.name} - ${err.message}`);
    if (!(err instanceof TimeoutError) && err.name !== 'TimeoutError') {
      throw new Error("Should throw TimeoutError");
    }
  }

  console.log("\n✅ All Circuit Breaker Tests Passed!");
}

runTests().catch(err => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
