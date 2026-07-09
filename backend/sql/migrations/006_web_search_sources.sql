-- Store the web-search sources Sensei used to ground its answers.
-- Cached topic notes keep their sources alongside the content;
-- chat messages keep the sources for each assistant reply so they
-- reappear when a conversation is reloaded.

ALTER TABLE sensei_topic_content
    ADD COLUMN sources_json LONGTEXT NULL AFTER practice_json;
    
ALTER TABLE chat_messages
    ADD COLUMN sources_json TEXT NULL AFTER content;
