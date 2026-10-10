CREATE TABLE `wp_users` (
  `ID` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `user_login` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `user_pass` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `user_nicename` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `user_email` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `user_url` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `user_registered` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `user_activation_key` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `user_status` INTEGER NOT NULL DEFAULT '0',
  `display_name` TEXT COLLATE NOCASE NOT NULL DEFAULT ''
);
CREATE INDEX `wp_users__user_login_key` ON `wp_users` (`user_login`);
CREATE INDEX `wp_users__user_nicename` ON `wp_users` (`user_nicename`);
CREATE INDEX `wp_users__user_email` ON `wp_users` (`user_email`);
CREATE TABLE `wp_usermeta` (
  `umeta_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `user_id` INTEGER NOT NULL DEFAULT '0',
  `meta_key` TEXT COLLATE NOCASE,
  `meta_value` TEXT COLLATE NOCASE
);
CREATE INDEX `wp_usermeta__user_id` ON `wp_usermeta` (`user_id`);
CREATE INDEX `wp_usermeta__meta_key` ON `wp_usermeta` (`meta_key`);
CREATE TABLE `wp_termmeta` (
  `meta_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `term_id` INTEGER NOT NULL DEFAULT '0',
  `meta_key` TEXT COLLATE NOCASE,
  `meta_value` TEXT COLLATE NOCASE
);
CREATE INDEX `wp_termmeta__term_id` ON `wp_termmeta` (`term_id`);
CREATE INDEX `wp_termmeta__meta_key` ON `wp_termmeta` (`meta_key`);
CREATE TABLE `wp_terms` (
  `term_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `name` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `slug` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `term_group` INTEGER NOT NULL DEFAULT '0'
);
CREATE INDEX `wp_terms__slug` ON `wp_terms` (`slug`);
CREATE INDEX `wp_terms__name` ON `wp_terms` (`name`);
CREATE TABLE `wp_term_taxonomy` (
  `term_taxonomy_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `term_id` INTEGER NOT NULL DEFAULT '0',
  `taxonomy` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `description` TEXT COLLATE NOCASE NOT NULL,
  `parent` INTEGER NOT NULL DEFAULT '0',
  `count` INTEGER NOT NULL DEFAULT '0'
);
CREATE UNIQUE INDEX `wp_term_taxonomy__term_id_taxonomy` ON `wp_term_taxonomy` (`term_id`, `taxonomy`);
CREATE INDEX `wp_term_taxonomy__taxonomy` ON `wp_term_taxonomy` (`taxonomy`);
CREATE TABLE `wp_term_relationships` (
  `object_id` INTEGER NOT NULL DEFAULT '0',
  `term_taxonomy_id` INTEGER NOT NULL DEFAULT '0',
  `term_order` INTEGER NOT NULL DEFAULT '0',
  PRIMARY KEY (`object_id`, `term_taxonomy_id`)
);
CREATE INDEX `wp_term_relationships__term_taxonomy_id` ON `wp_term_relationships` (`term_taxonomy_id`);
CREATE TABLE `wp_commentmeta` (
  `meta_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `comment_id` INTEGER NOT NULL DEFAULT '0',
  `meta_key` TEXT COLLATE NOCASE,
  `meta_value` TEXT COLLATE NOCASE
);
CREATE INDEX `wp_commentmeta__comment_id` ON `wp_commentmeta` (`comment_id`);
CREATE INDEX `wp_commentmeta__meta_key` ON `wp_commentmeta` (`meta_key`);
CREATE TABLE `wp_comments` (
  `comment_ID` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `comment_post_ID` INTEGER NOT NULL DEFAULT '0',
  `comment_author` TEXT COLLATE NOCASE NOT NULL,
  `comment_author_email` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `comment_author_url` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `comment_author_IP` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `comment_date` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `comment_date_gmt` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `comment_content` TEXT COLLATE NOCASE NOT NULL,
  `comment_karma` INTEGER NOT NULL DEFAULT '0',
  `comment_approved` TEXT COLLATE NOCASE NOT NULL DEFAULT '1',
  `comment_agent` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `comment_type` TEXT COLLATE NOCASE NOT NULL DEFAULT 'comment',
  `comment_parent` INTEGER NOT NULL DEFAULT '0',
  `user_id` INTEGER NOT NULL DEFAULT '0'
);
CREATE INDEX `wp_comments__comment_post_ID` ON `wp_comments` (`comment_post_ID`);
CREATE INDEX `wp_comments__comment_approved_date_gmt` ON `wp_comments` (`comment_approved`, `comment_date_gmt`);
CREATE INDEX `wp_comments__comment_date_gmt` ON `wp_comments` (`comment_date_gmt`);
CREATE INDEX `wp_comments__comment_parent` ON `wp_comments` (`comment_parent`);
CREATE INDEX `wp_comments__comment_author_email` ON `wp_comments` (`comment_author_email`);
CREATE TABLE `wp_links` (
  `link_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `link_url` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `link_name` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `link_image` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `link_target` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `link_description` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `link_visible` TEXT COLLATE NOCASE NOT NULL DEFAULT 'Y',
  `link_owner` INTEGER NOT NULL DEFAULT '1',
  `link_rating` INTEGER NOT NULL DEFAULT '0',
  `link_updated` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `link_rel` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `link_notes` TEXT COLLATE NOCASE NOT NULL,
  `link_rss` TEXT COLLATE NOCASE NOT NULL DEFAULT ''
);
CREATE INDEX `wp_links__link_visible` ON `wp_links` (`link_visible`);
CREATE TABLE `wp_options` (
  `option_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `option_name` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `option_value` TEXT COLLATE NOCASE NOT NULL,
  `autoload` TEXT COLLATE NOCASE NOT NULL DEFAULT 'yes'
);
CREATE UNIQUE INDEX `wp_options__option_name` ON `wp_options` (`option_name`);
CREATE INDEX `wp_options__autoload` ON `wp_options` (`autoload`);
CREATE TABLE `wp_postmeta` (
  `meta_id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `post_id` INTEGER NOT NULL DEFAULT '0',
  `meta_key` TEXT COLLATE NOCASE,
  `meta_value` TEXT COLLATE NOCASE
);
CREATE INDEX `wp_postmeta__post_id` ON `wp_postmeta` (`post_id`);
CREATE INDEX `wp_postmeta__meta_key` ON `wp_postmeta` (`meta_key`);
CREATE TABLE `wp_posts` (
  `ID` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  `post_author` INTEGER NOT NULL DEFAULT '0',
  `post_date` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `post_date_gmt` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `post_content` TEXT COLLATE NOCASE NOT NULL,
  `post_title` TEXT COLLATE NOCASE NOT NULL,
  `post_excerpt` TEXT COLLATE NOCASE NOT NULL,
  `post_status` TEXT COLLATE NOCASE NOT NULL DEFAULT 'publish',
  `comment_status` TEXT COLLATE NOCASE NOT NULL DEFAULT 'open',
  `ping_status` TEXT COLLATE NOCASE NOT NULL DEFAULT 'open',
  `post_password` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `post_name` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `to_ping` TEXT COLLATE NOCASE NOT NULL,
  `pinged` TEXT COLLATE NOCASE NOT NULL,
  `post_modified` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `post_modified_gmt` TEXT COLLATE NOCASE NOT NULL DEFAULT '0000-00-00 00:00:00',
  `post_content_filtered` TEXT COLLATE NOCASE NOT NULL,
  `post_parent` INTEGER NOT NULL DEFAULT '0',
  `guid` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `menu_order` INTEGER NOT NULL DEFAULT '0',
  `post_type` TEXT COLLATE NOCASE NOT NULL DEFAULT 'post',
  `post_mime_type` TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  `comment_count` INTEGER NOT NULL DEFAULT '0'
);
CREATE INDEX `wp_posts__post_name` ON `wp_posts` (`post_name`);
CREATE INDEX `wp_posts__type_status_date` ON `wp_posts` (`post_type`, `post_status`, `post_date`, `ID`);
CREATE INDEX `wp_posts__post_parent` ON `wp_posts` (`post_parent`);
CREATE INDEX `wp_posts__post_author` ON `wp_posts` (`post_author`);
CREATE INDEX `wp_posts__type_status_author` ON `wp_posts` (`post_type`, `post_status`, `post_author`);
