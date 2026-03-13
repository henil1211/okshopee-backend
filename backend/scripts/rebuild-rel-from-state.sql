-- Rebuild relational tables from state_store JSON.
-- Safe to re-run: drops and recreates users_rel and transactions_rel.
-- Run in phpMyAdmin (select DB), paste, press Go. Always take a DB backup first.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS users_rel;
CREATE TABLE users_rel (
  id        VARCHAR(100) PRIMARY KEY,
  userId    VARCHAR(50),
  email     VARCHAR(255),
  fullName  VARCHAR(255),
  phone     VARCHAR(50),
  country   VARCHAR(100),
  createdAt DATETIME,
  updatedAt DATETIME,
  raw       JSON,
  KEY idx_userId (userId),
  KEY idx_createdAt (createdAt)
);

INSERT INTO users_rel (id, userId, email, fullName, phone, country, createdAt, updatedAt, raw)
SELECT
  JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.id'))        AS id,
  JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.userId'))    AS userId,
  JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.email'))     AS email,
  JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.fullName'))  AS fullName,
  JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.phone'))     AS phone,
  JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.country'))   AS country,
  STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.createdAt')), '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
  STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(u.value,'$.updatedAt')), '%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt,
  u.value AS raw
FROM state_store,
JSON_TABLE(state_value, '$[*]' COLUMNS (value JSON PATH '$')) AS u
WHERE state_key = 'mlm_users';

DROP TABLE IF EXISTS transactions_rel;
CREATE TABLE transactions_rel (
  id         VARCHAR(100) PRIMARY KEY,
  userId     VARCHAR(50),
  type       VARCHAR(100),
  amount     DECIMAL(18,2),
  status     VARCHAR(50),
  notes      TEXT,
  createdAt  DATETIME,
  updatedAt  DATETIME,
  raw        JSON,
  KEY idx_userId (userId),
  KEY idx_type (type),
  KEY idx_status (status),
  KEY idx_createdAt (createdAt)
);

INSERT INTO transactions_rel (id, userId, type, amount, status, notes, createdAt, updatedAt, raw)
SELECT
  JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.id'))         AS id,
  JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.userId'))     AS userId,
  JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.type'))       AS type,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.amount')) AS DECIMAL(18,2)) AS amount,
  JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.status'))     AS status,
  JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.notes'))      AS notes,
  STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.createdAt')), '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
  STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.updatedAt')), '%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt,
  t.value AS raw
FROM state_store,
JSON_TABLE(state_value, '$[*]' COLUMNS (value JSON PATH '$')) AS t
WHERE state_key = 'mlm_transactions';

SET FOREIGN_KEY_CHECKS = 1;
