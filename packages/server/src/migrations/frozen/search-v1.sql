CREATE TABLE schema_version (version INTEGER NOT NULL);
CREATE VIRTUAL TABLE idea_search USING fts5(id UNINDEXED, title, tokenize = 'trigram');
CREATE TABLE search_rows (idea TEXT PRIMARY KEY, row INTEGER NOT NULL);
INSERT INTO schema_version (version) VALUES (1);
