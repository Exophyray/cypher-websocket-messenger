import React, { useState } from 'react';
import { Avatar } from './Avatar';
import { formatTime, formatBytes } from '../utils/crypto';

export function Message({ message, isOutgoing, showAvatar, isGroupChat, onContextMenu, onImageClick }) {
  const dirClass = isOutgoing ? 'outgoing' : 'incoming';
  const hash = (message.id || '').slice(0, 8);

  let statusSymbol = '✓';
  let statusClass = '';
  if (message.read_by && message.read_by.length > 0) { statusSymbol = '✓✓'; statusClass = 'read'; }
  else if (message.delivered) { statusSymbol = '✓✓'; }

  const senderUser = { display_name: message.sender_name, avatar_color: message.sender_color };

  const isImage = message.type === 'image' && message.attachment_url;
  const isFile = message.type === 'file' && message.attachment_url;

  let bubbleClass = 'bubble';
  if (message.deleted) bubbleClass += ' deleted';
  if (isImage) bubbleClass += ' with-image';
  if (isFile) bubbleClass += ' with-file';

  return (
    <div className={`message-row ${dirClass}`}>
      {!isOutgoing && showAvatar && <Avatar user={senderUser} size="sm" />}
      {!isOutgoing && !showAvatar && <div style={{ width: 30 }} />}

      <div className={bubbleClass}
        onContextMenu={e => { e.preventDefault(); onContextMenu(e, message); }}>
        {!isOutgoing && isGroupChat && showAvatar && !message.deleted && (
          <div className="bubble-sender">{message.sender_name}</div>
        )}

        {message.reply_to && (
          <div className="reply-preview">↩ {message.reply_to.content?.slice(0, 80)}</div>
        )}

        {isImage && (
          <img src={message.attachment_url} alt={message.attachment_name}
            className="msg-image"
            onClick={() => onImageClick?.(message.attachment_url)} />
        )}

        {isFile && (
          <a className="msg-file" href={message.attachment_url} download={message.attachment_name}>
            <div className="msg-file-icon">📎</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="msg-file-name">{message.attachment_name}</div>
              <div className="msg-file-size">{formatBytes(message.attachment_size)}</div>
            </div>
          </a>
        )}

        {(!isImage && !isFile) || (isImage && message.content && message.content !== message.attachment_name) ? (
          <div className="msg-content">{message.content}</div>
        ) : null}

        <div className="bubble-meta">
          <span className="encrypted-hash" title="Зашифровано E2E">{hash}</span>
          {message.edited ? <span className="edited-tag">изменено</span> : null}
          <span className="msg-time">{formatTime(Number(message.created_at))}</span>
          {isOutgoing && <span className={`msg-status ${statusClass}`}>{statusSymbol}</span>}
        </div>
      </div>
    </div>
  );
}
