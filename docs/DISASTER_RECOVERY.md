# TITech Disaster Recovery Plan

## 1. Objectives
- Ensure business continuity
- Protect financial data
- Maintain regulatory compliance

## 2. RTO / RPO
- RTO: 15 minutes
- RPO: 5 minutes

## 3. Failover Strategy
- Active-Passive regions
- Route53 auto failover

## 4. Backup Strategy
- MongoDB snapshots (hourly)
- S3 backups (daily)
- Redis persistence (AOF)

## 5. Recovery Steps
1. Detect failure (monitoring alert)
2. Switch traffic to DR region
3. Validate database sync
4. Restart services
5. Notify stakeholders

## 6. Testing
- Quarterly failover testing
- Chaos engineering simulation