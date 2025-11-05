CREATE TABLE `tbl_ecp` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `english` varchar(256) NOT NULL,
  `chinese` varchar(512) DEFAULT NULL,
  `pronunciation` varchar(256) DEFAULT NULL,
  `create_datetime` datetime DEFAULT NULL,
  `load_count` int(11) NOT NULL DEFAULT '0',
  `update_datetime` datetime DEFAULT NULL
);

CREATE TABLE `tbl_log` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `id_word` int(11) DEFAULT NULL,
  `log_type` varchar(128) DEFAULT NULL,
  `message` varchar(256) DEFAULT NULL,
  `create_datetime` datetime DEFAULT NULL
);

CREATE TABLE users (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `name` varchar(256) NOT NULL,
  `email` varchar(256) NOT NULL,
  `password` varchar(256) NOT NULL,
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime DEFAULT NULL,
  `last_login_time` datetime DEFAULT NULL,
  UNIQUE (`name`),
  UNIQUE (`email`)
);

INSERT INTO users (id, name, email, password, create_time, update_time, last_login_time) 
VALUES (1, 'wiloon','wangyue@wiloon.com', 'password_1', '2025-05-02 13:14:32', NULL, NULL);

INSERT INTO users (id, name, email, password, create_time, update_time, last_login_time) 
VALUES (2, 'user_2','user_2@wiloon.com', 'password_2', '2025-05-02 13:15:32', NULL, NULL);

create table words
(
    id              INTEGER
        primary key autoincrement,
    english         varchar(256)             not null,
    chinese         varchar(512) default NULL,
    pronunciation   varchar(256) default NULL,
    create_datetime datetime     default NULL,
    load_count      int(11)      default '0' not null,
    update_datetime datetime     default NULL
);

CREATE UNIQUE INDEX idx_english ON words(english);

create table user_dicts
(
    user_id            INTEGER,
    word_id            INTEGER,
    query_count        INTEGER,
    already_acquainted INTEGER,
    update_time        datetime,
    PRIMARY KEY (user_id, word_id)
);

create table youdao
(
    english TEXT          not null,
    result  TEXT          not null,
    exist   INTEGER default 0 not null
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL
);
