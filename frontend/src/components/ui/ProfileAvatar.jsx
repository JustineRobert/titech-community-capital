import React, { useState } from 'react';
import PropTypes from 'prop-types';

import {
  getUserAvatarUrl,
  getUserDisplayName,
  getUserInitials,
} from '../../utils/userAvatar.mjs';

import './ProfileAvatar.css';

/**
 * Shared, presentation-only avatar for authenticated TITech user surfaces.
 * Uses an available profile image and falls back to initials on missing or
 * failed image loads. It does not read/write authentication tokens or storage.
 */
export default function ProfileAvatar({
  user,
  name,
  size = 'md',
  className = '',
  ariaLabel,
}) {
  const displayName = name?.trim() || getUserDisplayName(user);
  const avatarUrl = getUserAvatarUrl(user);
  const [failedUrl, setFailedUrl] = useState(null);
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);

  return (
    <span
      className={[
        'titech-profile-avatar',
        `titech-profile-avatar--${size}`,
        className,
      ].filter(Boolean).join(' ')}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel || undefined}
      aria-hidden={ariaLabel ? undefined : true}
      data-avatar-source={showImage ? 'profile' : 'initials'}
    >
      {showImage ? (
        <img
          className="titech-profile-avatar__image"
          src={avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        <span className="titech-profile-avatar__initials" aria-hidden="true">
          {getUserInitials(displayName)}
        </span>
      )}
    </span>
  );
}

ProfileAvatar.propTypes = {
  user: PropTypes.object,
  name: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  className: PropTypes.string,
  ariaLabel: PropTypes.string,
};
