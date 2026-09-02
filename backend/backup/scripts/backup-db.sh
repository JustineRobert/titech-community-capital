#!/usr/bin/env bash

# =============================================================================
# TITech Community Capital LTD
# File: backend/backup/scripts/backup-db.sh
# Enterprise Database Backup Script
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

APP_NAME="titech-community-capital"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups}"

BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

LOG_DIR="${BACKUP_ROOT}/logs"

LOG_FILE="${LOG_DIR}/backup-${TIMESTAMP}.log"

RETENTION_DAYS="${RETENTION_DAYS:-30}"

MONGO_URI="${MONGO_URI:-}"

POSTGRES_HOST="${POSTGRES_HOST:-}"

POSTGRES_PORT="${POSTGRES_PORT:-5432}"

POSTGRES_DB="${POSTGRES_DB:-}"

POSTGRES_USER="${POSTGRES_USER:-}"

S3_BUCKET="${S3_BUCKET:-}"

AZURE_CONTAINER="${AZURE_CONTAINER:-}"

mkdir -p "${BACKUP_DIR}"
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

validate_environment() {

    log "Validating backup environment"

    command -v gzip >/dev/null ||
        {
            log "gzip missing"
            exit 1
        }

    command -v sha256sum >/dev/null ||
        {
            log "sha256sum missing"
            exit 1
        }
}

# =============================================================================
# MongoDB Backup
# =============================================================================

backup_mongodb() {

    if [[ -z "${MONGO_URI}" ]]; then

        log "MongoDB backup skipped"

        return
    fi

    log "Starting MongoDB backup"

    mongodump \
        --uri="${MONGO_URI}" \
        --out="${BACKUP_DIR}/mongodb"

    tar -czf \
        "${BACKUP_DIR}/mongodb.tar.gz" \
        -C "${BACKUP_DIR}" \
        mongodb

    rm -rf "${BACKUP_DIR}/mongodb"

    log "MongoDB backup completed"
}

# =============================================================================
# PostgreSQL Backup
# =============================================================================

backup_postgres() {

    if [[ -z "${POSTGRES_DB}" ]]; then

        log "PostgreSQL backup skipped"

        return
    fi

    log "Starting PostgreSQL backup"

    pg_dump \
        -h "${POSTGRES_HOST}" \
        -p "${POSTGRES_PORT}" \
        -U "${POSTGRES_USER}" \
        "${POSTGRES_DB}" \
        > "${BACKUP_DIR}/postgres.sql"

    gzip \
        "${BACKUP_DIR}/postgres.sql"

    log "PostgreSQL backup completed"
}

# =============================================================================
# Generate Checksums
# =============================================================================

generate_checksums() {

    log "Generating SHA256 checksums"

    cd "${BACKUP_DIR}"

    find . -type f \
        ! -name "checksums.sha256" \
        -exec sha256sum {} \; \
        > checksums.sha256

    cd - >/dev/null
}

# =============================================================================
# Validate Backup Files
# =============================================================================

validate_backups() {

    log "Validating generated backup files"

    if ! find "${BACKUP_DIR}" -type f | grep -q .; then

        log "Backup validation failed"

        exit 1
    fi

    log "Backup validation successful"
}

# =============================================================================
# AWS S3 Upload
# =============================================================================

upload_s3() {

    if [[ -z "${S3_BUCKET}" ]]; then

        log "S3 upload skipped"

        return
    fi

    command -v aws >/dev/null || {

        log "AWS CLI missing"

        return
    }

    log "Uploading backups to S3"

    aws s3 cp \
        "${BACKUP_DIR}" \
        "s3://${S3_BUCKET}/${TIMESTAMP}" \
        --recursive

    log "S3 upload complete"
}

# =============================================================================
# Azure Blob Storage Upload
# =============================================================================

upload_azure() {

    if [[ -z "${AZURE_CONTAINER}" ]]; then

        log "Azure upload skipped"

        return
    fi

    if ! command -v azcopy >/dev/null; then

        log "AzCopy missing"

        return
    fi

    log "Uploading backups to Azure"

    azcopy copy \
        "${BACKUP_DIR}" \
        "${AZURE_CONTAINER}/${TIMESTAMP}" \
        --recursive

    log "Azure upload complete"
}

# =============================================================================
# Retention Policy
# =============================================================================

cleanup_old_backups() {

    log "Applying retention policy"

    find "${BACKUP_ROOT}" \
        -maxdepth 1 \
        -type d \
        -mtime +"${RETENTION_DAYS}" \
        -exec rm -rf {} +

    log "Retention cleanup complete"
}

# =============================================================================
# Main
# =============================================================================

main() {

    log "================================================="
    log "Starting backup"
    log "Application: ${APP_NAME}"
    log "Timestamp : ${TIMESTAMP}"
    log "================================================="

    validate_environment

    backup_mongodb

    backup_postgres

    generate_checksums

    validate_backups

    upload_s3

    upload_azure

    cleanup_old_backups

    log "================================================="
    log "Backup completed successfully"
    log "Location: ${BACKUP_DIR}"
    log "================================================="
}

main "$@"