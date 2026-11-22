-- +goose Up
-- Keenable takes an optional web search key and may be the chosen default;
-- without a key it searches through its keyless routes.
ALTER TABLE web_search_keys DROP CONSTRAINT web_search_keys_backend_check;
ALTER TABLE web_search_keys ADD CONSTRAINT web_search_keys_backend_check CHECK (
    backend IN ('you', 'tavily', 'brave', 'firecrawl', 'exa', 'keenable')
);
ALTER TABLE web_search_settings DROP CONSTRAINT web_search_settings_default_backend_check;
ALTER TABLE web_search_settings ADD CONSTRAINT web_search_settings_default_backend_check CHECK (
    default_backend IN ('you', 'tavily', 'brave', 'firecrawl', 'exa', 'duckduckgo', 'keenable')
);

-- +goose Down
DELETE FROM web_search_keys WHERE backend = 'keenable';
UPDATE web_search_settings SET default_backend = NULL WHERE default_backend = 'keenable';
ALTER TABLE web_search_keys DROP CONSTRAINT web_search_keys_backend_check;
ALTER TABLE web_search_keys ADD CONSTRAINT web_search_keys_backend_check CHECK (
    backend IN ('you', 'tavily', 'brave', 'firecrawl', 'exa')
);
ALTER TABLE web_search_settings DROP CONSTRAINT web_search_settings_default_backend_check;
ALTER TABLE web_search_settings ADD CONSTRAINT web_search_settings_default_backend_check CHECK (
    default_backend IN ('you', 'tavily', 'brave', 'firecrawl', 'exa', 'duckduckgo')
);
