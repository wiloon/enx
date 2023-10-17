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
CREATE TABLE `tbl_user` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `username` varchar(256) NOT NULL,
  `password` varchar(256) NOT NULL
);

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

alter table user_dict
    add already_acquainted integer;