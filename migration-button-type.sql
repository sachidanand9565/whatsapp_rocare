-- Fix: messages.type ENUM was missing 'button' (and 'unsupported'), so MySQL
-- stored template-button replies with type='' — invisible to type='button'
-- queries (inbox button-reply filter / bulk resolve).
-- The code tolerates old '' rows either way; this makes the data correct.

ALTER TABLE messages MODIFY type
  ENUM('text','image','document','audio','video','template','interactive',
       'reaction','location','contacts','sticker','button','unsupported','unknown')
  DEFAULT 'text';

-- Backfill: '' inbound rows are button taps, except the 'unsupported' warning rows
UPDATE messages SET type = 'button'
 WHERE type = '' AND direction = 'inbound' AND content NOT LIKE '⚠%';

UPDATE messages SET type = 'unsupported'
 WHERE type = '' AND direction = 'inbound' AND content LIKE '⚠%';
