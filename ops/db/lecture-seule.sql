-- Utilisateur en lecture seule pour les agents (serveur MCP).
-- Le mot de passe est défini à part avec \password : jamais dans ce fichier.
CREATE ROLE agentdesk_lecture LOGIN;
GRANT CONNECT ON DATABASE agentdesk TO agentdesk_lecture;
GRANT USAGE ON SCHEMA public TO agentdesk_lecture;
GRANT SELECT ON messages, classification_runs TO agentdesk_lecture;
ALTER ROLE agentdesk_lecture SET default_transaction_read_only = on;
ALTER ROLE agentdesk_lecture SET statement_timeout = '5s';