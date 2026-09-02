// ============================================================================
// TITech Community Capital
// Enterprise TenantSwitcher Component
// File: src/components/ui/TenantSwitcher.jsx
// Production Grade
// ============================================================================

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import PropTypes from "prop-types";

import {
  Building2,
  ChevronDown,
  Check,
  Search,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY =
  "titech.activeTenant";

// ============================================================================
// Helpers
// ============================================================================

function getStoredTenant() {
  try {
    return localStorage.getItem(
      STORAGE_KEY
    );
  } catch {
    return null;
  }
}

function setStoredTenant(
  tenantId
) {
  try {
    if (tenantId) {
      localStorage.setItem(
        STORAGE_KEY,
        tenantId
      );
    } else {
      localStorage.removeItem(
        STORAGE_KEY
      );
    }
  } catch {
    // ignore storage failures
  }
}

// ============================================================================
// Component
// ============================================================================

function TenantSwitcher({
  tenants = [],
  value,
  placeholder = "Select tenant",
  disabled = false,
  searchable = true,
  showCode = true,
  persist = true,
  fullWidth = false,
  onChange,
  className = "",
}) {
  const [open, setOpen] =
    useState(false);

  const [search, setSearch] =
    useState("");

  const [
    selectedTenant,
    setSelectedTenant,
  ] = useState(
    value || null
  );

  // ===========================================================================
  // Sync external value
  // ===========================================================================

  useEffect(() => {
    if (value) {
      setSelectedTenant(
        value
      );
    }
  }, [value]);

  // ===========================================================================
  // Restore persisted tenant
  // ===========================================================================

  useEffect(() => {
    if (
      value ||
      !persist ||
      !tenants.length
    ) {
      return;
    }

    const stored =
      getStoredTenant();

    if (!stored) {
      return;
    }

    const tenant =
      tenants.find(
        (item) =>
          item.id ===
            stored ||
          item._id ===
            stored
      );

    if (tenant) {
      setSelectedTenant(
        tenant
      );

      onChange?.(
        tenant
      );
    }
  }, [
    tenants,
    persist,
    value,
    onChange,
  ]);

  // ===========================================================================
  // Filtered tenants
  // ===========================================================================

  const filtered =
    useMemo(() => {
      const query =
        search
          .trim()
          .toLowerCase();

      if (!query) {
        return tenants;
      }

      return tenants.filter(
        (tenant) =>
          tenant.name
            ?.toLowerCase()
            .includes(
              query
            ) ||
          tenant.code
            ?.toLowerCase()
            .includes(
              query
            )
      );
    }, [
      search,
      tenants,
    ]);

  // ===========================================================================
  // Selection
  // ===========================================================================

  const selectTenant =
    useCallback(
      (tenant) => {
        setSelectedTenant(
          tenant
        );

        if (
          persist
        ) {
          setStoredTenant(
            tenant.id ||
              tenant._id
          );
        }

        onChange?.(
          tenant
        );

        setOpen(
          false
        );
      },
      [
        onChange,
        persist,
      ]
    );

  // ===========================================================================
  // Display values
  // ===========================================================================

  const tenantName =
    selectedTenant
      ?.name ||
    placeholder;

  const containerClass =
    [
      "tt-tenant-switcher",
      fullWidth
        ? "tt-tenant-full"
        : "",
      disabled
        ? "tt-tenant-disabled"
        : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <div
      className={
        containerClass
      }
    >
      <button
        type="button"
        disabled={
          disabled
        }
        className="tt-tenant-trigger"
        onClick={() =>
          setOpen(
            (
              prev
            ) =>
              !prev
          )
        }
      >
        <div className="tt-tenant-selected">
          <Building2
            size={18}
          />

          <div>
            <div className="tt-tenant-name">
              {
                tenantName
              }
            </div>

            {showCode &&
              selectedTenant?.code && (
                <small className="tt-tenant-code">
                  {
                    selectedTenant.code
                  }
                </small>
              )}
          </div>
        </div>

        <ChevronDown
          size={18}
          className={
            open
              ? "tt-tenant-open"
              : ""
          }
        />
      </button>

      {open && (
        <div className="tt-tenant-dropdown">
          {searchable && (
            <div className="tt-tenant-search">
              <Search
                size={16}
              />

              <input
                type="text"
                placeholder="Search tenants..."
                value={
                  search
                }
                onChange={(
                  e
                ) =>
                  setSearch(
                    e.target
                      .value
                  )
                }
              />
            </div>
          )}

          <div className="tt-tenant-list">
            {!filtered.length && (
              <div className="tt-tenant-empty">
                No tenants
                found
              </div>
            )}

            {filtered.map(
              (
                tenant
              ) => {
                const id =
                  tenant.id ||
                  tenant._id;

                const active =
                  selectedTenant
                    ?.id ===
                    id ||
                  selectedTenant
                    ?._id ===
                    id;

                return (
                  <button
                    key={
                      id
                    }
                    type="button"
                    className={`tt-tenant-item ${
                      active
                        ? "active"
                        : ""
                    }`}
                    onClick={() =>
                      selectTenant(
                        tenant
                      )
                    }
                  >
                    <div>
                      <div className="tt-tenant-item-name">
                        {
                          tenant.name
                        }
                      </div>

                      {showCode &&
                        tenant.code && (
                          <small>
                            {
                              tenant.code
                            }
                          </small>
                        )}
                    </div>

                    {active && (
                      <Check
                        size={
                          16
                        }
                      />
                    )}
                  </button>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PropTypes
// ============================================================================

TenantSwitcher.propTypes =
  {
    tenants:
      PropTypes.arrayOf(
        PropTypes.shape(
          {
            id:
              PropTypes.oneOfType(
                [
                  PropTypes.string,
                  PropTypes.number,
                ]
              ),

            _id:
              PropTypes.oneOfType(
                [
                  PropTypes.string,
                  PropTypes.number,
                ]
              ),

            name:
              PropTypes.string
                .isRequired,

            code:
              PropTypes.string,
          }
        )
      ),

    value:
      PropTypes.object,

    placeholder:
      PropTypes.string,

    disabled:
      PropTypes.bool,

    searchable:
      PropTypes.bool,

    showCode:
      PropTypes.bool,

    persist:
      PropTypes.bool,

    fullWidth:
      PropTypes.bool,

    onChange:
      PropTypes.func,

    className:
      PropTypes.string,
  };

// ============================================================================
// Export
// ============================================================================

export default memo(
  TenantSwitcher
);