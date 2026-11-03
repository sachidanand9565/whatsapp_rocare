-- Fix: messages.type ENUM was missing 'button' (and 'unsupported'), so MySQL
-- stored template-button replies with type='' — invisible to type='button'
-- queries (inbox button-reply filter / bulk resolve).
-- The code tolerates old '' rows either way; this makes the data correct.
-- Shared DB: both panels already handle type='button'.

-- New values go at the END of the list: MariaDB/MySQL then change it instantly
-- (metadata only). Inserting them mid-list rebuilds the whole messages table
-- and holds up every client's incoming messages until it finishes.
ALTER TABLE messages MODIFY type
  ENUM('text','image','document','audio','video','template','interactive',
       'reaction','location','contacts','sticker','unknown','button','unsupported')
  DEFAULT 'text';

-- Backfill (optional, quiet hour — touches many rows): '' inbound rows are
-- button taps, except the 'unsupported' warning rows and call records
-- ('{"__type":"call"…}' — 'call' isn't in the ENUM either)
UPDATE messages SET type = 'button'
 WHERE type = '' AND direction = 'inbound' AND content NOT LIKE '⚠%' AND content NOT LIKE '{%';

UPDATE messages SET type = 'unsupported'
 WHERE type = '' AND direction = 'inbound' AND content LIKE '⚠%';
