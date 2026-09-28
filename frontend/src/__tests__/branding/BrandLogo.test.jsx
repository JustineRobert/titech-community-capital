import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import BrandLogo from '../../components/BrandLogo';

describe('BrandLogo', () => {
  it('renders the official transparent brand asset by default', () => {
    render(<BrandLogo />);

    const image = screen.getByTestId('titech-brand-logo');

    expect(image).toHaveAttribute('src', '/brand/titech-community-capital-transparent.png');
    expect(image).toHaveAttribute('alt', 'TITech Community Capital');
    expect(image).toHaveAttribute('data-brand-asset-variant', 'transparent');
  });

  it('supports monochrome and decorative modes', () => {
    render(
      <BrandLogo
        variant="monochrome"
        decorative
        testId="monochrome-logo"
      />,
    );

    const image = screen.getByTestId('monochrome-logo');

    expect(image).toHaveAttribute('src', '/brand/titech-community-capital-monochrome.png');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('aria-hidden', 'true');
  });
});
