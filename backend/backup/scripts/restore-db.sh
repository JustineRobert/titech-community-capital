#!/usr/bin/env bash

# =============================================================================
# TITech Community Capital LTD
# File: backend/backup/scripts/restore-db.sh
# Enterprise Database Restore Script
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

LOG_DIR="${BACKUP_ROOT:-/opt/backups}/logs"

LOG_FILE="${LOG_DIR}/restore-${TIMESTAMP}.log"

BACKUP_PATH="${1:-}"

DRY_RUN="${DRY_RUN:-false}"

FORCE_RESTORE="${FORCE_RESTORE:-false}"

MONGO_URI="${MONGO_URI:-}"

POSTGRES_HOST="${POSTGRES_HOST:-}"

POSTGRES_PORT="${POSTGRES_PORT:-5432}"

POSTGRES_DB="${POSTGRES_DB:-}"

POSTGRES_USER="${POSTGRES_USER:-}"

mkdir -p "${LOG_DIR}"

# =============================================================================
# Logging
# =============================================================================

log() {

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" \
        | tee -a "${LOG_FILE}"
}

# =============================================================================
# Validation
# =============================================================================

validate_restore_request() {

    if [[ -z "${BACKUP_PATH}" ]]; then

        log "ERROR: Backup path required"

        echo ""
        echo "Usage:"
        echo "  ./restore-db.sh /path/to/backup"
        echo ""

        exit 1
    fi

    if [[ ! -d "${BACKUP_PATH}" ]]; then

        log "ERROR: Backup path does not exist"

        exit 1
    fi
}

validate_tools() {

    command -v sha256sum >/dev/null || {

        log "sha256sum missing"

        exit 1
    }

    command -v tar >/dev/null || {

        log "tar missing"

        exit 1
    }
}

# =============================================================================
# Verify Integrity
# =============================================================================

verify_checksums() {

    if [[ ! -f "${BACKUP_PATH}/checksums.sha256" ]]; then

        log "Checksum file missing"

        return
    fi

    log "Validating SHA256 checksums"

    (
        cd "${BACKUP_PATH}"

        sha256sum -c checksums.sha256
    )

    log "Checksum validation successful"
}

# =============================================================================
# Confirmation
# =============================================================================

confirm_restore() {

    if [[ "${FORCE_RESTORE}" == "true" ]]; then

        return
    fi

    echo ""
    echo "=================================================="
    echo "WARNING"
    echo "This operation may overwrite existing databases."
    echo "=================================================="
    echo ""

    read -r -p \
        "Type RESTORE to continue: " \
        CONFIRM

    if [[ "${CONFIRM}" != "RESTORE" ]]; then

        log "Restore cancelled"

        exit 1
    fi
}

# =============================================================================
# Extract Archives
# =============================================================================

extract_archives() {

    log "Extracting backup archives"

    if [[ -f "${BACKUP_PATH}/mongodb.tar.gz" ]]; then

        tar -xzf \
            "${BACKUP_PATH}/mongodb.tar.gz" \
            -C "${BACKUP_PATH}"
    fi
}

# =============================================================================
# MongoDB Restore
# =============================================================================

restore_mongodb() {

    if [[ -z "${MONGO_URI}" ]]; then

        log "MongoDB restore skipped"

        return
    fi

    if [[ ! -d "${BACKUP_PATH}/mongodb" ]]; then

        log "MongoDB dump not found"

        return
    fi

    if [[ "${DRY_RUN}" == "true" ]]; then

        log "MongoDB restore DRY RUN"

        return
    fi

    log "Starting MongoDB restore"

    mongorestore \
        --uri="${MONGO_URI}" \
        --drop \
        "${BACKUP_PATH}/mongodb"

    log "MongoDB restore completed"
}

# =============================================================================
# PostgreSQL Restore
# =============================================================================

restore_postgres() {

    local FILE

    FILE="${BACKUP_PATH}/postgres.sql.gz"

    if [[ ! -f "${FILE}" ]]; then

        log "PostgreSQL backup not found"

        return
    fi

    if [[ "${DRY_RUN}" == "true" ]]; then

        log "PostgreSQL restore DRY RUN"

        return
    fi

    export PGPASSWORD="${POSTGRES_PASSWORD:-}"

    log "Starting PostgreSQL restore"

    gunzip -c "${FILE}" | psql \
        -h "${POSTGRES_HOST}" \
        -p "${POSTGRES_PORT}" \
        -U "${POSTGRES_USER}" \
        "${POSTGRES_DB}"

    log "PostgreSQL restore completed"
}

# =============================================================================
# Validation
# =============================================================================

post_restore_validation() {

    log "Running post-restore validation"

    if [[ -n "${MONGO_URI}" ]]; then

        mongosh "${MONGO_URI}" \
            --eval "db.adminCommand('ping')"
    fi

    log "Database validation successful"
}

# =============================================================================
# Audit Log
# =============================================================================

write_audit_log() {

    local AUDIT_FILE

    AUDIT_FILE="${BACKUP_PATH}/restore-audit.json"

    cat > "${AUDIT_FILE}" << EOF
{
  "timestamp": "$(date --iso-8601=seconds)",
  "performedBy": "${USER}",
  "backupPath": "${BACKUP_PATH}",
  "host": "$(hostname)",
  "dryRun": "${DRY_RUN}",
  "status": "COMPLETED"
}
EOF
}

# =============================================================================
# S3 Download Support
# =============================================================================

download_from_s3() {

    if [[ "${BACKUP_PATH}" != s3://* ]]; then

        return
    fi

    command -v aws >/dev/null || {

        log "AWS CLI not found"

        exit 1
    }

    TEMP_DIR="/tmp/titech-restore"

    mkdir -p "${TEMP_DIR}"

    log "Downloading backup from S3"

    aws s3 cp \
        "${BACKUP_PATH}" \
        "${TEMP_DIR}" \
        --recursive

    BACKUP_PATH="${TEMP_DIR}"
}

# =============================================================================
# Azure Download Support
# =============================================================================

download_from_azure() {

    if [[ "${BACKUP_PATH}" != https://* ]]; then

        return
    fi

    if ! command -v azcopy >/dev/null; then

        log "AzCopy missing"

        exit 1
    fi

    TEMP_DIR="/tmp/titech-restore"

    mkdir -p "${TEMP_DIR}"

    log "Downloading backup from Azure"

    azcopy copy \
        "${BACKUP_PATH}" \
        "${TEMP_DIR}" \
        --recursive

    BACKUP_PATH="${TEMP_DIR}"
}

# =============================================================================
# Main
# =============================================================================

main() {

    log "================================================="
    log "Enterprise Database Restore Started"
    log "================================================="

    validate_restore_request

    validate_tools

    download_from_s3

    download_from_azure

    verify_checksums

    confirm_restore

    extract_archives

    restore_mongodb

    restore_postgres

    post_restore_validation

    write_audit_log

    log "================================================="
    log "Restore completed successfully"
    log "================================================="
}

main "$@"