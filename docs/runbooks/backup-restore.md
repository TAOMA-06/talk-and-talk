# Backup / restore runbook template (T-C05)
#
# Status: repository template only — production HA/PITR drill evidence still required.
#
# Targets
# - RPO ≤ 15 minutes (PITR or continuous WAL archiving)
# - RTO ≤ 1 hour (restore + smoke validation)
#
# Checklist
# - [ ] Managed PostgreSQL HA + PITR enabled (provider console screenshot)
# - [ ] Redis durability / failover posture documented (or accepted risk + write throttling)
# - [ ] Staging restore drill date: ____
# - [ ] Restored point-in-time: ____
# - [ ] Restore duration: ____
# - [ ] Validation queries (orders / payments / refunds sample) attached
# - [ ] On-call notified via alert injection (see infra/observability/alertmanager-payment-rules.sample.yml)
#
# Until the above are evidenced, commercial Go remains blocked on ops reliability.
