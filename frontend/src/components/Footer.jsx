'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Application Footer
 * ============================================================================
 *
 * File:
 *   frontend/src/components/Footer.jsx
 *
 * Purpose:
 *   Production-grade, accessible, responsive global application footer for
 *   TITech Community Capital.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Company identity and product positioning
 * ✓ Primary application navigation
 * ✓ Legal navigation
 * ✓ Support and contact channels
 * ✓ Telephone/email accessibility
 * ✓ Semantic HTML structure
 * ✓ React Router integration
 * ✓ Safe external/action links
 * ✓ Stable test selectors
 * ✓ Automatic copyright year
 * ✓ Configurable footer sections
 * ✓ Customizable contact information
 * ✓ Graceful handling of optional content
 * ✓ Keyboard accessibility
 * ✓ Screen-reader support
 * ✓ Reduced-motion compatibility through CSS
 * ✓ TITech branding consistency
 *
 * Security boundary
 * ----------------------------------------------------------------------------
 * This component is presentation-only.
 *
 * It MUST NOT be treated as an authorization, tenant-isolation, licensing,
 * compliance, or security boundary. Sensitive backend information must never
 * be rendered directly into the footer.
 *
 * ============================================================================
 */

import React, {
  Fragment,
  memo,
  useMemo,
} from 'react';

import {
  Link,
} from 'react-router-dom';

import {
  Mail,
  MapPin,
  Phone,
  ArrowUpRight,
} from 'lucide-react';

import PropTypes from 'prop-types';

import './Footer.css';

/* ============================================================================
 * Constants
 * ========================================================================== */

export const FOOTER_CONSTANTS = Object.freeze({
  COMPANY_NAME:
    'TITech Community Capital',

  COMPANY_LEGAL_NAME:
    'TITech Community Capital LTD',

  COMPANY_DESCRIPTION:
    'Empowering communities through secure digital savings, lending, and financial management solutions.',

  CONTACT_EMAIL:
    'info@titechcommunity.app',

  SUPPORT_EMAIL:
    'support@titechcommunity.app',

  LEGAL_EMAIL:
    'legal@titechcommunity.app',

  PHONE_NUMBER:
    '+256782397907',

  DISPLAY_PHONE:
    '+256 (782) 397907',

  COMPANY_ADDRESS:
    'Plot 69-71 Jinja Road, Kampala, Uganda',

  TEST_ID:
    'titech-footer',
});

const {
  COMPANY_NAME,
  COMPANY_LEGAL_NAME,
  COMPANY_DESCRIPTION,
  CONTACT_EMAIL,
  SUPPORT_EMAIL,
  LEGAL_EMAIL,
  PHONE_NUMBER,
  DISPLAY_PHONE,
  COMPANY_ADDRESS,
  TEST_ID,
} = FOOTER_CONSTANTS;

/* ============================================================================
 * Navigation Configuration
 * ========================================================================== */

export const QUICK_LINKS = Object.freeze([
  Object.freeze({
    label: 'Dashboard',
    to: '/dashboard',
  }),

  Object.freeze({
    label: 'Savings Groups',
    to: '/groups',
  }),

  Object.freeze({
    label: 'Create Group',
    to: '/create-group',
  }),

  Object.freeze({
    label: 'Support',
    href: `mailto:${SUPPORT_EMAIL}`,
    external: true,
  }),
]);

export const LEGAL_LINKS = Object.freeze([
  Object.freeze({
    label: 'Legal Information',
    to: '/legal',
  }),

  Object.freeze({
    label: 'Terms of Service',
    to: '/terms',
  }),

  Object.freeze({
    label: 'Privacy Policy',
    to: '/privacy',
  }),

  Object.freeze({
    label: 'Contact Legal',
    href: `mailto:${LEGAL_EMAIL}`,
    external: true,
  }),
]);

export const BOTTOM_LEGAL_LINKS = Object.freeze([
  Object.freeze({
    label: 'Legal',
    to: '/legal',
  }),

  Object.freeze({
    label: 'Terms',
    to: '/terms',
  }),

  Object.freeze({
    label: 'Privacy',
    to: '/privacy',
  }),
]);

/* ============================================================================
 * Utility Helpers
 * ========================================================================== */

/**
 * Safely join CSS class names.
 */
const cn = (...values) =>
  values
    .filter(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0,
    )
    .join(' ');

/**
 * Normalizes a phone URI.
 *
 * Accepts either:
 *   +256782397907
 *   tel:+256782397907
 *   +256 782 397907
 */
const normalizePhoneHref = (
  phone,
  phoneHref,
) => {
  if (
    typeof phoneHref === 'string' &&
    phoneHref.trim()
  ) {
    return phoneHref.trim();
  }

  if (
    typeof phone !== 'string' ||
    !phone.trim()
  ) {
    return '';
  }

  const normalizedPhone =
    phone
      .trim()
      .replace(/[^\d+]/g, '');

  return normalizedPhone
    ? `tel:${normalizedPhone}`
    : '';
};

/**
 * Safely creates a mailto URI.
 */
const createMailtoHref = (
  email,
) => {
  if (
    typeof email !== 'string' ||
    !email.trim()
  ) {
    return '';
  }

  return `mailto:${email.trim()}`;
};

/* ============================================================================
 * Footer Internal Link
 * ========================================================================== */

const FooterInternalLink = memo(
  function FooterInternalLink({
    to,
    children,
    className,
    ...props
  }) {
    if (
      typeof to !== 'string' ||
      !to.trim()
    ) {
      return null;
    }

    return (
      <Link
        to={to}
        className={cn(
          'footer-link',
          className,
        )}
        {...props}
      >
        {children}
      </Link>
    );
  },
);

FooterInternalLink.displayName =
  'TITechFooterInternalLink';

FooterInternalLink.propTypes = {
  to:
    PropTypes.string.isRequired,

  children:
    PropTypes.node.isRequired,

  className:
    PropTypes.string,
};

/* ============================================================================
 * Footer External / Action Link
 * ========================================================================== */

const FooterExternalLink = memo(
  function FooterExternalLink({
    href,
    children,
    className,
    target,
    rel,
    ...props
  }) {
    if (
      typeof href !== 'string' ||
      !href.trim()
    ) {
      return null;
    }

    const isExternalHttp =
      /^https?:\/\//i.test(
        href.trim(),
      );

    return (
      <a
        href={href}
        className={cn(
          'footer-link',
          className,
        )}
        target={
          target ||
          (isExternalHttp
            ? '_blank'
            : undefined)
        }
        rel={
          rel ||
          (isExternalHttp
            ? 'noopener noreferrer'
            : undefined)
        }
        {...props}
      >
        {children}

        {isExternalHttp ? (
          <ArrowUpRight
            className="footer-external-icon"
            size={14}
            aria-hidden="true"
            focusable="false"
          />
        ) : null}
      </a>
    );
  },
);

FooterExternalLink.displayName =
  'TITechFooterExternalLink';

FooterExternalLink.propTypes = {
  href:
    PropTypes.string.isRequired,

  children:
    PropTypes.node.isRequired,

  className:
    PropTypes.string,

  target:
    PropTypes.string,

  rel:
    PropTypes.string,
};

/* ============================================================================
 * Footer Navigation Item
 * ========================================================================== */

const FooterNavLink = memo(
  function FooterNavLink({
    item,
  }) {
    if (
      !item ||
      typeof item !== 'object'
    ) {
      return null;
    }

    const {
      label,
      to,
      href,
      external = false,
    } = item;

    if (
      typeof label !== 'string' ||
      !label.trim()
    ) {
      return null;
    }

    if (
      external &&
      href
    ) {
      return (
        <FooterExternalLink
          href={href}
          aria-label={label}
        >
          {label}
        </FooterExternalLink>
      );
    }

    if (to) {
      return (
        <FooterInternalLink
          to={to}
          aria-label={label}
        >
          {label}
        </FooterInternalLink>
      );
    }

    if (href) {
      return (
        <FooterExternalLink
          href={href}
          aria-label={label}
        >
          {label}
        </FooterExternalLink>
      );
    }

    return null;
  },
);

FooterNavLink.displayName =
  'TITechFooterNavLink';

FooterNavLink.propTypes = {
  item:
    PropTypes.shape({
      label:
        PropTypes.string.isRequired,

      to:
        PropTypes.string,

      href:
        PropTypes.string,

      external:
        PropTypes.bool,
    }),
};

/* ============================================================================
 * Footer Section
 * ========================================================================== */

const FooterSection = memo(
  function FooterSection({
    title,
    links,
    headingId,
  }) {
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      !Array.isArray(links) ||
      links.length === 0
    ) {
      return null;
    }

    return (
      <section
        className="footer-section footer-navigation-section"
        aria-labelledby={headingId}
      >
        <h2
          id={headingId}
          className="footer-section-title"
        >
          {title}
        </h2>

        <ul
          className="footer-links"
          aria-label={title}
        >
          {links.map(
            (item, index) => {
              if (!item) {
                return null;
              }

              const key =
                item.to ||
                item.href ||
                item.label ||
                `footer-link-${index}`;

              return (
                <li key={key}>
                  <FooterNavLink
                    item={item}
                  />
                </li>
              );
            },
          )}
        </ul>
      </section>
    );
  },
);

FooterSection.displayName =
  'TITechFooterSection';

FooterSection.propTypes = {
  title:
    PropTypes.string.isRequired,

  links:
    PropTypes.arrayOf(
      PropTypes.shape({
        label:
          PropTypes.string.isRequired,

        to:
          PropTypes.string,

        href:
          PropTypes.string,

        external:
          PropTypes.bool,
      }),
    ).isRequired,

  headingId:
    PropTypes.string.isRequired,
};

/* ============================================================================
 * Footer Contact Action
 * ========================================================================== */

const FooterContactAction = memo(
  function FooterContactAction({
    href,
    label,
    title,
    testId,
    children,
  }) {
    if (
      !href ||
      !label
    ) {
      return null;
    }

    return (
      <a
        href={href}
        className="social-link"
        aria-label={label}
        title={title || label}
        data-testid={testId}
      >
        {children}

        <span className="sr-only">
          {label}
        </span>
      </a>
    );
  },
);

FooterContactAction.displayName =
  'TITechFooterContactAction';

FooterContactAction.propTypes = {
  href:
    PropTypes.string.isRequired,

  label:
    PropTypes.string.isRequired,

  title:
    PropTypes.string,

  testId:
    PropTypes.string,

  children:
    PropTypes.node.isRequired,
};

/* ============================================================================
 * Footer Component
 * ========================================================================== */

function Footer({
  companyName,
  companyLegalName,
  description,
  email,
  supportEmail,
  legalEmail,
  phone,
  phoneHref,
  address,
  showQuickLinks,
  showLegalLinks,
  showContact,
  showSocialActions,
  showPoweredBy,
  quickLinks,
  legalLinks,
  bottomLegalLinks,
  className,
  testId,
}) {
  const currentYear =
    new Date().getFullYear();

  const contactEmailHref =
    useMemo(
      () =>
        createMailtoHref(
          email,
        ),
      [email],
    );

  const supportEmailHref =
    useMemo(
      () =>
        createMailtoHref(
          supportEmail,
        ),
      [supportEmail],
    );

  const legalEmailHref =
    useMemo(
      () =>
        createMailtoHref(
          legalEmail,
        ),
      [legalEmail],
    );

  const resolvedPhoneHref =
    useMemo(
      () =>
        normalizePhoneHref(
          phone,
          phoneHref,
        ),
      [
        phone,
        phoneHref,
      ],
    );

  const resolvedQuickLinks =
    useMemo(
      () => {
        if (
          !Array.isArray(
            quickLinks,
          )
        ) {
          return [];
        }

        return quickLinks.map(
          (item) => {
            if (
              !item ||
              typeof item !==
                'object'
            ) {
              return item;
            }

            if (
              item.label ===
                'Support' &&
              supportEmailHref
            ) {
              return {
                ...item,
                href:
                  supportEmailHref,
              };
            }

            return item;
          },
        );
      },
      [
        quickLinks,
        supportEmailHref,
      ],
    );

  const resolvedLegalLinks =
    useMemo(
      () => {
        if (
          !Array.isArray(
            legalLinks,
          )
        ) {
          return [];
        }

        return legalLinks.map(
          (item) => {
            if (
              !item ||
              typeof item !==
                'object'
            ) {
              return item;
            }

            if (
              item.label ===
                'Contact Legal' &&
              legalEmailHref
            ) {
              return {
                ...item,
                href:
                  legalEmailHref,
              };
            }

            return item;
          },
        );
      },
      [
        legalLinks,
        legalEmailHref,
      ],
    );

  const footerClassName =
    cn(
      'footer',
      className,
    );

  return (
    <footer
      className={
        footerClassName
      }
      data-testid={testId}
      data-component="titech-footer"
      data-company="TITech"
    >
      <div className="footer-content">

        {/* ==================================================================
            Main Footer
            ================================================================== */}

        <div className="footer-main">

          {/* ================================================================
              Company Information
              ================================================================ */}

          <section
            className="footer-section footer-company"
            aria-labelledby={`${testId}-company`}
          >
            <h2
              id={`${testId}-company`}
              className="footer-title"
            >
              {companyName}
            </h2>

            <p className="footer-description">
              {description}
            </p>

            {showSocialActions ? (
              <nav
                className="footer-social"
                aria-label={`Contact ${companyName}`}
              >
                <FooterContactAction
                  href={
                    resolvedPhoneHref
                  }
                  label={`Call ${companyName}`}
                  title={`Call ${companyName}`}
                  testId="titech-footer-phone"
                >
                  <Phone
                    size={20}
                    aria-hidden="true"
                    focusable="false"
                  />
                </FooterContactAction>

                <FooterContactAction
                  href={
                    contactEmailHref
                  }
                  label={`Email ${companyName}`}
                  title={`Email ${companyName}`}
                  testId="titech-footer-email"
                >
                  <Mail
                    size={20}
                    aria-hidden="true"
                    focusable="false"
                  />
                </FooterContactAction>

                <a
                  href="#footer-contact-address"
                  className="social-link"
                  aria-label={`View ${companyName} address`}
                  title={`View ${companyName} address`}
                  data-testid="titech-footer-location"
                >
                  <MapPin
                    size={20}
                    aria-hidden="true"
                    focusable="false"
                  />

                  <span className="sr-only">
                    View address
                  </span>
                </a>
              </nav>
            ) : null}
          </section>

          {/* ================================================================
              Quick Links
              ================================================================ */}

          {showQuickLinks ? (
            <FooterSection
              title="Quick Links"
              links={
                resolvedQuickLinks
              }
              headingId={`${testId}-quick-links`}
            />
          ) : null}

          {/* ================================================================
              Legal
              ================================================================ */}

          {showLegalLinks ? (
            <FooterSection
              title="Legal"
              links={
                resolvedLegalLinks
              }
              headingId={`${testId}-legal-links`}
            />
          ) : null}

          {/* ================================================================
              Contact
              ================================================================ */}

          {showContact ? (
            <section
              className="footer-section footer-contact"
              aria-labelledby={`${testId}-contact`}
            >
              <h2
                id={`${testId}-contact`}
                className="footer-section-title"
              >
                Contact
              </h2>

              <address
                className="contact-info"
                id="footer-contact-address"
              >
                <ul>
                  {email ? (
                    <li>
                      <a
                        href={
                          contactEmailHref
                        }
                        aria-label={`Email ${companyName} at ${email}`}
                      >
                        {email}
                      </a>
                    </li>
                  ) : null}

                  {phone ? (
                    <li>
                      <a
                        href={
                          resolvedPhoneHref
                        }
                        aria-label={`Call ${companyName} at ${phone}`}
                      >
                        {phone}
                      </a>
                    </li>
                  ) : null}

                  {address ? (
                    <li>
                      <span>
                        {address}
                      </span>
                    </li>
                  ) : null}
                </ul>
              </address>

              {supportEmail ? (
                <p className="footer-support">
                  Need assistance?{' '}
                  <a
                    href={
                      supportEmailHref
                    }
                    aria-label={`Contact ${companyName} support`}
                  >
                    Contact Support
                  </a>
                </p>
              ) : null}

              {legalEmail ? (
                <span className="sr-only">
                  Legal enquiries:{' '}
                  {legalEmail}
                </span>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* ==================================================================
            Footer Bottom
            ================================================================== */}

        <div className="footer-bottom">
          <div className="footer-bottom-content">

            <p className="copyright">
              <span>
                &copy; {currentYear}{' '}
                {companyLegalName}.
              </span>{' '}
              <span>
                All rights reserved.
              </span>
            </p>

            {showLegalLinks &&
            bottomLegalLinks.length > 0 ? (
              <nav
                className="footer-legal-bottom"
                aria-label="Footer legal navigation"
              >
                {bottomLegalLinks.map(
                  (
                    item,
                    index,
                  ) => (
                    <Fragment
                      key={
                        item.to ||
                        item.href ||
                        item.label ||
                        index
                      }
                    >
                      {index > 0 ? (
                        <span
                          className="divider"
                          aria-hidden="true"
                        >
                          •
                        </span>
                      ) : null}

                      <FooterNavLink
                        item={item}
                      />
                    </Fragment>
                  ),
                )}
              </nav>
            ) : null}

            {showPoweredBy ? (
              <p className="footer-powered-by">
                <span>
                  Built for communities by
                </span>{' '}
                <strong>
                  TITech
                </strong>
              </p>
            ) : null}

          </div>
        </div>

      </div>
    </footer>
  );
}

/* ============================================================================
 * Metadata
 * ========================================================================== */

Footer.displayName =
  'TITechFooter';

/* ============================================================================
 * PropTypes
 * ========================================================================== */

Footer.propTypes = {
  companyName:
    PropTypes.string,

  companyLegalName:
    PropTypes.string,

  description:
    PropTypes.string,

  email:
    PropTypes.string,

  supportEmail:
    PropTypes.string,

  legalEmail:
    PropTypes.string,

  phone:
    PropTypes.string,

  phoneHref:
    PropTypes.string,

  address:
    PropTypes.string,

  showQuickLinks:
    PropTypes.bool,

  showLegalLinks:
    PropTypes.bool,

  showContact:
    PropTypes.bool,

  showSocialActions:
    PropTypes.bool,

  showPoweredBy:
    PropTypes.bool,

  quickLinks:
    PropTypes.arrayOf(
      PropTypes.shape({
        label:
          PropTypes.string
            .isRequired,

        to:
          PropTypes.string,

        href:
          PropTypes.string,

        external:
          PropTypes.bool,
      }),
    ),

  legalLinks:
    PropTypes.arrayOf(
      PropTypes.shape({
        label:
          PropTypes.string
            .isRequired,

        to:
          PropTypes.string,

        href:
          PropTypes.string,

        external:
          PropTypes.bool,
      }),
    ),

  bottomLegalLinks:
    PropTypes.arrayOf(
      PropTypes.shape({
        label:
          PropTypes.string
            .isRequired,

        to:
          PropTypes.string,

        href:
          PropTypes.string,

        external:
          PropTypes.bool,
      }),
    ),

  className:
    PropTypes.string,

  testId:
    PropTypes.string,
};

/* ============================================================================
 * Default Props
 * ========================================================================== */

Footer.defaultProps = {
  companyName:
    COMPANY_NAME,

  companyLegalName:
    COMPANY_LEGAL_NAME,

  description:
    COMPANY_DESCRIPTION,

  email:
    CONTACT_EMAIL,

  supportEmail:
    SUPPORT_EMAIL,

  legalEmail:
    LEGAL_EMAIL,

  phone:
    DISPLAY_PHONE,

  phoneHref:
    `tel:${PHONE_NUMBER}`,

  address:
    COMPANY_ADDRESS,

  showQuickLinks:
    true,

  showLegalLinks:
    true,

  showContact:
    true,

  showSocialActions:
    true,

  showPoweredBy:
    true,

  quickLinks:
    QUICK_LINKS,

  legalLinks:
    LEGAL_LINKS,

  bottomLegalLinks:
    BOTTOM_LEGAL_LINKS,

  className:
    '',

  testId:
    TEST_ID,
};

/* ============================================================================
 * Export
 * ========================================================================== */

export default memo(Footer);