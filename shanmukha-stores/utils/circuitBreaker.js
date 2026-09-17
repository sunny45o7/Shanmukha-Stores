class CircuitBreakerOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

class CircuitBreaker {
  constructor(options = {}) {
    this.state = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF_OPEN'
    this.failureCount = 0;
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownPeriod = options.cooldownPeriod || 60000; // 60 seconds
    this.lastFailureTime = null;
    this.name = options.name || 'CircuitBreaker';
  }

  async executeWithResilience(fn, options = {}) {
    const { timeout = 5000, retries = 1, retryDelayMs = 1000 } = options;

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.cooldownPeriod) {
        this.state = 'HALF_OPEN';
      } else {
        throw new CircuitBreakerOpenError(`[${this.name}] Circuit breaker is OPEN. Service is temporarily unavailable.`);
      }
    }

    let attempt = 0;
    let lastError = null;

    while (attempt <= retries) {
      try {
        const result = await this.runWithTimeout(fn, timeout);
        
        // Success
        this.reset();
        return result;
      } catch (error) {
        lastError = error;
        attempt++;
        
        if (attempt <= retries) {
           console.log(`[${this.name}] Attempt ${attempt} failed. Retrying in ${retryDelayMs}ms... Error: ${error.message}`);
           await new Promise(res => setTimeout(res, retryDelayMs));
        }
      }
    }

    this.recordFailure();
    throw lastError;
  }

  runWithTimeout(fn, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(`[${this.name}] Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn().then(result => {
        clearTimeout(timer);
        resolve(result);
      }).catch(err => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  recordFailure() {
    this.failureCount++;
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastFailureTime = Date.now();
      console.warn(`[${this.name}] Circuit TRIPPED! Opened for ${this.cooldownPeriod / 1000} seconds.`);
    }
  }

  reset() {
    if (this.state !== 'CLOSED') {
      console.log(`[${this.name}] Circuit CLOSED. Service recovered.`);
    }
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
}

// Singletons for global state tracking
const paymentCircuitBreaker = new CircuitBreaker({ name: 'PaymentAPI', failureThreshold: 3, cooldownPeriod: 30000 });
const mailerCircuitBreaker = new CircuitBreaker({ name: 'MailerAPI', failureThreshold: 5, cooldownPeriod: 60000 });

module.exports = {
  CircuitBreakerOpenError,
  TimeoutError,
  CircuitBreaker,
  paymentCircuitBreaker,
  mailerCircuitBreaker
};
