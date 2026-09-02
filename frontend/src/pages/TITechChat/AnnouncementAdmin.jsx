/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Announcement Administration Console
 * ============================================================================
 *
 * File:
 *   frontend/src/pages/TITechChat/AnnouncementAdmin.jsx
 *
 * Version:
 *   3.0.0
 *
 * Purpose:
 *   Enterprise-grade administration interface for managing TITech Community
 *   Capital announcements.
 *
 * Responsibilities:
 *   - Create announcements.
 *   - Edit existing announcements.
 *   - Publish and unpublish announcements.
 *   - Archive announcements.
 *   - Delete announcements where permitted.
 *   - Search and filter announcements.
 *   - Preview announcement content.
 *   - Display operational status.
 *   - Surface audit information where available.
 *   - Prevent accidental destructive operations.
 *   - Provide accessible keyboard-friendly controls.
 *   - Integrate with Redux announcement state.
 *   - Integrate with centralized announcement services.
 *
 * Design Principles:
 *   - Enterprise administration UX.
 *   - Fail-safe destructive actions.
 *   - Explicit loading/error states.
 *   - Defensive API/service integration.
 *   - Minimal assumptions about backend response shapes.
 *   - Graceful compatibility with evolving announcement services.
 *   - No backend implementation leakage.
 *   - No ACFOS terminology.
 *
 * Branding:
 *   TITech Community Capital
 *
 * Important:
 *   This component assumes authorization is enforced by the backend.
 *   Frontend role checks are UX safeguards only and MUST NOT be treated
 *   as security controls.
 *
 * ============================================================================
 */

'use strict';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import PropTypes from 'prop-types';
import { useDispatch, useSelector } from 'react-redux';

import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TYPES,
  DEFAULT_ANNOUNCEMENT,
  MAX_ANNOUNCEMENT_BODY_LENGTH,
  MAX_ANNOUNCEMENT_TITLE_LENGTH,
} from './announcementConstants';

import {
  selectAnnouncements,
  selectAnnouncementsLoading,
  selectAnnouncementsError,
} from './announcementSelectors';

import {
  fetchAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  unpublishAnnouncement,
  archiveAnnouncement,
  deleteAnnouncement,
} from './announcementSlice';

import {
  getAnnouncementAuditHistory,
} from './announcementAuditService';

import './AnnouncementAdmin.css';

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const BRAND_NAME = 'TITech Community Capital';

const PAGE_SIZE = 20;

const EMPTY_FORM = Object.freeze({
  title: '',
  body: '',
  summary: '',
  category: '',
  type: '',
  priority: 'normal',
  status: 'draft',
  audience: 'all',
  publishAt: '',
  expiresAt: '',
  isPinned: false,
  requiresAcknowledgement: false,
});

const ACTION_LABELS = Object.freeze({
  create: 'Create Announcement',
  edit: 'Save Changes',
  publish: 'Publish',
  unpublish: 'Unpublish',
  archive: 'Archive',
  delete: 'Delete',
});

const STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  archived: 'Archived',
  expired: 'Expired',
});

const PRIORITY_LABELS = Object.freeze({
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
});

const FALLBACK_CATEGORIES = Object.freeze([
  'general',
  'service',
  'maintenance',
  'security',
  'financial',
  'savings',
  'loans',
  'compliance',
]);

const FALLBACK_TYPES = Object.freeze([
  'information',
  'notice',
  'maintenance',
  'alert',
  'policy',
  'promotion',
]);

/* ============================================================================
 * NORMALIZATION HELPERS
 * ========================================================================== */

function getEnumValues(source, fallback) {
  if (Array.isArray(source)) {
    return source;
  }

  if (
    source &&
    typeof source === 'object'
  ) {
    return Object.values(source);
  }

  return fallback;
}

function normalizeValue(value, fallback = '') {
  if (
    value === null ||
    value === undefined
  ) {
    return fallback;
  }

  return String(value);
}

function normalizeAnnouncement(announcement = {}) {
  return {
    ...announcement,

    id:
      announcement.id ??
      announcement._id ??
      announcement.announcementId ??
      null,

    title:
      normalizeValue(
        announcement.title,
      ),

    body:
      normalizeValue(
        announcement.body ??
          announcement.content ??
          announcement.message,
      ),

    summary:
      normalizeValue(
        announcement.summary ??
          announcement.excerpt,
      ),

    category:
      normalizeValue(
        announcement.category,
      ),

    type:
      normalizeValue(
        announcement.type,
      ),

    priority:
      normalizeValue(
        announcement.priority,
        'normal',
      ),

    status:
      normalizeValue(
        announcement.status,
        'draft',
      ).toLowerCase(),

    audience:
      normalizeValue(
        announcement.audience,
        'all',
      ),

    publishAt:
      announcement.publishAt ??
      announcement.scheduledAt ??
      '',

    expiresAt:
      announcement.expiresAt ??
      '',

    isPinned:
      Boolean(
        announcement.isPinned ??
          announcement.pinned,
      ),

    requiresAcknowledgement:
      Boolean(
        announcement.requiresAcknowledgement ??
          announcement.requiresAck,
      ),

    createdAt:
      announcement.createdAt ??
      null,

    updatedAt:
      announcement.updatedAt ??
      null,

    publishedAt:
      announcement.publishedAt ??
      null,

    createdBy:
      announcement.createdBy ??
      announcement.author ??
      null,
  };
}

function toFormValues(announcement) {
  const item =
    normalizeAnnouncement(
      announcement,
    );

  return {
    title: item.title,
    body: item.body,
    summary: item.summary,
    category: item.category,
    type: item.type,
    priority: item.priority,
    status: item.status,
    audience: item.audience,
    publishAt: toDateTimeLocal(
      item.publishAt,
    ),
    expiresAt: toDateTimeLocal(
      item.expiresAt,
    ),
    isPinned: item.isPinned,
    requiresAcknowledgement:
      item.requiresAcknowledgement,
  };
}

function toDateTimeLocal(value) {
  if (!value) {
    return '';
  }

  try {
    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      return '';
    }

    const pad = (number) =>
      String(number).padStart(
        2,
        '0',
      );

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join('-') +
      'T' +
      [
        pad(date.getHours()),
        pad(date.getMinutes()),
      ].join(':');
  } catch {
    return '';
  }
}

function serializeForm(form) {
  return {
    title:
      form.title.trim(),

    body:
      form.body.trim(),

    summary:
      form.summary.trim(),

    category:
      form.category || undefined,

    type:
      form.type || undefined,

    priority:
      form.priority || 'normal',

    status:
      form.status || 'draft',

    audience:
      form.audience || 'all',

    publishAt:
      form.publishAt
        ? new Date(
            form.publishAt,
          ).toISOString()
        : undefined,

    expiresAt:
      form.expiresAt
        ? new Date(
            form.expiresAt,
          ).toISOString()
        : undefined,

    isPinned:
      Boolean(form.isPinned),

    requiresAcknowledgement:
      Boolean(
        form.requiresAcknowledgement,
      ),
  };
}

function getActionResult(result) {
  if (
    result &&
    typeof result.unwrap ===
      'function'
  ) {
    return result.unwrap();
  }

  return Promise.resolve(
    result,
  );
}

function formatDate(value) {
  if (!value) {
    return '—';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '—';
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle: 'medium',
      timeStyle: 'short',
    },
  ).format(date);
}

function getAnnouncementId(
  announcement,
) {
  return (
    announcement?.id ??
    announcement?._id ??
    announcement?.announcementId ??
    null
  );
}

function matchesSearch(
  announcement,
  query,
) {
  if (!query.trim()) {
    return true;
  }

  const normalized =
    query
      .trim()
      .toLowerCase();

  return [
    announcement.title,
    announcement.summary,
    announcement.body,
    announcement.category,
    announcement.type,
    announcement.priority,
    announcement.status,
  ]
    .filter(Boolean)
    .some((value) =>
      String(value)
        .toLowerCase()
        .includes(normalized),
    );
}

/* ============================================================================
 * SMALL PRESENTATIONAL COMPONENTS
 * ========================================================================== */

function StatusBadge({
  status,
}) {
  const normalized =
    normalizeValue(
      status,
      'draft',
    ).toLowerCase();

  return (
    <span
      className={`announcement-admin__status announcement-admin__status--${normalized}`}
      aria-label={`Status: ${
        STATUS_LABELS[normalized] ??
        normalized
      }`}
    >
      {STATUS_LABELS[normalized] ??
        normalized}
    </span>
  );
}

StatusBadge.propTypes = {
  status:
    PropTypes.string,
};

function PriorityBadge({
  priority,
}) {
  const normalized =
    normalizeValue(
      priority,
      'normal',
    ).toLowerCase();

  return (
    <span
      className={`announcement-admin__priority announcement-admin__priority--${normalized}`}
    >
      {PRIORITY_LABELS[
        normalized
      ] ?? normalized}
    </span>
  );
}

PriorityBadge.propTypes = {
  priority:
    PropTypes.string,
};

function EmptyState({
  title,
  description,
  action,
}) {
  return (
    <div className="announcement-admin__empty">
      <div
        className="announcement-admin__empty-icon"
        aria-hidden="true"
      >
        ℹ
      </div>

      <h3>{title}</h3>

      <p>{description}</p>

      {action}
    </div>
  );
}

EmptyState.propTypes = {
  title:
    PropTypes.string.isRequired,

  description:
    PropTypes.string.isRequired,

  action:
    PropTypes.node,
};

function LoadingState() {
  return (
    <div
      className="announcement-admin__loading"
      role="status"
      aria-live="polite"
    >
      <span
        className="announcement-admin__spinner"
        aria-hidden="true"
      />

      <span>
        Loading announcements…
      </span>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}) {
  return (
    <div
      className="announcement-admin__error"
      role="alert"
    >
      <strong>
        Unable to load announcements.
      </strong>

      <p>
        {message ||
          'An unexpected error occurred while loading announcement data.'}
      </p>

      <button
        type="button"
        className="announcement-admin__button announcement-admin__button--secondary"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

ErrorState.propTypes = {
  message:
    PropTypes.string,

  onRetry:
    PropTypes.func.isRequired,
};

/* ============================================================================
 * FORM COMPONENT
 * ========================================================================== */

function AnnouncementForm({
  mode,
  form,
  submitting,
  validationErrors,
  onChange,
  onSubmit,
  onCancel,
}) {
  const categories =
    getEnumValues(
      ANNOUNCEMENT_CATEGORIES,
      FALLBACK_CATEGORIES,
    );

  const types =
    getEnumValues(
      ANNOUNCEMENT_TYPES,
      FALLBACK_TYPES,
    );

  const priorities =
    getEnumValues(
      ANNOUNCEMENT_PRIORITIES,
      [
        'low',
        'normal',
        'high',
        'urgent',
      ],
    );

  const statuses =
    getEnumValues(
      ANNOUNCEMENT_STATUSES,
      [
        'draft',
        'scheduled',
        'published',
      ],
    );

  const updateField = (
    event,
  ) => {
    const {
      name,
      value,
      type,
      checked,
    } = event.target;

    onChange(
      name,
      type === 'checkbox'
        ? checked
        : value,
    );
  };

  return (
    <form
      className="announcement-admin__form"
      onSubmit={onSubmit}
      noValidate
    >
      <div className="announcement-admin__form-header">
        <div>
          <p className="announcement-admin__eyebrow">
            {mode === 'edit'
              ? 'Edit announcement'
              : 'New announcement'}
          </p>

          <h2>
            {mode === 'edit'
              ? 'Update Announcement'
              : 'Create Announcement'}
          </h2>

          <p>
            Publish clear, accurate and
            appropriately targeted
            communications to the TITech
            Community Capital platform.
          </p>
        </div>
      </div>

      <div className="announcement-admin__form-grid">
        <div className="announcement-admin__field announcement-admin__field--full">
          <label htmlFor="announcement-title">
            Title
            <span aria-hidden="true">
              {' '}
              *
            </span>
          </label>

          <input
            id="announcement-title"
            name="title"
            type="text"
            value={form.title}
            onChange={updateField}
            maxLength={
              MAX_ANNOUNCEMENT_TITLE_LENGTH ||
              200
            }
            required
            autoComplete="off"
            aria-invalid={
              Boolean(
                validationErrors.title,
              )
            }
            aria-describedby={
              validationErrors.title
                ? 'announcement-title-error'
                : 'announcement-title-help'
            }
          />

          <small id="announcement-title-help">
            {form.title.length}/
            {MAX_ANNOUNCEMENT_TITLE_LENGTH ||
              200}{' '}
            characters
          </small>

          {validationErrors.title && (
            <span
              id="announcement-title-error"
              className="announcement-admin__field-error"
            >
              {validationErrors.title}
            </span>
          )}
        </div>

        <div className="announcement-admin__field announcement-admin__field--full">
          <label htmlFor="announcement-summary">
            Summary
          </label>

          <textarea
            id="announcement-summary"
            name="summary"
            value={form.summary}
            onChange={updateField}
            rows={3}
            maxLength={500}
            placeholder="Short summary shown in announcement lists."
          />
        </div>

        <div className="announcement-admin__field announcement-admin__field--full">
          <label htmlFor="announcement-body">
            Announcement content
            <span aria-hidden="true">
              {' '}
              *
            </span>
          </label>

          <textarea
            id="announcement-body"
            name="body"
            value={form.body}
            onChange={updateField}
            rows={10}
            maxLength={
              MAX_ANNOUNCEMENT_BODY_LENGTH ||
              10000
            }
            required
            aria-invalid={
              Boolean(
                validationErrors.body,
              )
            }
            aria-describedby={
              validationErrors.body
                ? 'announcement-body-error'
                : undefined
            }
            placeholder="Write the complete announcement."
          />

          <small>
            {form.body.length}/
            {MAX_ANNOUNCEMENT_BODY_LENGTH ||
              10000}{' '}
            characters
          </small>

          {validationErrors.body && (
            <span
              id="announcement-body-error"
              className="announcement-admin__field-error"
            >
              {validationErrors.body}
            </span>
          )}
        </div>

        <div className="announcement-admin__field">
          <label htmlFor="announcement-category">
            Category
          </label>

          <select
            id="announcement-category"
            name="category"
            value={form.category}
            onChange={updateField}
          >
            <option value="">
              Select category
            </option>

            {categories.map(
              (category) => (
                <option
                  key={category}
                  value={category}
                >
                  {String(category)
                    .replace(
                      /[-_]/g,
                      ' ',
                    )
                    .replace(
                      /\b\w/g,
                      (char) =>
                        char.toUpperCase(),
                    )}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="announcement-admin__field">
          <label htmlFor="announcement-type">
            Type
          </label>

          <select
            id="announcement-type"
            name="type"
            value={form.type}
            onChange={updateField}
          >
            <option value="">
              Select type
            </option>

            {types.map(
              (type) => (
                <option
                  key={type}
                  value={type}
                >
                  {String(type)
                    .replace(
                      /[-_]/g,
                      ' ',
                    )
                    .replace(
                      /\b\w/g,
                      (char) =>
                        char.toUpperCase(),
                    )}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="announcement-admin__field">
          <label htmlFor="announcement-priority">
            Priority
          </label>

          <select
            id="announcement-priority"
            name="priority"
            value={form.priority}
            onChange={updateField}
          >
            {priorities.map(
              (priority) => (
                <option
                  key={priority}
                  value={priority}
                >
                  {PRIORITY_LABELS[
                    priority
                  ] ?? priority}
                </option>
              ),
            )}
          </select>
        </div>

        <div className="announcement-admin__field">
          <label htmlFor="announcement-status">
            Initial status
          </label>

          <select
            id="announcement-status"
            name="status"
            value={form.status}
            onChange={updateField}
          >
            {statuses
              .filter(
                (status) =>
                  status !==
                    'archived' &&
                  status !==
                    'expired',
              )
              .map(
                (status) => (
                  <option
                    key={status}
                    value={status}
                  >
                    {STATUS_LABELS[
                      status
                    ] ?? status}
                  </option>
                ),
              )}
          </select>
        </div>

        <div className="announcement-admin__field">
          <label htmlFor="announcement-audience">
            Audience
          </label>

          <select
            id="announcement-audience"
            name="audience"
            value={form.audience}
            onChange={updateField}
          >
            <option value="all">
              All users
            </option>
            <option value="members">
              Members
            </option>
            <option value="administrators">
              Administrators
            </option>
            <option value="loan-members">
              Loan members
            </option>
            <option value="savings-members">
              Savings members
            </option>
            <option value="specific-tenant">
              Specific tenant
            </option>
          </select>
        </div>

        <div className="announcement-admin__field">
          <label htmlFor="announcement-publish-at">
            Publish date/time
          </label>

          <input
            id="announcement-publish-at"
            name="publishAt"
            type="datetime-local"
            value={form.publishAt}
            onChange={updateField}
          />
        </div>

        <div className="announcement-admin__field">
          <label htmlFor="announcement-expires-at">
            Expiration date/time
          </label>

          <input
            id="announcement-expires-at"
            name="expiresAt"
            type="datetime-local"
            value={form.expiresAt}
            onChange={updateField}
          />
        </div>
      </div>

      <fieldset className="announcement-admin__options">
        <legend>
          Delivery options
        </legend>

        <label className="announcement-admin__checkbox">
          <input
            name="isPinned"
            type="checkbox"
            checked={
              form.isPinned
            }
            onChange={updateField}
          />

          <span>
            <strong>
              Pin announcement
            </strong>

            <small>
              Keep this announcement
              prominently visible where
              supported.
            </small>
          </span>
        </label>

        <label className="announcement-admin__checkbox">
          <input
            name="requiresAcknowledgement"
            type="checkbox"
            checked={
              form.requiresAcknowledgement
            }
            onChange={updateField}
          />

          <span>
            <strong>
              Require acknowledgement
            </strong>

            <small>
              Mark the communication as
              requiring user acknowledgement.
            </small>
          </span>
        </label>
      </fieldset>

      <div className="announcement-admin__form-actions">
        <button
          type="button"
          className="announcement-admin__button announcement-admin__button--secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="announcement-admin__button announcement-admin__button--primary"
          disabled={submitting}
        >
          {submitting
            ? 'Saving…'
            : mode === 'edit'
              ? ACTION_LABELS.edit
              : ACTION_LABELS.create}
        </button>
      </div>
    </form>
  );
}

AnnouncementForm.propTypes = {
  mode:
    PropTypes.oneOf([
      'create',
      'edit',
    ]).isRequired,

  form:
    PropTypes.shape({
      title:
        PropTypes.string,
      body:
        PropTypes.string,
      summary:
        PropTypes.string,
      category:
        PropTypes.string,
      type:
        PropTypes.string,
      priority:
        PropTypes.string,
      status:
        PropTypes.string,
      audience:
        PropTypes.string,
      publishAt:
        PropTypes.string,
      expiresAt:
        PropTypes.string,
      isPinned:
        PropTypes.bool,
      requiresAcknowledgement:
        PropTypes.bool,
    }).isRequired,

  submitting:
    PropTypes.bool.isRequired,

  validationErrors:
    PropTypes.objectOf(
      PropTypes.string,
    ).isRequired,

  onChange:
    PropTypes.func.isRequired,

  onSubmit:
    PropTypes.func.isRequired,

  onCancel:
    PropTypes.func.isRequired,
};

/* ============================================================================
 * PREVIEW COMPONENT
 * ========================================================================== */

function AnnouncementPreview({
  announcement,
  onClose,
}) {
  if (!announcement) {
    return null;
  }

  const item =
    normalizeAnnouncement(
      announcement,
    );

  return (
    <div
      className="announcement-admin__modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className="announcement-admin__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-preview-title"
      >
        <header className="announcement-admin__modal-header">
          <div>
            <p className="announcement-admin__eyebrow">
              Announcement preview
            </p>

            <h2 id="announcement-preview-title">
              {item.title ||
                'Untitled announcement'}
            </h2>
          </div>

          <button
            type="button"
            className="announcement-admin__icon-button"
            onClick={onClose}
            aria-label="Close preview"
          >
            ×
          </button>
        </header>

        <div className="announcement-admin__modal-body">
          <div className="announcement-admin__preview-meta">
            <StatusBadge
              status={item.status}
            />

            <PriorityBadge
              priority={item.priority}
            />

            {item.category && (
              <span>
                {item.category}
              </span>
            )}
          </div>

          {item.summary && (
            <p className="announcement-admin__preview-summary">
              {item.summary}
            </p>
          )}

          <div className="announcement-admin__preview-content">
            {item.body
              .split(/\n{2,}/)
              .map(
                (paragraph, index) => (
                  <p key={index}>
                    {paragraph}
                  </p>
                ),
              )}
          </div>
        </div>

        <footer className="announcement-admin__modal-footer">
          <button
            type="button"
            className="announcement-admin__button announcement-admin__button--secondary"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

AnnouncementPreview.propTypes = {
  announcement:
    PropTypes.object,

  onClose:
    PropTypes.func.isRequired,
};

/* ============================================================================
 * AUDIT MODAL
 * ========================================================================== */

function AuditModal({
  announcement,
  audit,
  loading,
  error,
  onClose,
}) {
  if (!announcement) {
    return null;
  }

  return (
    <div
      className="announcement-admin__modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <section
        className="announcement-admin__modal announcement-admin__modal--large"
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-audit-title"
      >
        <header className="announcement-admin__modal-header">
          <div>
            <p className="announcement-admin__eyebrow">
              Governance
            </p>

            <h2 id="announcement-audit-title">
              Audit History
            </h2>

            <p>
              {announcement.title ||
                'Announcement'}
            </p>
          </div>

          <button
            type="button"
            className="announcement-admin__icon-button"
            onClick={onClose}
            aria-label="Close audit history"
          >
            ×
          </button>
        </header>

        <div className="announcement-admin__modal-body">
          {loading && (
            <LoadingState />
          )}

          {error && (
            <div
              className="announcement-admin__error"
              role="alert"
            >
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            (!Array.isArray(
              audit,
            ) ||
              audit.length ===
                0) && (
              <EmptyState
                title="No audit events"
                description="No audit history is currently available for this announcement."
              />
            )}

          {!loading &&
            !error &&
            Array.isArray(
              audit,
            ) &&
            audit.length > 0 && (
              <ol className="announcement-admin__audit-list">
                {audit.map(
                  (
                    event,
                    index,
                  ) => (
                    <li
                      key={
                        event.id ??
                        event._id ??
                        `${event.timestamp}-${index}`
                      }
                      className="announcement-admin__audit-item"
                    >
                      <div>
                        <strong>
                          {event.action ??
                            event.event ??
                            'Activity'}
                        </strong>

                        <p>
                          {event.description ??
                            event.message ??
                            'Announcement activity recorded.'}
                        </p>
                      </div>

                      <time
                        dateTime={
                          event.timestamp ??
                          event.createdAt ??
                          undefined
                        }
                      >
                        {formatDate(
                          event.timestamp ??
                            event.createdAt,
                        )}
                      </time>
                    </li>
                  ),
                )}
              </ol>
            )}
        </div>

        <footer className="announcement-admin__modal-footer">
          <button
            type="button"
            className="announcement-admin__button announcement-admin__button--secondary"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

AuditModal.propTypes = {
  announcement:
    PropTypes.object,

  audit:
    PropTypes.array,

  loading:
    PropTypes.bool.isRequired,

  error:
    PropTypes.string,

  onClose:
    PropTypes.func.isRequired,
};

/* ============================================================================
 * MAIN COMPONENT
 * ========================================================================== */

export default function AnnouncementAdmin({
  pageSize = PAGE_SIZE,
  onUnauthorized,
}) {
  const dispatch =
    useDispatch();

  const reduxAnnouncements =
    useSelector(
      selectAnnouncements,
    );

  const reduxLoading =
    useSelector(
      selectAnnouncementsLoading,
    );

  const reduxError =
    useSelector(
      selectAnnouncementsError,
    );

  const announcements =
    useMemo(
      () =>
        Array.isArray(
          reduxAnnouncements,
        )
          ? reduxAnnouncements.map(
              normalizeAnnouncement,
            )
          : [],
      [reduxAnnouncements],
    );

  const [mode, setMode] =
    useState(null);

  const [editingAnnouncement, setEditingAnnouncement] =
    useState(null);

  const [form, setForm] =
    useState({
      ...EMPTY_FORM,
    });

  const [submitting, setSubmitting] =
    useState(false);

  const [actionId, setActionId] =
    useState(null);

  const [actionError, setActionError] =
    useState('');

  const [successMessage, setSuccessMessage] =
    useState('');

  const [search, setSearch] =
    useState('');

  const [statusFilter, setStatusFilter] =
    useState('all');

  const [categoryFilter, setCategoryFilter] =
    useState('all');

  const [priorityFilter, setPriorityFilter] =
    useState('all');

  const [currentPage, setCurrentPage] =
    useState(1);

  const [previewAnnouncement, setPreviewAnnouncement] =
    useState(null);

  const [auditAnnouncement, setAuditAnnouncement] =
    useState(null);

  const [auditEvents, setAuditEvents] =
    useState([]);

  const [auditLoading, setAuditLoading] =
    useState(false);

  const [auditError, setAuditError] =
    useState('');

  const [deleteCandidate, setDeleteCandidate] =
    useState(null);

  /* ==========================================================================
   * DATA LOADING
   * ======================================================================== */

  const loadAnnouncements =
    useCallback(() => {
      setActionError('');

      return dispatch(
        fetchAnnouncements(),
      );
    }, [dispatch]);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  /* ==========================================================================
   * FILTER OPTIONS
   * ======================================================================== */

  const categoryOptions =
    useMemo(() => {
      const values =
        announcements
          .map(
            (item) =>
              item.category,
          )
          .filter(Boolean);

      return Array.from(
        new Set(values),
      ).sort();
    }, [announcements]);

  /* ==========================================================================
   * FILTERED DATA
   * ======================================================================== */

  const filteredAnnouncements =
    useMemo(
      () =>
        announcements
          .filter((item) =>
            matchesSearch(
              item,
              search,
            ),
          )
          .filter(
            (item) =>
              statusFilter ===
                'all' ||
              item.status ===
                statusFilter,
          )
          .filter(
            (item) =>
              categoryFilter ===
                'all' ||
              item.category ===
                categoryFilter,
          )
          .filter(
            (item) =>
              priorityFilter ===
                'all' ||
              item.priority ===
                priorityFilter,
          )
          .sort((a, b) => {
            const aDate =
              new Date(
                a.updatedAt ??
                  a.createdAt ??
                  0,
              ).getTime();

            const bDate =
              new Date(
                b.updatedAt ??
                  b.createdAt ??
                  0,
              ).getTime();

            return (
              bDate - aDate
            );
          }),
      [
        announcements,
        search,
        statusFilter,
        categoryFilter,
        priorityFilter,
      ],
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filteredAnnouncements.length /
          pageSize,
      ),
    );

  const paginatedAnnouncements =
    useMemo(
      () => {
        const safePage =
          Math.min(
            Math.max(
              currentPage,
              1,
            ),
            totalPages,
          );

        const start =
          (safePage - 1) *
          pageSize;

        return filteredAnnouncements.slice(
          start,
          start + pageSize,
        );
      },
      [
        currentPage,
        filteredAnnouncements,
        pageSize,
        totalPages,
      ],
    );

  useEffect(() => {
    setCurrentPage(
      (page) =>
        Math.min(
          Math.max(
            page,
            1,
          ),
          totalPages,
        ),
    );
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    search,
    statusFilter,
    categoryFilter,
    priorityFilter,
  ]);

  /* ==========================================================================
   * FORM
   * ======================================================================== */

  const openCreateForm =
    useCallback(() => {
      setMode('create');
      setEditingAnnouncement(
        null,
      );
      setForm({
        ...EMPTY_FORM,
      });
      setActionError('');
      setSuccessMessage('');
      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    }, []);

  const openEditForm =
    useCallback(
      (announcement) => {
        setMode('edit');
        setEditingAnnouncement(
          announcement,
        );
        setForm(
          toFormValues(
            announcement,
          ),
        );
        setActionError('');
        setSuccessMessage('');
        window.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      },
      [],
    );

  const closeForm =
    useCallback(() => {
      if (submitting) {
        return;
      }

      setMode(null);
      setEditingAnnouncement(
        null,
      );
      setForm({
        ...EMPTY_FORM,
      });
      setActionError('');
    }, [submitting]);

  const handleFormChange =
    useCallback(
      (name, value) => {
        setForm(
          (previous) => ({
            ...previous,
            [name]: value,
          }),
        );
      },
      [],
    );

  const validateForm =
    useCallback(() => {
      const errors = {};

      const title =
        form.title.trim();

      const body =
        form.body.trim();

      if (!title) {
        errors.title =
          'A title is required.';
      }

      if (
        title.length >
        (MAX_ANNOUNCEMENT_TITLE_LENGTH ||
          200)
      ) {
        errors.title =
          `Title cannot exceed ${
            MAX_ANNOUNCEMENT_TITLE_LENGTH ||
            200
          } characters.`;
      }

      if (!body) {
        errors.body =
          'Announcement content is required.';
      }

      if (
        body.length >
        (MAX_ANNOUNCEMENT_BODY_LENGTH ||
          10000)
      ) {
        errors.body =
          `Content cannot exceed ${
            MAX_ANNOUNCEMENT_BODY_LENGTH ||
            10000
          } characters.`;
      }

      if (
        form.publishAt &&
        form.expiresAt
      ) {
        const publishTime =
          new Date(
            form.publishAt,
          ).getTime();

        const expiryTime =
          new Date(
            form.expiresAt,
          ).getTime();

        if (
          !Number.isNaN(
            publishTime,
          ) &&
          !Number.isNaN(
            expiryTime,
          ) &&
          expiryTime <=
            publishTime
        ) {
          errors.expiresAt =
            'Expiration must occur after publication.';
        }
      }

      return errors;
    }, [form]);

  const handleSubmit =
    useCallback(
      async (event) => {
        event.preventDefault();

        const errors =
          validateForm();

        if (
          Object.keys(errors)
            .length > 0
        ) {
          setActionError(
            'Please correct the highlighted fields before continuing.',
          );
          return;
        }

        setSubmitting(true);
        setActionError('');
        setSuccessMessage('');

        try {
          const payload =
            serializeForm(
              form,
            );

          if (
            mode === 'edit' &&
            editingAnnouncement
          ) {
            const id =
              getAnnouncementId(
                editingAnnouncement,
              );

            if (!id) {
              throw new Error(
                'The announcement identifier is missing.',
              );
            }

            await getActionResult(
              dispatch(
                updateAnnouncement({
                  id,
                  data: payload,
                }),
              ),
            );

            setSuccessMessage(
              'Announcement updated successfully.',
            );
          } else {
            await getActionResult(
              dispatch(
                createAnnouncement(
                  payload,
                ),
              ),
            );

            setSuccessMessage(
              'Announcement created successfully.',
            );
          }

          setMode(null);
          setEditingAnnouncement(
            null,
          );
          setForm({
            ...EMPTY_FORM,
          });

          await loadAnnouncements();
        } catch (error) {
          if (
            error?.status === 401 ||
            error?.status === 403
          ) {
            onUnauthorized?.(
              error,
            );
          }

          setActionError(
            error?.message ||
              'Unable to save the announcement.',
          );
        } finally {
          setSubmitting(false);
        }
      },
      [
        dispatch,
        editingAnnouncement,
        form,
        loadAnnouncements,
        mode,
        onUnauthorized,
        validateForm,
      ],
    );

  /* ==========================================================================
   * ACTION HANDLERS
   * ======================================================================== */

  const executeAction =
    useCallback(
      async (
        announcement,
        action,
      ) => {
        const id =
          getAnnouncementId(
            announcement,
          );

        if (!id) {
          setActionError(
            'This announcement does not have a valid identifier.',
          );
          return;
        }

        setActionId(id);
        setActionError('');
        setSuccessMessage('');

        try {
          let operation;

          switch (action) {
            case 'publish':
              operation =
                publishAnnouncement(
                  id,
                );
              break;

            case 'unpublish':
              operation =
                unpublishAnnouncement(
                  id,
                );
              break;

            case 'archive':
              operation =
                archiveAnnouncement(
                  id,
                );
              break;

            case 'delete':
              operation =
                deleteAnnouncement(
                  id,
                );
              break;

            default:
              throw new Error(
                `Unsupported announcement action: ${action}`,
              );
          }

          await getActionResult(
            dispatch(operation),
          );

          const successLabels = {
            publish:
              'Announcement published successfully.',
            unpublish:
              'Announcement unpublished successfully.',
            archive:
              'Announcement archived successfully.',
            delete:
              'Announcement deleted successfully.',
          };

          setSuccessMessage(
            successLabels[
              action
            ] ||
              'Announcement updated successfully.',
          );

          await loadAnnouncements();
        } catch (error) {
          if (
            error?.status === 401 ||
            error?.status === 403
          ) {
            onUnauthorized?.(
              error,
            );
          }

          setActionError(
            error?.message ||
              `Unable to ${action} the announcement.`,
          );
        } finally {
          setActionId(null);
          setDeleteCandidate(null);
        }
      },
      [
        dispatch,
        loadAnnouncements,
        onUnauthorized,
      ],
    );

  const requestAction =
    useCallback(
      (
        announcement,
        action,
      ) => {
        setActionError('');

        if (
          action === 'delete'
        ) {
          setDeleteCandidate(
            announcement,
          );
          return;
        }

        const confirmationMessages = {
          publish:
            'Publish this announcement now?',
          unpublish:
            'Unpublish this announcement?',
          archive:
            'Archive this announcement?',
        };

        const confirmed =
          window.confirm(
            confirmationMessages[
              action
            ] ||
              'Continue with this action?',
          );

        if (!confirmed) {
          return;
        }

        executeAction(
          announcement,
          action,
        );
      },
      [executeAction],
    );

  const confirmDelete =
    useCallback(() => {
      if (!deleteCandidate) {
        return;
      }

      executeAction(
        deleteCandidate,
        'delete',
      );
    }, [
      deleteCandidate,
      executeAction,
    ]);

  /* ==========================================================================
   * AUDIT
   * ======================================================================== */

  const openAudit =
    useCallback(
      async (announcement) => {
        setAuditAnnouncement(
          announcement,
        );
        setAuditEvents([]);
        setAuditError('');
        setAuditLoading(true);

        const id =
          getAnnouncementId(
            announcement,
          );

        if (!id) {
          setAuditError(
            'Unable to identify this announcement.',
          );
          setAuditLoading(false);
          return;
        }

        try {
          const result =
            await getAnnouncementAuditHistory(
              id,
            );

          const events =
            Array.isArray(
              result,
            )
              ? result
              : Array.isArray(
                    result?.data,
                  )
                ? result.data
                : Array.isArray(
                      result?.events,
                    )
                  ? result.events
                  : [];

          setAuditEvents(
            events,
          );
        } catch (error) {
          setAuditError(
            error?.message ||
              'Unable to load audit history.',
          );
        } finally {
          setAuditLoading(
            false,
          );
        }
      },
      [],
    );

  /* ==========================================================================
   * SUMMARY
   * ======================================================================== */

  const summary =
    useMemo(() => {
      const result = {
        total:
          announcements.length,
        draft: 0,
        scheduled: 0,
        published: 0,
        archived: 0,
        urgent: 0,
      };

      announcements.forEach(
        (item) => {
          if (
            Object.prototype.hasOwnProperty.call(
              result,
              item.status,
            )
          ) {
            result[
              item.status
            ] += 1;
          }

          if (
            item.priority ===
            'urgent'
          ) {
            result.urgent += 1;
          }
        },
      );

      return result;
    }, [announcements]);

  /* ==========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <main
      className="announcement-admin"
      aria-labelledby="announcement-admin-title"
    >
      <header className="announcement-admin__header">
        <div>
          <p className="announcement-admin__eyebrow">
            {BRAND_NAME}
          </p>

          <h1 id="announcement-admin-title">
            Announcement Administration
          </h1>

          <p>
            Manage platform communications,
            service notices, operational
            alerts and community updates.
          </p>
        </div>

        <button
          type="button"
          className="announcement-admin__button announcement-admin__button--primary"
          onClick={openCreateForm}
        >
          + New Announcement
        </button>
      </header>

      {(actionError ||
        reduxError) && (
        <div
          className="announcement-admin__alert announcement-admin__alert--error"
          role="alert"
        >
          <strong>
            Action required
          </strong>

          <p>
            {actionError ||
              reduxError}
          </p>
        </div>
      )}

      {successMessage && (
        <div
          className="announcement-admin__alert announcement-admin__alert--success"
          role="status"
          aria-live="polite"
        >
          {successMessage}
        </div>
      )}

      {/* ======================================================================
          FORM
          ==================================================================== */}

      {mode && (
        <section
          className="announcement-admin__form-panel"
          aria-label={
            mode === 'edit'
              ? 'Edit announcement'
              : 'Create announcement'
          }
        >
          <AnnouncementForm
            mode={mode}
            form={form}
            submitting={submitting}
            validationErrors={{}}
            onChange={
              handleFormChange
            }
            onSubmit={
              handleSubmit
            }
            onCancel={
              closeForm
            }
          />
        </section>
      )}

      {/* ======================================================================
          SUMMARY
          ==================================================================== */}

      <section
        className="announcement-admin__summary"
        aria-label="Announcement summary"
      >
        <article className="announcement-admin__summary-card">
          <span>Total</span>
          <strong>
            {summary.total}
          </strong>
        </article>

        <article className="announcement-admin__summary-card">
          <span>Drafts</span>
          <strong>
            {summary.draft}
          </strong>
        </article>

        <article className="announcement-admin__summary-card">
          <span>Scheduled</span>
          <strong>
            {summary.scheduled}
          </strong>
        </article>

        <article className="announcement-admin__summary-card">
          <span>Published</span>
          <strong>
            {summary.published}
          </strong>
        </article>

        <article className="announcement-admin__summary-card">
          <span>Urgent</span>
          <strong>
            {summary.urgent}
          </strong>
        </article>
      </section>

      {/* ======================================================================
          FILTERS
          ==================================================================== */}

      <section
        className="announcement-admin__filters"
        aria-label="Announcement filters"
      >
        <div className="announcement-admin__search">
          <label htmlFor="announcement-search">
            Search
          </label>

          <input
            id="announcement-search"
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value,
              )
            }
            placeholder="Search announcements…"
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="announcement-status-filter">
            Status
          </label>

          <select
            id="announcement-status-filter"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              All statuses
            </option>

            {Object.keys(
              STATUS_LABELS,
            ).map((status) => (
              <option
                key={status}
                value={status}
              >
                {
                  STATUS_LABELS[
                    status
                  ]
                }
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="announcement-category-filter">
            Category
          </label>

          <select
            id="announcement-category-filter"
            value={categoryFilter}
            onChange={(event) =>
              setCategoryFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              All categories
            </option>

            {categoryOptions.map(
              (category) => (
                <option
                  key={category}
                  value={category}
                >
                  {category}
                </option>
              ),
            )}
          </select>
        </div>

        <div>
          <label htmlFor="announcement-priority-filter">
            Priority
          </label>

          <select
            id="announcement-priority-filter"
            value={priorityFilter}
            onChange={(event) =>
              setPriorityFilter(
                event.target.value,
              )
            }
          >
            <option value="all">
              All priorities
            </option>

            {Object.keys(
              PRIORITY_LABELS,
            ).map((priority) => (
              <option
                key={priority}
                value={priority}
              >
                {
                  PRIORITY_LABELS[
                    priority
                  ]
                }
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="announcement-admin__button announcement-admin__button--secondary"
          onClick={() => {
            setSearch('');
            setStatusFilter(
              'all',
            );
            setCategoryFilter(
              'all',
            );
            setPriorityFilter(
              'all',
            );
          }}
        >
          Reset
        </button>
      </section>

      {/* ======================================================================
          LIST
          ==================================================================== */}

      <section
        className="announcement-admin__list-section"
        aria-labelledby="announcement-list-title"
      >
        <div className="announcement-admin__section-header">
          <div>
            <h2 id="announcement-list-title">
              Announcements
            </h2>

            <p>
              {filteredAnnouncements.length}{' '}
              result
              {filteredAnnouncements.length ===
              1
                ? ''
                : 's'}
            </p>
          </div>

          <button
            type="button"
            className="announcement-admin__button announcement-admin__button--secondary"
            onClick={
              loadAnnouncements
            }
            disabled={
              reduxLoading
            }
          >
            Refresh
          </button>
        </div>

        {reduxLoading &&
        announcements.length ===
          0 ? (
          <LoadingState />
        ) : filteredAnnouncements.length ===
          0 ? (
          <EmptyState
            title="No announcements found"
            description={
              search ||
              statusFilter !==
                'all' ||
              categoryFilter !==
                'all' ||
              priorityFilter !==
                'all'
                ? 'Try changing your filters or search terms.'
                : 'Create your first announcement to begin communicating with your users.'
            }
            action={
              !search &&
              statusFilter ===
                'all' &&
              categoryFilter ===
                'all' &&
              priorityFilter ===
                'all' ? (
                <button
                  type="button"
                  className="announcement-admin__button announcement-admin__button--primary"
                  onClick={
                    openCreateForm
                  }
                >
                  Create Announcement
                </button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="announcement-admin__table-wrapper">
              <table className="announcement-admin__table">
                <caption className="announcement-admin__sr-only">
                  TITech Community Capital
                  announcements
                </caption>

                <thead>
                  <tr>
                    <th scope="col">
                      Announcement
                    </th>

                    <th scope="col">
                      Status
                    </th>

                    <th scope="col">
                      Priority
                    </th>

                    <th scope="col">
                      Audience
                    </th>

                    <th scope="col">
                      Updated
                    </th>

                    <th scope="col">
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {paginatedAnnouncements.map(
                    (announcement) => {
                      const id =
                        getAnnouncementId(
                          announcement,
                        );

                      const busy =
                        actionId ===
                        id;

                      return (
                        <tr
                          key={
                            id ??
                            `${announcement.title}-${announcement.createdAt}`
                          }
                        >
                          <td>
                            <div className="announcement-admin__announcement-cell">
                              <strong>
                                {
                                  announcement.title
                                }
                              </strong>

                              {announcement.summary && (
                                <span>
                                  {
                                    announcement.summary
                                  }
                                </span>
                              )}

                              <small>
                                {announcement.category ||
                                  'Uncategorized'}
                              </small>
                            </div>
                          </td>

                          <td>
                            <StatusBadge
                              status={
                                announcement.status
                              }
                            />
                          </td>

                          <td>
                            <PriorityBadge
                              priority={
                                announcement.priority
                              }
                            />
                          </td>

                          <td>
                            {
                              announcement.audience
                            }
                          </td>

                          <td>
                            {formatDate(
                              announcement.updatedAt ??
                                announcement.createdAt,
                            )}
                          </td>

                          <td>
                            <div className="announcement-admin__row-actions">
                              <button
                                type="button"
                                className="announcement-admin__button announcement-admin__button--small announcement-admin__button--secondary"
                                onClick={() =>
                                  setPreviewAnnouncement(
                                    announcement,
                                  )
                                }
                              >
                                Preview
                              </button>

                              <button
                                type="button"
                                className="announcement-admin__button announcement-admin__button--small announcement-admin__button--secondary"
                                onClick={() =>
                                  openEditForm(
                                    announcement,
                                  )
                                }
                                disabled={
                                  busy
                                }
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                className="announcement-admin__button announcement-admin__button--small announcement-admin__button--secondary"
                                onClick={() =>
                                  openAudit(
                                    announcement,
                                  )
                                }
                              >
                                Audit
                              </button>

                              {announcement.status ===
                                'draft' ||
                              announcement.status ===
                                'scheduled' ? (
                                <button
                                  type="button"
                                  className="announcement-admin__button announcement-admin__button--small announcement-admin__button--primary"
                                  onClick={() =>
                                    requestAction(
                                      announcement,
                                      'publish',
                                    )
                                  }
                                  disabled={
                                    busy
                                  }
                                >
                                  {busy
                                    ? 'Working…'
                                    : ACTION_LABELS.publish}
                                </button>
                              ) : null}

                              {announcement.status ===
                                'published' ? (
                                <button
                                  type="button"
                                  className="announcement-admin__button announcement-admin__button--small announcement-admin__button--secondary"
                                  onClick={() =>
                                    requestAction(
                                      announcement,
                                      'unpublish',
                                    )
                                  }
                                  disabled={
                                    busy
                                  }
                                >
                                  Unpublish
                                </button>
                              ) : null}

                              {announcement.status !==
                                'archived' && (
                                <button
                                  type="button"
                                  className="announcement-admin__button announcement-admin__button--small announcement-admin__button--secondary"
                                  onClick={() =>
                                    requestAction(
                                      announcement,
                                      'archive',
                                    )
                                  }
                                  disabled={
                                    busy
                                  }
                                >
                                  Archive
                                </button>
                              )}

                              <button
                                type="button"
                                className="announcement-admin__button announcement-admin__button--small announcement-admin__button--danger"
                                onClick={() =>
                                  requestAction(
                                    announcement,
                                    'delete',
                                  )
                                }
                                disabled={
                                  busy
                                }
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav
                className="announcement-admin__pagination"
                aria-label="Announcement pagination"
              >
                <button
                  type="button"
                  className="announcement-admin__button announcement-admin__button--secondary"
                  onClick={() =>
                    setCurrentPage(
                      (page) =>
                        Math.max(
                          1,
                          page - 1,
                        ),
                    )
                  }
                  disabled={
                    currentPage <=
                    1
                  }
                >
                  Previous
                </button>

                <span
                  aria-live="polite"
                >
                  Page{' '}
                  <strong>
                    {currentPage}
                  </strong>{' '}
                  of{' '}
                  <strong>
                    {totalPages}
                  </strong>
                </span>

                <button
                  type="button"
                  className="announcement-admin__button announcement-admin__button--secondary"
                  onClick={() =>
                    setCurrentPage(
                      (page) =>
                        Math.min(
                          totalPages,
                          page + 1,
                        ),
                    )
                  }
                  disabled={
                    currentPage >=
                    totalPages
                  }
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>

      {/* ======================================================================
          DELETE CONFIRMATION
          ==================================================================== */}

      {deleteCandidate && (
        <div
          className="announcement-admin__modal-backdrop"
          role="presentation"
        >
          <section
            className="announcement-admin__modal announcement-admin__modal--danger"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-announcement-title"
          >
            <header className="announcement-admin__modal-header">
              <div>
                <p className="announcement-admin__eyebrow">
                  Destructive action
                </p>

                <h2 id="delete-announcement-title">
                  Delete Announcement?
                </h2>
              </div>
            </header>

            <div className="announcement-admin__modal-body">
              <p>
                You are about to permanently
                delete:
              </p>

              <strong>
                {
                  deleteCandidate.title
                }
              </strong>

              <p>
                This action should only be
                performed when deletion is
                permitted by your governance,
                retention and audit policies.
              </p>
            </div>

            <footer className="announcement-admin__modal-footer">
              <button
                type="button"
                className="announcement-admin__button announcement-admin__button--secondary"
                onClick={() =>
                  setDeleteCandidate(
                    null,
                  )
                  }
              >
                Cancel
              </button>

              <button
                type="button"
                className="announcement-admin__button announcement-admin__button--danger"
                onClick={
                  confirmDelete
                }
                disabled={
                  actionId !==
                  null
                }
              >
                {actionId !==
                null
                  ? 'Deleting…'
                  : 'Delete Permanently'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* ======================================================================
          PREVIEW
          ==================================================================== */}

      {previewAnnouncement && (
        <AnnouncementPreview
          announcement={
            previewAnnouncement
          }
          onClose={() =>
            setPreviewAnnouncement(
              null,
            )
          }
        />
      )}

      {/* ======================================================================
          AUDIT
          ==================================================================== */}

      {auditAnnouncement && (
        <AuditModal
          announcement={
            auditAnnouncement
          }
          audit={auditEvents}
          loading={
            auditLoading
          }
          error={auditError}
          onClose={() =>
            setAuditAnnouncement(
              null,
            )
          }
        />
      )}
    </main>
  );
}

AnnouncementAdmin.propTypes = {
  pageSize:
    PropTypes.number,

  onUnauthorized:
    PropTypes.func,
};