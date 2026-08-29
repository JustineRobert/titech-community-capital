/**
* ============================================================================
* TITech Community Capital Ltd
* Enterprise TITechChat — Support Threads
* ============================================================================
*
* File:
* frontend/src/pages/TITechChat/SupportThreads.jsx
*
* Version:
* 3.0.0
*
* Purpose:
* Production-grade support-thread listing and navigation surface for
* TITech Community Capital's TITechChat platform.
*
* Responsibilities:
* * Display authenticated user's support conversations.
* * Support search and status filtering.
* * Support pagination.
* * Support refresh/retry workflows.
* * Provide accessible keyboard-friendly navigation.
* * Preserve selected thread state through URL query parameters.
* * Present defensive loading, empty and error states.
* * Integrate with TITech's existing API/authentication architecture.
* * Remain independent from backend authorization and tenant enforcement.
*
* Architectural boundaries
* ---
* This component is a presentation/orchestration layer.
*
* It MUST NOT:
* * authorize users;
* * determine tenant membership;
* * bypass backend access controls;
* * mutate financial records;
* * determine loan eligibility;
* * expose privileged tenant data;
* * perform financial approvals;
* * treat client-side filtering as a security boundary.
*
* Backend responsibilities remain authoritative for:
* * authentication;
* * authorization;
* * tenant isolation;
* * data validation;
* * audit logging;
* * rate limiting;
* * privacy enforcement.
*
* TITech terminology
* ---
* All legacy ACFOS terminology has intentionally been removed.
*
* ============================================================================
  */

'use strict';

import React, {
useCallback,
useEffect,
useMemo,
useRef,
useState,
} from 'react';

import PropTypes from 'prop-types';

import {
Search,
RefreshCw,
MessageCircle,
Clock3,
CheckCircle2,
AlertCircle,
ChevronLeft,
ChevronRight,
Plus,
X,
Inbox,
Filter,
SlidersHorizontal,
} from 'lucide-react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';

import api from '../../services/api';

import Spinner from '../../components/ui/Spinner';

import EmptyState from '../../components/EmptyState';

import './SupportThreads.css';

/* ============================================================================

* CONSTANTS
* ========================================================================== */

const COMPONENT_NAME =
'TITechChat.SupportThreads';

const DEFAULT_PAGE_SIZE =
20;

const MAX_PAGE_SIZE =
100;

const DEFAULT_SEARCH_LENGTH =
2;

const SEARCH_DEBOUNCE_MS =
350;

const DEFAULT_API_PATH =
'/api/chat/support/threads';

const THREAD_VIEW_PARAM =
'thread';

const PAGE_PARAM =
'page';

const SEARCH_PARAM =
'q';

const STATUS_PARAM =
'status';

const ALLOWED_STATUSES =
Object.freeze([
'all',
'open',
'pending',
'resolved',
'closed',
]);

const STATUS_LABELS =
Object.freeze({
all:
'All',


open:
  'Open',

pending:
  'Pending',

resolved:
  'Resolved',

closed:
  'Closed',


});

const STATUS_ICONS =
Object.freeze({
open:
MessageCircle,


pending:
  Clock3,

resolved:
  CheckCircle2,

closed:
  CheckCircle2,


});

const DEFAULT_TITLE =
'Support';

const DEFAULT_DESCRIPTION =
'Get help from TITech Community Capital support.';

/* ============================================================================

* UTILITY HELPERS
* ========================================================================== */

function safeString(
value,
fallback = '',
) {
if (
value === null ||
value === undefined
) {
return fallback;
}

try {
const normalized =
String(value).trim();


return normalized ||
  fallback;


} catch {
return fallback;
}
}

function safeNumber(
value,
fallback = 0,
) {
const number =
Number(value);

return Number.isFinite(number)
? number
: fallback;
}

function clampPageSize(
value,
) {
return Math.min(
Math.max(
1,
safeNumber(
value,
DEFAULT_PAGE_SIZE,
),
),
MAX_PAGE_SIZE,
);
}

function normalizeStatus(
value,
) {
const status =
safeString(
value,
'all',
).toLowerCase();

return ALLOWED_STATUSES.includes(
status,
)
? status
: 'all';
}

function normalizeThread(
thread,
) {
if (
!thread ||
typeof thread !== 'object'
) {
return null;
}

const id =
safeString(
thread.id ||
thread._id ||
thread.threadId ||
thread.conversationId,
);

if (!id) {
return null;
}

return {
...thread,


id,

title:
  safeString(
    thread.title ||
      thread.subject ||
      thread.name,
    'Support conversation',
  ),

subject:
  safeString(
    thread.subject ||
      thread.title,
    'Support conversation',
  ),

status:
  normalizeStatus(
    thread.status,
  ),

preview:
  safeString(
    thread.preview ||
      thread.lastMessagePreview ||
      thread.lastMessage ||
      thread.latestMessage?.content,
    '',
  ),

unreadCount:
  Math.max(
    0,
    safeNumber(
      thread.unreadCount,
      0,
    ),
  ),

messageCount:
  Math.max(
    0,
    safeNumber(
      thread.messageCount,
      0,
    ),
  ),

updatedAt:
  thread.updatedAt ||
  thread.lastMessageAt ||
  thread.createdAt ||
  null,

createdAt:
  thread.createdAt ||
  null,


};
}

function extractThreads(
response,
) {
const payload =
response?.data ??
response ??
{};

const candidates = [
payload?.threads,
payload?.data?.threads,
payload?.data,
payload?.items,
payload?.results,
];

for (
const candidate of candidates
) {
if (
Array.isArray(candidate)
) {
return candidate
.map(normalizeThread)
.filter(Boolean);
}
}

return [];
}

function extractPagination(
response,
fallbackPage,
fallbackPageSize,
) {
const payload =
response?.data ??
response ??
{};

const pagination =
payload?.pagination ||
payload?.data?.pagination ||
{};

const page =
Math.max(
1,
safeNumber(
pagination.page ||
pagination.currentPage ||
payload?.page,
fallbackPage,
),
);

const pageSize =
clampPageSize(
pagination.limit ||
pagination.pageSize ||
payload?.pageSize ||
fallbackPageSize,
);

const total =
Math.max(
0,
safeNumber(
pagination.total ||
payload?.total,
0,
),
);

const totalPages =
Math.max(
1,
safeNumber(
pagination.totalPages,
Math.ceil(
total /
pageSize,
) || 1,
),
);

return {
page,
pageSize,
total,
totalPages,
};
}

function extractApiError(
error,
) {
return safeString(
error?.response?.data?.message ||
error?.response?.data?.error ||
error?.message,
'Unable to load support conversations. Please try again.',
);
}

function formatDate(
value,
) {
if (!value) {
return 'Unknown date';
}

const date =
new Date(value);

if (
Number.isNaN(
date.getTime(),
)
) {
return 'Unknown date';
}

try {
return new Intl.DateTimeFormat(
undefined,
{
dateStyle:
'medium',
timeStyle:
'short',
},
).format(date);
} catch {
return date.toLocaleString();
}
}

function formatRelativeDate(
value,
) {
if (!value) {
return '';
}

const timestamp =
new Date(value).getTime();

if (
!Number.isFinite(
timestamp,
)
) {
return '';
}

const difference =
Date.now() -
timestamp;

const minute =
60 * 1000;

const hour =
60 * minute;

const day =
24 * hour;

if (
difference < minute
) {
return 'Just now';
}

if (
difference < hour
) {
return `${Math.floor(
      difference / minute,
    )}m ago`;
}

if (
difference < day
) {
return `${Math.floor(
      difference / hour,
    )}h ago`;
}

if (
difference <
7 * day
) {
return `${Math.floor(
      difference / day,
    )}d ago`;
}

return formatDate(value);
}

function buildQueryString({
page,
search,
status,
}) {
const params =
new URLSearchParams();

if (
page > 1
) {
params.set(
PAGE_PARAM,
String(page),
);
}

if (
search
) {
params.set(
SEARCH_PARAM,
search,
);
}

if (
status &&
status !== 'all'
) {
params.set(
STATUS_PARAM,
status,
);
}

return params.toString();
}

/* ============================================================================

* STATUS BADGE
* ========================================================================== */

function StatusBadge({
status,
}) {
const normalizedStatus =
normalizeStatus(status);

const Icon =
STATUS_ICONS[
normalizedStatus
] || MessageCircle;

return (
<span
className={`titech-support-status titech-support-status--${normalizedStatus}`}
title={
STATUS_LABELS[
normalizedStatus
]
}
> <Icon
     size={14}
     aria-hidden="true"
   />


  <span>
    {
      STATUS_LABELS[
        normalizedStatus
      ]
    }
  </span>
</span>


);
}

StatusBadge.propTypes = {
status:
PropTypes.string,
};

/* ============================================================================

* THREAD CARD
* ========================================================================== */

function SupportThreadCard({
thread,
active,
onOpen,
}) {
const unread =
thread.unreadCount >
0;

return (
<article
className={`titech-support-thread-card${
        active
          ? ' is-active'
          : ''
      }${
        unread
          ? ' has-unread'
          : ''
      }`}
data-testid={`titech-support-thread-${thread.id}`}
>
<button
type="button"
className="titech-support-thread-card__button"
onClick={() =>
onOpen(thread)
}
aria-current={
active
? 'page'
: undefined
}
aria-label={`Open support conversation: ${thread.title}`}
> <span className="titech-support-thread-card__icon"> <MessageCircle
         size={20}
         aria-hidden="true"
       /> </span>


    <span className="titech-support-thread-card__content">
      <span className="titech-support-thread-card__top">
        <strong className="titech-support-thread-card__title">
          {thread.title}
        </strong>

        <time
          className="titech-support-thread-card__time"
          dateTime={
            thread.updatedAt
              ? new Date(
                  thread.updatedAt,
                ).toISOString()
              : undefined
          }
          title={
            thread.updatedAt
              ? formatDate(
                  thread.updatedAt,
                )
              : undefined
          }
        >
          {formatRelativeDate(
            thread.updatedAt,
          )}
        </time>
      </span>

      <span className="titech-support-thread-card__preview">
        {thread.preview ||
          'No messages yet.'}
      </span>

      <span className="titech-support-thread-card__bottom">
        <StatusBadge
          status={
            thread.status
          }
        />

        {thread.messageCount >
          0 && (
          <span className="titech-support-thread-card__count">
            {thread.messageCount}{' '}
            {thread.messageCount ===
            1
              ? 'message'
              : 'messages'}
          </span>
        )}

        {unread && (
          <span
            className="titech-support-thread-card__unread"
            aria-label={`${thread.unreadCount} unread messages`}
          >
            {thread.unreadCount >
            99
              ? '99+'
              : thread.unreadCount}{' '}
            unread
          </span>
        )}
      </span>
    </span>
  </button>
</article>


);
}

SupportThreadCard.propTypes = {
thread:
PropTypes.shape({
id:
PropTypes.oneOfType([
PropTypes.string,
PropTypes.number,
]).isRequired,


  title:
    PropTypes.string,

  preview:
    PropTypes.string,

  status:
    PropTypes.string,

  unreadCount:
    PropTypes.number,

  messageCount:
    PropTypes.number,

  updatedAt:
    PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.number,
    ]),
}).isRequired,


active:
PropTypes.bool,

onOpen:
PropTypes.func.isRequired,
};

/* ============================================================================

* COMPONENT
* ========================================================================== */

export default function SupportThreads({
apiPath = DEFAULT_API_PATH,
pageSize: requestedPageSize = DEFAULT_PAGE_SIZE,
title = DEFAULT_TITLE,
description = DEFAULT_DESCRIPTION,
onThreadSelect,
onCreateThread,
initialStatus = 'all',
initialSearch = '',
showSearch = true,
showFilters = true,
showRefresh = true,
showCreate = true,
className = '',
}) {
const navigate =
useNavigate();

const [
searchParams,
setSearchParams,
] = useSearchParams();

const auth =
useAuth?.() || {};

const user =
auth.user || null;

const mountedRef =
useRef(true);

const searchInputRef =
useRef(null);

const searchTimerRef =
useRef(null);

const requestSequenceRef =
useRef(0);

const pageSize =
clampPageSize(
requestedPageSize,
);

const urlSearch =
safeString(
searchParams.get(
SEARCH_PARAM,
),
);

const urlStatus =
normalizeStatus(
searchParams.get(
STATUS_PARAM,
) ||
initialStatus,
);

const urlPage =
Math.max(
1,
safeNumber(
searchParams.get(
PAGE_PARAM,
),
1,
),
);

const selectedThreadId =
safeString(
searchParams.get(
THREAD_VIEW_PARAM,
),
);

const [
searchInput,
setSearchInput,
] = useState(
urlSearch ||
initialSearch ||
'',
);

const [
appliedSearch,
setAppliedSearch,
] = useState(
urlSearch ||
initialSearch ||
'',
);

const [
status,
setStatus,
] = useState(
urlStatus,
);

const [
page,
setPage,
] = useState(
urlPage,
);

const [
threads,
setThreads,
] = useState([]);

const [
pagination,
setPagination,
] = useState({
page:
urlPage,
pageSize,
total:
0,
totalPages:
1,
});

const [
loading,
setLoading,
] = useState(true);

const [
refreshing,
setRefreshing,
] = useState(false);

const [
error,
setError,
] = useState(null);

const [
filterOpen,
setFilterOpen,
] = useState(false);

const [
lastUpdated,
setLastUpdated,
] = useState(null);

/* ==========================================================================

* LIFECYCLE
* ======================================================================== */

useEffect(() => {
mountedRef.current =
true;


return () => {
  mountedRef.current =
    false;

  if (
    searchTimerRef.current
  ) {
    window.clearTimeout(
      searchTimerRef.current,
    );
  }
};


}, []);

/* ==========================================================================

* URL SYNCHRONIZATION
* ======================================================================== */

const synchronizeUrl =
useCallback(
({
nextPage = page,
nextSearch = appliedSearch,
nextStatus = status,
nextThreadId = selectedThreadId,
} = {}) => {
const query =
buildQueryString({
page:
nextPage,
search:
safeString(
nextSearch,
),
status:
normalizeStatus(
nextStatus,
),
});


    const params =
      new URLSearchParams(
        query,
      );

    if (
      nextThreadId
    ) {
      params.set(
        THREAD_VIEW_PARAM,
        nextThreadId,
      );
    }

    setSearchParams(
      params,
      {
        replace: true,
      },
    );
  },
  [
    appliedSearch,
    page,
    selectedThreadId,
    setSearchParams,
    status,
  ],
);


/* ==========================================================================

* LOAD THREADS
* ======================================================================== */

const loadThreads =
useCallback(
async ({
requestedPage = page,
requestedSearch = appliedSearch,
requestedStatus = status,
silent = false,
} = {}) => {
const requestId =
++requestSequenceRef.current;


    if (
      silent
    ) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const params = {
        page:
          requestedPage,
        limit:
          pageSize,
      };

      if (
        safeString(
          requestedSearch,
        ).length >=
        DEFAULT_SEARCH_LENGTH
      ) {
        params.q =
          safeString(
            requestedSearch,
          );
      }

      if (
        requestedStatus &&
        requestedStatus !==
          'all'
      ) {
        params.status =
          requestedStatus;
      }

      const response =
        await api.get(
          apiPath,
          {
            params,
          },
        );

      if (
        !mountedRef.current ||
        requestId !==
          requestSequenceRef.current
      ) {
        return;
      }

      const normalizedThreads =
        extractThreads(
          response,
        );

      const nextPagination =
        extractPagination(
          response,
          requestedPage,
          pageSize,
        );

      setThreads(
        normalizedThreads,
      );

      setPagination(
        nextPagination,
      );

      setPage(
        nextPagination.page,
      );

      setLastUpdated(
        new Date(),
      );
    } catch (
      requestError
    ) {
      if (
        !mountedRef.current ||
        requestId !==
          requestSequenceRef.current
      ) {
        return;
      }

      setError(
        extractApiError(
          requestError,
        ),
      );
    } finally {
      if (
        mountedRef.current &&
        requestId ===
          requestSequenceRef.current
      ) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  },
  [
    apiPath,
    appliedSearch,
    page,
    pageSize,
    status,
  ],
);


useEffect(() => {
loadThreads();


return () => {
  requestSequenceRef.current +=
    1;
};


}, [
loadThreads,
]);

/* ==========================================================================

* SEARCH
* ======================================================================== */

const commitSearch =
useCallback(
(value) => {
const normalized =
safeString(value);


    setAppliedSearch(
      normalized,
    );

    setPage(1);

    synchronizeUrl({
      nextPage:
        1,
      nextSearch:
        normalized,
      nextStatus:
        status,
      nextThreadId:
        selectedThreadId,
    });
  },
  [
    selectedThreadId,
    status,
    synchronizeUrl,
  ],
);


const handleSearchChange =
useCallback(
(event) => {
const value =
event.target.value;


    setSearchInput(
      value,
    );

    if (
      searchTimerRef.current
    ) {
      window.clearTimeout(
        searchTimerRef.current,
      );
    }

    searchTimerRef.current =
      window.setTimeout(
        () => {
          commitSearch(
            value,
          );
        },
        SEARCH_DEBOUNCE_MS,
      );
  },
  [
    commitSearch,
  ],
);


const handleSearchSubmit =
useCallback(
(event) => {
event.preventDefault();


    if (
      searchTimerRef.current
    ) {
      window.clearTimeout(
        searchTimerRef.current,
      );
    }

    commitSearch(
      searchInput,
    );
  },
  [
    commitSearch,
    searchInput,
  ],
);


const clearSearch =
useCallback(() => {
if (
searchTimerRef.current
) {
window.clearTimeout(
searchTimerRef.current,
);
}


  setSearchInput(
    '',
  );

  commitSearch(
    '',
  );

  searchInputRef.current?.focus();
}, [
  commitSearch,
]);


/* ==========================================================================

* STATUS FILTER
* ======================================================================== */

const handleStatusChange =
useCallback(
(nextStatus) => {
const normalized =
normalizeStatus(
nextStatus,
);


    setStatus(
      normalized,
    );

    setPage(1);

    synchronizeUrl({
      nextPage:
        1,
      nextSearch:
        appliedSearch,
      nextStatus:
        normalized,
      nextThreadId:
        selectedThreadId,
    });

    setFilterOpen(
      false,
    );
  },
  [
    appliedSearch,
    selectedThreadId,
    synchronizeUrl,
  ],
);


/* ==========================================================================

* REFRESH
* ======================================================================== */

const handleRefresh =
useCallback(() => {
loadThreads({
requestedPage:
page,
requestedSearch:
appliedSearch,
requestedStatus:
status,
silent: true,
});
}, [
appliedSearch,
loadThreads,
page,
status,
]);

/* ==========================================================================

* THREAD NAVIGATION
* ======================================================================== */

const handleThreadOpen =
useCallback(
(thread) => {
const threadId =
safeString(
thread?.id,
);


    if (!threadId) {
      return;
    }

    synchronizeUrl({
      nextPage:
        page,
      nextSearch:
        appliedSearch,
      nextStatus:
        status,
      nextThreadId:
        threadId,
    });

    if (
      typeof onThreadSelect ===
      'function'
    ) {
      onThreadSelect(
        thread,
      );
    }
  },
  [
    appliedSearch,
    onThreadSelect,
    page,
    status,
    synchronizeUrl,
  ],
);


const handleCreate =
useCallback(() => {
if (
typeof onCreateThread ===
'function'
) {
onCreateThread();
return;
}


  navigate(
    '/titech-chat/support/new',
  );
}, [
  navigate,
  onCreateThread,
]);


const clearSelectedThread =
useCallback(() => {
synchronizeUrl({
nextPage:
page,
nextSearch:
appliedSearch,
nextStatus:
status,
nextThreadId:
'',
});
}, [
appliedSearch,
page,
status,
synchronizeUrl,
]);

/* ==========================================================================

* PAGINATION
* ======================================================================== */

const goToPage =
useCallback(
(nextPage) => {
const safePage =
Math.min(
Math.max(
1,
nextPage,
),
pagination.totalPages,
);


    if (
      safePage ===
      page
    ) {
      return;
    }

    setPage(
      safePage,
    );

    synchronizeUrl({
      nextPage:
        safePage,
      nextSearch:
        appliedSearch,
      nextStatus:
        status,
      nextThreadId:
        selectedThreadId,
    });
  },
  [
    appliedSearch,
    page,
    pagination.totalPages,
    selectedThreadId,
    status,
    synchronizeUrl,
  ],
);


/* ==========================================================================

* DERIVED STATE
* ======================================================================== */

const activeThread =
useMemo(
() =>
threads.find(
(thread) =>
String(
thread.id,
) ===
String(
selectedThreadId,
),
) || null,
[
selectedThreadId,
threads,
],
);

const hasFilters =
Boolean(
appliedSearch ||
status !==
'all',
);

const showingFrom =
pagination.total ===
0
? 0
: (pagination.page -
1) *
pagination.pageSize +
1;

const showingTo =
Math.min(
pagination.page *
pagination.pageSize,
pagination.total,
);

const statusOptions =
useMemo(
() =>
ALLOWED_STATUSES.map(
(value) => ({
value,
label:
STATUS_LABELS[
value
],
}),
),
[],
);

/* ==========================================================================

* KEYBOARD ACCESSIBILITY
* ======================================================================== */

const handleSearchKeyDown =
useCallback(
(event) => {
if (
event.key ===
'Escape'
) {
if (
searchInput
) {
clearSearch();
}
}
},
[
clearSearch,
searchInput,
],
);

/* ==========================================================================

* RENDER
* ======================================================================== */

const rootClassName =
[
'titech-support-threads',
className,
]
.filter(Boolean)
.join(' ');

return (
<section
className={
rootClassName
}
aria-labelledby="titech-support-threads-title"
data-testid="titech-support-threads"
>
{/* ======================================================================
HEADER
==================================================================== */}


  <header className="titech-support-threads__header">
    <div className="titech-support-threads__heading">
      <div className="titech-support-threads__icon">
        <MessageCircle
          size={24}
          aria-hidden="true"
        />
      </div>

      <div>
        <h1
          id="titech-support-threads-title"
          className="titech-support-threads__title"
        >
          {title}
        </h1>

        <p className="titech-support-threads__description">
          {description}
        </p>
      </div>
    </div>

    <div className="titech-support-threads__header-actions">
      {showRefresh && (
        <button
          type="button"
          className="titech-support-action titech-support-action--secondary"
          onClick={
            handleRefresh
          }
          disabled={
            loading ||
            refreshing
          }
          aria-label="Refresh support conversations"
          title="Refresh support conversations"
        >
          <RefreshCw
            size={18}
            aria-hidden="true"
            className={
              refreshing
                ? 'is-spinning'
                : ''
            }
          />

          <span className="titech-support-action__label">
            Refresh
          </span>
        </button>
      )}

      {showCreate && (
        <button
          type="button"
          className="titech-support-action titech-support-action--primary"
          onClick={
            handleCreate
          }
        >
          <Plus
            size={18}
            aria-hidden="true"
          />

          <span>
            New Support Request
          </span>
        </button>
      )}
    </div>
  </header>

  {/* ======================================================================
      TOOLBAR
      ==================================================================== */}

  <div className="titech-support-threads__toolbar">
    {showSearch && (
      <form
        className="titech-support-search"
        onSubmit={
          handleSearchSubmit
        }
        role="search"
        aria-label="Search support conversations"
      >
        <Search
          size={18}
          aria-hidden="true"
          className="titech-support-search__icon"
        />

        <input
          ref={
            searchInputRef
          }
          type="search"
          value={
            searchInput
          }
          onChange={
            handleSearchChange
          }
          onKeyDown={
            handleSearchKeyDown
          }
          placeholder="Search support conversations..."
          aria-label="Search support conversations"
          autoComplete="off"
          spellCheck="false"
        />

        {searchInput && (
          <button
            type="button"
            className="titech-support-search__clear"
            onClick={
              clearSearch
            }
            aria-label="Clear search"
            title="Clear search"
          >
            <X
              size={16}
              aria-hidden="true"
            />
          </button>
        )}

        <button
          type="submit"
          className="titech-support-search__submit"
          aria-label="Search"
        >
          Search
        </button>
      </form>
    )}

    {showFilters && (
      <div className="titech-support-filter">
        <button
          type="button"
          className={`titech-support-filter__trigger${
            filterOpen
              ? ' is-open'
              : ''
          }`}
          onClick={() =>
            setFilterOpen(
              (value) =>
                !value,
            )
          }
          aria-expanded={
            filterOpen
          }
          aria-controls="titech-support-status-filter"
        >
          <SlidersHorizontal
            size={18}
            aria-hidden="true"
          />

          <span>
            {STATUS_LABELS[
              status
            ]}
          </span>

          <Filter
            size={14}
            aria-hidden="true"
          />
        </button>

        {filterOpen && (
          <div
            id="titech-support-status-filter"
            className="titech-support-filter__menu"
            role="menu"
            aria-label="Support conversation status"
          >
            {statusOptions.map(
              (option) => (
                <button
                  key={
                    option.value
                  }
                  type="button"
                  className={`titech-support-filter__option${
                    status ===
                    option.value
                      ? ' is-active'
                      : ''
                  }`}
                  onClick={() =>
                    handleStatusChange(
                      option.value,
                    )
                  }
                  role="menuitemradio"
                  aria-checked={
                    status ===
                    option.value
                  }
                >
                  {option.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    )}
  </div>

  {/* ======================================================================
      FILTER SUMMARY
      ==================================================================== */}

  {hasFilters && (
    <div className="titech-support-threads__filter-summary">
      <span>
        {appliedSearch && (
          <>
            Search:{' '}
            <strong>
              “{appliedSearch}”
            </strong>
          </>
        )}

        {appliedSearch &&
          status !==
            'all' && (
            <span>
              {' '}
              ·{' '}
            </span>
          )}

        {status !==
          'all' && (
          <>
            Status:{' '}
            <strong>
              {
                STATUS_LABELS[
                  status
                ]
              }
            </strong>
          </>
        )}
      </span>

      <button
        type="button"
        onClick={() => {
          clearSearch();
          handleStatusChange(
            'all',
          );
        }}
      >
        Clear filters
      </button>
    </div>
  )}

  {/* ======================================================================
      ERROR
      ==================================================================== */}

  {error && (
    <div
      className="titech-support-threads__error"
      role="alert"
    >
      <AlertCircle
        size={20}
        aria-hidden="true"
      />

      <div className="titech-support-threads__error-content">
        <strong>
          Support conversations could not be loaded.
        </strong>

        <span>
          {error}
        </span>
      </div>

      <button
        type="button"
        onClick={() =>
          loadThreads({
            requestedPage:
              page,
            requestedSearch:
              appliedSearch,
            requestedStatus:
              status,
          })
        }
      >
        Try again
      </button>
    </div>
  )}

  {/* ======================================================================
      CONTENT
      ==================================================================== */}

  <div className="titech-support-threads__content">
    {loading ? (
      <div
        className="titech-support-threads__loading"
        role="status"
        aria-live="polite"
        aria-label="Loading support conversations"
      >
        <Spinner />

        <span>
          Loading support conversations...
        </span>
      </div>
    ) : threads.length ===
      0 ? (
      <EmptyState
        title={
          hasFilters
            ? 'No matching conversations'
            : 'No support conversations yet'
        }
        description={
          hasFilters
            ? 'Try a different search term or clear your filters.'
            : 'Start a support request when you need assistance from TITech Community Capital.'
        }
        icon={
          hasFilters
            ? Search
            : Inbox
        }
        action={
          hasFilters
            ? clearSearch
            : showCreate
              ? handleCreate
              : undefined
        }
        actionLabel={
          hasFilters
            ? 'Clear filters'
            : 'Start support request'
        }
      />
    ) : (
      <>
        <div
          className="titech-support-threads__list"
          aria-live="polite"
        >
          {threads.map(
            (thread) => (
              <SupportThreadCard
                key={
                  thread.id
                }
                thread={
                  thread
                }
                active={
                  String(
                    thread.id,
                  ) ===
                  String(
                    selectedThreadId,
                  )
                }
                onOpen={
                  handleThreadOpen
                }
              />
            ),
          )}
        </div>

        {/* ================================================================
            ACTIVE THREAD CONTEXT
            ============================================================ */}

        {activeThread && (
          <div
            className="titech-support-threads__selected"
            aria-live="polite"
          >
            <div>
              <span>
                Selected conversation
              </span>

              <strong>
                {
                  activeThread.title
                }
              </strong>
            </div>

            <button
              type="button"
              onClick={
                clearSelectedThread
              }
              aria-label="Clear selected support conversation"
            >
              <X
                size={16}
                aria-hidden="true"
              />

              Close
            </button>
          </div>
        )}
      </>
    )}
  </div>

  {/* ======================================================================
      PAGINATION
      ==================================================================== */}

  {!loading &&
    threads.length >
      0 && (
      <footer className="titech-support-threads__footer">
        <div className="titech-support-threads__results">
          Showing{' '}
          <strong>
            {showingFrom}
          </strong>{' '}
         –{' '}
          <strong>
            {showingTo}
          </strong>{' '}
          of{' '}
          <strong>
            {pagination.total}
          </strong>{' '}
          conversations

          {lastUpdated && (
            <span className="titech-support-threads__updated">
              · Updated{' '}
              {formatRelativeDate(
                lastUpdated,
              )}
            </span>
          )}
        </div>

        {pagination.totalPages >
          1 && (
          <nav
            className="titech-support-pagination"
            aria-label="Support conversation pagination"
          >
            <button
              type="button"
              onClick={() =>
                goToPage(
                  page - 1,
                )
              }
              disabled={
                page <=
                1
              }
              aria-label="Previous page"
            >
              <ChevronLeft
                size={18}
                aria-hidden="true"
              />

              <span>
                Previous
              </span>
            </button>

            <span
              className="titech-support-pagination__current"
              aria-current="page"
            >
              Page{' '}
              <strong>
                {page}
              </strong>{' '}
              of{' '}
              <strong>
                {
                  pagination.totalPages
                }
              </strong>
            </span>

            <button
              type="button"
              onClick={() =>
                goToPage(
                  page + 1,
                )
              }
              disabled={
                page >=
                pagination.totalPages
              }
              aria-label="Next page"
            >
              <span>
                Next
              </span>

              <ChevronRight
                size={18}
                aria-hidden="true"
              />
            </button>
          </nav>
        )}
      </footer>
    )}

  {/* ======================================================================
      SCREEN READER STATUS
      ==================================================================== */}

  <div
    className="titech-visually-hidden"
    aria-live="polite"
    aria-atomic="true"
  >
    {loading
      ? 'Loading support conversations.'
      : error
        ? error
        : `${pagination.total} support conversations available.`}
  </div>

  {/* ======================================================================
      AUTH CONTEXT
      ==================================================================== */}

  <span
    className="titech-visually-hidden"
    aria-hidden="true"
    data-user-authenticated={
      user
        ? 'true'
        : 'false'
    }
  />
</section>


);
}

/* ============================================================================

* PROP TYPES
* ========================================================================== */

SupportThreads.propTypes = {
apiPath:
PropTypes.string,

pageSize:
PropTypes.number,

title:
PropTypes.string,

description:
PropTypes.string,

onThreadSelect:
PropTypes.func,

onCreateThread:
PropTypes.func,

initialStatus:
PropTypes.oneOf(
ALLOWED_STATUSES,
),

initialSearch:
PropTypes.string,

showSearch:
PropTypes.bool,

showFilters:
PropTypes.bool,

showRefresh:
PropTypes.bool,

showCreate:
PropTypes.bool,

className:
PropTypes.string,
};