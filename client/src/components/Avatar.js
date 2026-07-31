import React from 'react';
import { getInitials } from '../utils/crypto';

export function Avatar({ user, size = '', online }) {
  if (!user) return null;
  const color = user.avatar_color || 'purple';
  const display = user.display_name || user.name || '?';
  return (
    <div className={`avatar av-${color} ${size} ${online ? 'online' : ''}`}>
      {getInitials(display)}
    </div>
  );
}
