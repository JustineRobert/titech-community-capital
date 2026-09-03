# Payment Provider Architecture

## Design goal
Keep the platform provider-agnostic while allowing provider-specific adapters for MTN Uganda and future rails.

## Canonical contract
- initializePayment()
- getPaymentStatus()
- handleCallback()
- verifyCallback()
- normalizeProviderResponse()
- normalizeProviderError()
- reconcilePayment()
- reversePayment()

## Adapter layers
- Contribution workflow
- Payment orchestration
- Provider abstraction
- Provider-specific adapter
- Callback validation and processing
- Canonical financial posting

## Current status
The repository has an MTN callback adapter and payment service orchestration around the Golden Money Path. This is suitable as the reference implementation for a provider abstraction model while acknowledging that external provider credentials and live sandbox access remain required for production-grade validation.
