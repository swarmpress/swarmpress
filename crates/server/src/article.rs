//! The blog-article profile the gateway enforces (ADR-0061 decisions 3 to 5;
//! `docs/design/mvp-pipeline.md` section 4).
//!
//! The profile is pure and lives in `content_model::article_profile`, so that
//! the browser's eval harness (FEAT-036) checks drafts with the very same
//! code the gateway's [`crate::gateway::check_draft`] runs. This module is
//! that profile, re-exported under the name the server has always used.

pub use content_model::article_profile::*;

#[cfg(test)]
mod tests {
    use serde_json::json;

    /// The server's profile is the shared one, not a copy: a page the shared
    /// function refuses is refused here with the same issues.
    #[test]
    fn the_gateway_profile_is_the_shared_one() {
        let page = json!({"id": "c1", "page_type": "blog-article", "body": []});
        let path = "content/pages/blog/a-slug.json";
        assert_eq!(
            super::check_article_profile(&page, path, "c1"),
            content_model::article_profile::check_article_profile(&page, path, "c1")
        );
        assert!(super::check_article_profile(&page, path, "c1").is_err());
        assert!(super::is_article_path(path));
        assert_eq!(super::BLOG_INDEX_PATH, "content/pages/blog-index.json");
    }
}
