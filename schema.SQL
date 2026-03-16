-- ═══════════════════════════════════════════════════════
--  Vididrop — Schéma SQL (MySQL / PostgreSQL / SQLite)
--  Utilise ce fichier pour configurer une vraie base de
--  données en production à la place du fichier JSON.
-- ═══════════════════════════════════════════════════════

-- ── Créer la base (MySQL uniquement) ─────────────────
CREATE DATABASE IF NOT EXISTS vididrop
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE vididrop;

-- ── Table : utilisateurs ──────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          VARCHAR(36)   PRIMARY KEY DEFAULT (UUID()),
  username    VARCHAR(50)   NOT NULL UNIQUE,
  email       VARCHAR(255)  NOT NULL UNIQUE,
  password    VARCHAR(255)  NOT NULL,        -- bcrypt hash
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  downloads   INT           NOT NULL DEFAULT 0,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,

  INDEX idx_email    (email),
  INDEX idx_username (username)
);

-- ── Table : téléchargements ───────────────────────────
CREATE TABLE IF NOT EXISTS downloads (
  id          VARCHAR(36)   PRIMARY KEY DEFAULT (UUID()),
  user_id     VARCHAR(36)   NOT NULL,
  url         TEXT          NOT NULL,
  quality     VARCHAR(10)   NOT NULL DEFAULT 'max',
  instance    VARCHAR(255),
  filename    VARCHAR(255),
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id   (user_id),
  INDEX idx_created   (created_at)
);

-- ── Table : sessions (optionnel, si pas JWT) ──────────
CREATE TABLE IF NOT EXISTS sessions (
  id          VARCHAR(36)   PRIMARY KEY DEFAULT (UUID()),
  user_id     VARCHAR(36)   NOT NULL,
  token_hash  VARCHAR(255)  NOT NULL,
  expires_at  DATETIME      NOT NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address  VARCHAR(45),
  user_agent  TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_token    (token_hash),
  INDEX idx_expires  (expires_at)
);

-- ════════════════════════════════════════════════════════
--  Requêtes utiles
-- ════════════════════════════════════════════════════════

-- Tous les utilisateurs
-- SELECT id, username, email, downloads, created_at FROM users;

-- Historique d'un utilisateur
-- SELECT d.*, u.username
-- FROM downloads d
-- JOIN users u ON d.user_id = u.id
-- WHERE u.email = 'user@example.com'
-- ORDER BY d.created_at DESC
-- LIMIT 50;

-- Stats globales
-- SELECT
--   COUNT(DISTINCT u.id)   AS total_users,
--   COUNT(d.id)            AS total_downloads,
--   MAX(d.created_at)      AS last_download
-- FROM users u
-- LEFT JOIN downloads d ON d.user_id = u.id;

-- Supprimer les sessions expirées
-- DELETE FROM sessions WHERE expires_at < NOW();

-- ════════════════════════════════════════════════════════
--  Migration vers SQLite (syntaxe légèrement différente)
-- ════════════════════════════════════════════════════════
/*
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  password    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  downloads   INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS downloads (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  quality     TEXT NOT NULL DEFAULT 'max',
  instance    TEXT,
  filename    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);
*/