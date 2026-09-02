# Retry Metrics


Prometheus metrics:



retry_attempt_total

retry_success_total

retry_failure_total

retry_retry_total

retry_timeout_total

retry_cancelled_total

retry_budget_exhausted_total

retry_delay_duration

retry_execution_duration



## Alert Examples


High failures:



retry_failure_total > threshold



Provider outage:



payment retry failures increasing