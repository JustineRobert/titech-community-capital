# Load Testing with Artillery

## Overview

This directory contains Artillery configuration for performance and load testing the Community Savings App API.

## Installation

```bash
npm install -g artillery
npm install --save-dev artillery
```

## Configuration

### Running Load Tests

#### Basic Test

```bash
artillery run artillery-config.js --target http://localhost:5000
```

#### Against Production

```bash
artillery run artillery-config.js --target https://api.production.com
```

#### With Custom Output

```bash
artillery run artillery-config.js --target http://localhost:5000 -o results.json
```

## Load Testing Phases

1. **Warm up (60s)**: 10 arrivals/sec - Initialize connections
2. **Ramp up (300s)**: Increase from 50 to 200 arrivals/sec
3. **Sustained (300s)**: 200 arrivals/sec - Main load test
4. **Cool down (60s)**: 10 arrivals/sec - Graceful shutdown

## Scenarios Included

1. **Authentication Flow** (Weight: 10%)
   - User registration
   - Login
   - Token validation

2. **Group Operations** (Weight: 15%)
   - Create groups
   - Retrieve group details
   - List all groups

3. **Contribution Flow** (Weight: 20%)
   - Submit contributions
   - Retrieve contribution details
   - List contributions with pagination

4. **Payment Processing** (Weight: 15%)
   - Initiate payments (M-Pesa, Stripe)
   - Confirm payments
   - Payment status tracking

5. **Loan Operations** (Weight: 15%)
   - Request loans
   - Retrieve loan details
   - Filter loans by status

6. **Chat Operations** (Weight: 10%)
   - Send messages
   - Retrieve chat history

7. **Dashboard & Analytics** (Weight: 15%)
   - Summary dashboard
   - Group analytics
   - User statistics

## Interpreting Results

### Key Metrics

- **Response Time**: How long requests take to complete
- **Rps (Requests per second)**: Throughput of the system
- **Errors**: Failed requests
- **p95/p99**: 95th and 99th percentile response times

### Report Example

```
All done. Summary report:
  Scenarios launched:  2000
  Scenarios completed: 1850
  Requests completed:  18500
  RPS sent: 185
  Request latency:
    min: 10
    max: 5032
    mean: 312
    median: 285
    p95: 850
    p99: 1200
  Codes:
    200: 18200
    400: 200
    500: 100
```

## Performance Targets

| Endpoint         | Target Response Time | Target RPS |
| ---------------- | -------------------- | ---------- |
| Authentication   | < 500ms              | 100        |
| Group Operations | < 300ms              | 200        |
| Contributions    | < 400ms              | 150        |
| Payments         | < 1000ms             | 50         |
| Loans            | < 400ms              | 150        |
| Chat             | < 300ms              | 200        |
| Analytics        | < 2000ms             | 50         |

## Best Practices

1. **Test Against Consistent Environment**
   - Use staging environment for testing
   - Ensure consistent data state before each test

2. **Monitor System Resources**
   - CPU usage should not exceed 80%
   - Memory usage should remain stable
   - Database connections should not max out

3. **Gradual Load Increase**
   - Start with warm-up phase
   - Gradually ramp up to full load
   - Maintain sustained load for minimum 5 minutes

4. **Multiple Test Runs**
   - Run tests multiple times
   - Compare results
   - Identify anomalies

5. **Real-World Scenarios**
   - Use realistic data
   - Mix different user behaviors
   - Include think time between actions

## Environment Variables

Create a `.env.load-test` file:

```env
TARGET_URL=http://localhost:5000
BASE_URL=http://localhost:5000
ARTILLERY_LOG_LEVEL=info
```

## Troubleshooting

### High Error Rates

- Check server logs for errors
- Verify database connectivity
- Check rate limiting settings
- Verify authentication token generation

### Slow Response Times

- Check server resources (CPU, memory)
- Analyze database queries
- Check network latency
- Review load balancer configuration

### Connection Timeouts

- Increase connection timeout
- Check firewall rules
- Verify server availability
- Check load balancer health

## Advanced Configuration

### Custom Hooks

Edit `artillery-processor.js` to add:

- Pre-request modifications
- Response validation
- Custom metrics
- Error handling

### Using Plugins

Add to config:

```javascript
plugins: {
  expect: {},
  'statsd': {
    host: 'localhost',
    port: 8125
  }
}
```

## Continuous Load Testing

Run automated load tests:

```bash
#!/bin/bash
# run-load-tests.sh

for i in {1..5}; do
  echo "Run $i..."
  artillery run artillery-config.js \
    --target http://localhost:5000 \
    -o "results-run-$i.json"
done
```

## Integration with CI/CD

Add to GitHub Actions/GitLab CI:

```yaml
- name: Run Load Tests
  run: |
    npm install -g artillery
    artillery run artillery-config.js \
      --target ${{ secrets.STAGING_URL }} \
      -o results.json

- name: Check Results
  run: |
    node check-load-test-results.js results.json
```

## Reporting

Generate HTML report:

```bash
artillery report results.json
```

## References

- [Artillery Documentation](https://artillery.io/docs)
- [Load Testing Best Practices](https://artillerylabs.io/docs/guides/load-testing)
- [Performance Optimization](https://developer.mozilla.org/en-US/docs/Web/Performance)
