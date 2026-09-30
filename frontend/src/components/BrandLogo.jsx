/**
 * ============================================================================
 * TITech Community Capital — Reusable Official Logo Component
 * File: frontend/src/components/BrandLogo.jsx
 * ============================================================================
 */

'use strict';

import React, { memo } from 'react';
import PropTypes from 'prop-types';

import TITECH_BRAND, { getBrandAsset } from '../branding/brand';

const SIZE_MAP = Object.freeze({
  xs: 28,
  sm: 40,
  md: 56,
  lg: 80,
  xl: 112,
});

function BrandLogo({
  variant = 'transparent',
  size = 'sm',
  width,
  height,
  alt = TITECH_BRAND.fullName,
  decorative = false,
  className = '',
  loading = 'lazy',
  fetchPriority = 'auto',
  testId = 'titech-brand-logo',
}) {
  const resolvedSize =
    typeof size === 'number'
      ? size
      : SIZE_MAP[size] || SIZE_MAP.sm;

  const resolvedWidth = width || resolvedSize;
  const resolvedHeight = height || resolvedSize;

  return (
    <img
      src={getBrandAsset(variant)}
      alt={decorative ? '' : alt}
      aria-hidden={decorative ? 'true' : undefined}
      className={[
        'titech-brand-logo',
        `titech-brand-logo--${variant}`,
        `titech-brand-logo--${typeof size === 'string' ? size : 'custom'}`,
        className,
      ].filter(Boolean).join(' ')}
      width={resolvedWidth}
      height={resolvedHeight}
      loading={loading}
      decoding="async"
      fetchpriority={fetchPriority}
      data-testid={testId}
      data-brand-asset-variant={variant}
      data-brand-component="official-logo"
      draggable="false"
    />
  );
}

BrandLogo.propTypes = {
  variant: PropTypes.oneOf(['full', 'transparent', 'monochrome', 'icon', 'favicon']),
  size: PropTypes.oneOfType([PropTypes.oneOf(['xs', 'sm', 'md', 'lg', 'xl']), PropTypes.number]),
  width: PropTypes.number,
  height: PropTypes.number,
  alt: PropTypes.string,
  decorative: PropTypes.bool,
  className: PropTypes.string,
  loading: PropTypes.oneOf(['eager', 'lazy']),
  fetchPriority: PropTypes.oneOf(['high', 'low', 'auto']),
  testId: PropTypes.string,
};

export default memo(BrandLogo);
