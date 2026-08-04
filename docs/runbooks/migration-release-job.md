# Database migration release job (T-M02)
#
# Do NOT rely on multi-replica containers running `prisma migrate deploy` on start.
# Default docker-entrypoint verifies `prisma migrate status` only.
# Set RUN_MIGRATE_ON_START=true solely for disposable single-replica boots.
#
# Recommended staging/prod sequence:
# 1. Take a PITR-capable snapshot / confirm backup window.
# 2. Run once from a release job / one-off task:
#      cd backend/api && npx prisma migrate deploy
# 3. Confirm `npx prisma migrate status` shows up to date.
# 4. Roll application replicas (entrypoint will fail closed if migrations missing).
# 5. For destructive expand/contract migrations, rehearse rollback on staging first.
#
# CloudBase note: maxNum>1 makes start-time migrate unsafe — keep RUN_MIGRATE_ON_START=false.
