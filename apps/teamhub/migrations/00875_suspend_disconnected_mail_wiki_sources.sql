-- +goose Up
-- Disconnecting a mail Connection now takes its messages out of the Wiki.
-- Mail of a Connection already disconnected or gone stayed bound, so a
-- reconnected mailbox fed every message twice. Suspend those Bindings; the
-- next refresh withdraws the messages, and the active Connection's copies
-- remain.
UPDATE document_context_bindings binding
SET status = 'suspended', access_epoch = binding.access_epoch + 1, updated_at = clock_timestamp()
FROM wiki_source_items item
WHERE item.tenant_id = binding.tenant_id
  AND item.document_id = binding.document_id
  AND item.source_key LIKE 'mail:%'
  AND binding.binding_kind = 'wiki_source'
  AND binding.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM external_connections connection
    WHERE connection.id = split_part(item.source_key, ':', 2)
      AND connection.status NOT IN ('disconnecting', 'revoke_pending', 'revoked')
  );

-- +goose Down
-- The suspended Bindings are not restored: their Connections are gone.
SELECT 1;
