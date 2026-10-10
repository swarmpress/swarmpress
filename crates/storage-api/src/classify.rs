//! Governed or scratch (ADR-0084 §3): a write to WordPress's content becomes
//! part of a commit; a write to state WordPress keeps for itself (transients,
//! cron, sessions, edit locks, caches) is disposable and never committed.
//! Anything else is unknown, and refused once the classifier is enforced.

/// The class of a write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Class {
    Governed,
    Scratch,
    Unknown,
}

/// Option names (or prefixes) WordPress keeps for itself.
const SCRATCH_OPTIONS: &[&str] = &[
    "_transient_",
    "_site_transient_",
    "cron",
    "doing_cron",
    "rewrite_rules",
    "recently_activated",
    "recovery_mode",
    "recovery_keys",
    "auto_updater.lock",
    "core_updater.lock",
    "can_compress_scripts",
    "fresh_site",
    "wp_force_deactivated_plugins",
    "_wp_suggested_policy_text_has_changed",
    "theme_mods_",
    "user_count",
    "db_upgraded",
];

/// User meta WordPress keeps per login or per screen.
const SCRATCH_USERMETA: &[&str] = &[
    "session_tokens",
    "wp_dashboard_quick_press_last_post_id",
    "community-events-location",
    "wp_user-settings",
    "wp_user-settings-time",
    "dismissed_wp_pointers",
    "wp_persisted_preferences",
];

/// Post meta that is editor state, not content.
const SCRATCH_POSTMETA: &[&str] = &[
    "_edit_lock",
    "_edit_last",
    "_wp_trash_meta_status",
    "_wp_trash_meta_time",
    "_encloseme",
    "_pingme",
];

/// The governed tables (without the prefix).
const GOVERNED_TABLES: &[&str] = &[
    "posts",
    "postmeta",
    "terms",
    "termmeta",
    "term_taxonomy",
    "term_relationships",
    "comments",
    "commentmeta",
    "users",
    "usermeta",
    "links",
    "options",
];

fn mentions(sql: &str, keys: &[&str]) -> bool {
    keys.iter()
        .any(|k| sql.contains(&format!("'{k}")) || sql.contains(&format!("\"{k}")))
}

/// The class of a write of `sql` to `table` (`wp_posts`, …; any prefix).
pub fn classify(table: &str, sql: &str) -> Class {
    let base = match table.find('_') {
        Some(i) => &table[i + 1..],
        None => table,
    };
    if !GOVERNED_TABLES.contains(&base) {
        return Class::Unknown;
    }
    match base {
        "options" if mentions(sql, SCRATCH_OPTIONS) => Class::Scratch,
        "usermeta" if mentions(sql, SCRATCH_USERMETA) => Class::Scratch,
        "postmeta" if mentions(sql, SCRATCH_POSTMETA) => Class::Scratch,
        "posts" if sql.contains("'auto-draft'") => Class::Scratch,
        _ => Class::Governed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transients_cron_sessions_and_locks_are_scratch() {
        assert_eq!(
            classify(
                "wp_options",
                "INSERT INTO wp_options (option_name) VALUES ('_transient_doing_cron')"
            ),
            Class::Scratch
        );
        assert_eq!(
            classify(
                "wp_options",
                "UPDATE wp_options SET option_value = 'x' WHERE option_name = 'cron'"
            ),
            Class::Scratch
        );
        assert_eq!(
            classify(
                "wp_usermeta",
                "UPDATE wp_usermeta SET meta_value = 'x' WHERE meta_key = 'session_tokens'"
            ),
            Class::Scratch
        );
        assert_eq!(
            classify(
                "wp_postmeta",
                "INSERT INTO wp_postmeta (meta_key) VALUES ('_edit_lock')"
            ),
            Class::Scratch
        );
    }

    #[test]
    fn content_and_settings_are_governed_and_other_tables_unknown() {
        assert_eq!(
            classify(
                "wp_options",
                "UPDATE wp_options SET option_value = 'Spike' WHERE option_name = 'blogname'"
            ),
            Class::Governed
        );
        assert_eq!(
            classify(
                "wp_posts",
                "INSERT INTO wp_posts (post_title) VALUES ('Harvest')"
            ),
            Class::Governed
        );
        assert_eq!(
            classify(
                "wp_yoast_indexable",
                "INSERT INTO wp_yoast_indexable VALUES (1)"
            ),
            Class::Unknown
        );
    }
}
