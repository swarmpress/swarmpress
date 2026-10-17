//! A company on WordPress (ADR-0082, plan M4): the jobs work on the site through a closed set of
//! capabilities on their work item's branch, never through WordPress itself.
//!
//! [`SiteEngine`] is the port, beside [`Gateway`]: branches, posts read and saved through the
//! governed layer's REST calls into the branch's sandbox, change requests, the merge into `live`,
//! and what became of the release. [`EngineGateway`] gives the jobs that port in the shape they
//! already call, so the pipeline's transitions do not change (ADR-0082 §2):
//!
//! | the jobs call | on WordPress |
//! |---|---|
//! | `open_draft_as` (Draft) | the article as a post on the item's branch, then its change request |
//! | `merge_as` (Publish) | the change request merged into `live` (the merge queue) |
//! | `deploy_state`, `redeploy` | the release and the export that follow a merge (ADR-0083) |
//! | `read_page`, `open_update_as` (refresh, fix) | a post read from `live`, its update on a branch |
//!
//! **Capability checks** ([`page_to_post`]): an article page becomes Gutenberg blocks from the
//! site's block set ([`knowledge::wordpress::BLOCK_TYPES_PATH`]; a block outside it is refused),
//! its hero becomes the featured image (an attachment id from the media index), and its category
//! a term. Links and media were checked against the knowledge indexes before (the v2 validator);
//! an unknown id never reaches WordPress.

use std::collections::BTreeMap;

use async_trait::async_trait;
use content_repo::blocks::{self, Node};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use agents::MaybeSendSync;

use crate::gateway::{
    Attribution, DeployState, DraftPr, Gateway, GatewayError, PageFile, Redeploy,
};

/// The branch every company's public site is exported from.
pub const LIVE: &str = "live";

/// A post as the capabilities write it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WpPost {
    /// `post` or `page`.
    pub post_type: String,
    pub slug: String,
    pub title: String,
    pub excerpt: String,
    /// Gutenberg block markup.
    pub content: String,
    /// WordPress's status on the branch (`publish`: live once merged).
    pub status: String,
    /// The featured image: an attachment id from the media index.
    #[serde(default)]
    pub featured_media: Option<u64>,
    /// Category names from the blog index; the governed layer resolves them to terms.
    #[serde(default)]
    pub categories: Vec<String>,
}

/// A post on a branch, with what an update must name to be accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WpPostFile {
    pub id: u64,
    pub post: WpPost,
    /// The post's version on that branch (its `modified_gmt`): an update names it.
    pub version: String,
    /// The featured image's URL, when it has one.
    #[serde(default)]
    pub featured_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostRef {
    pub id: u64,
    #[serde(default)]
    pub link: String,
}

/// An open change request and the head of its source branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangeRequestRef {
    pub id: u64,
    pub branch: String,
    pub head: String,
}

/// The capabilities on a company's WordPress (ADR-0082 §1). Every write is made by the governed
/// layer as REST calls into the branch's sandbox and committed with `author` as its attribution;
/// none of them can merge except [`SiteEngine::merge`], which only the Publish job calls (rule 3).
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
pub trait SiteEngine: MaybeSendSync {
    /// The branch named `name`, created from `live` when it does not exist yet.
    async fn branch_for(&self, name: &str) -> Result<String, GatewayError>;
    /// The post of `post_type` with `slug` on `branch`, if any.
    async fn find_post(
        &self,
        branch: &str,
        post_type: &str,
        slug: &str,
    ) -> Result<Option<WpPostFile>, GatewayError>;
    /// Creates (`id: None`) or updates a post on `branch`; one commit by `author`.
    async fn save_post(
        &self,
        branch: &str,
        id: Option<u64>,
        post: &WpPost,
        author: &Attribution,
    ) -> Result<PostRef, GatewayError>;
    /// The open change request from `branch` into `live` (opened now when there is none), with
    /// the branch's head.
    async fn open_change_request(
        &self,
        branch: &str,
        title: &str,
        author: &Attribution,
    ) -> Result<ChangeRequestRef, GatewayError>;
    /// Merges change request `id` into `live` if its source is still at `head`; the new head of
    /// `live`. Merging a merged change request again gives the same head.
    async fn merge(
        &self,
        id: u64,
        head: &str,
        author: &Attribution,
    ) -> Result<String, GatewayError>;
    /// What became of the release and export after a merge (`None`: not observed).
    async fn release_status(&self, id: u64) -> Result<Option<DeployState>, GatewayError>;
    /// Runs a failed export and deploy of change request `id` again.
    async fn redeploy(&self, id: u64) -> Result<Redeploy, GatewayError>;
    /// The site's structures in the Studio's models (ADR-0082 §4): post types, their regions and
    /// the block set, for the architects' structural jobs.
    async fn site_models(&self) -> Result<Value, GatewayError> {
        Err(GatewayError(
            "this site engine has no structural models".into(),
        ))
    }
    /// An approved structural proposal built into live (the regions of its post types).
    async fn put_blueprint(
        &self,
        _body: &Value,
    ) -> Result<crate::gateway::ModelsPut, GatewayError> {
        Err(GatewayError(
            "this site engine cannot build structures".into(),
        ))
    }
    /// The site's theme as data (ADR-0093) written on `branch` through WordPress's REST API onto
    /// the neutral base theme (`content_import_wp::theme::calls`: fonts, global styles, parts,
    /// templates, patterns, menus, each by slug); the branch's new head. One commit by `author`.
    async fn put_theme_data(
        &self,
        branch: &str,
        _data: &site_design::ThemeData,
        _author: &Attribution,
    ) -> Result<String, GatewayError> {
        Err(GatewayError(format!(
            "this site engine cannot write a theme as data yet ({branch})"
        )))
    }
    /// A design version of the site (`{version, manifest, design}`), from the platform's design
    /// store (ADR-0093).
    async fn site_design(&self, version: u32) -> Result<Value, GatewayError> {
        Err(GatewayError(format!(
            "this site engine cannot read the site's designs (version {version})"
        )))
    }
    /// The QA stage on `branch` at `head` (ADR-0094; [`Gateway::site_audit`]): `Ok(None)` when
    /// this engine cannot export and audit a branch (the default).
    async fn site_audit(
        &self,
        branch: &str,
        head: &str,
        round: u32,
    ) -> Result<Option<site_quality::QaReport>, GatewayError> {
        let _ = (branch, head, round);
        Ok(None)
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl<T: SiteEngine + ?Sized> SiteEngine for std::sync::Arc<T> {
    async fn branch_for(&self, name: &str) -> Result<String, GatewayError> {
        (**self).branch_for(name).await
    }
    async fn find_post(
        &self,
        branch: &str,
        post_type: &str,
        slug: &str,
    ) -> Result<Option<WpPostFile>, GatewayError> {
        (**self).find_post(branch, post_type, slug).await
    }
    async fn save_post(
        &self,
        branch: &str,
        id: Option<u64>,
        post: &WpPost,
        author: &Attribution,
    ) -> Result<PostRef, GatewayError> {
        (**self).save_post(branch, id, post, author).await
    }
    async fn open_change_request(
        &self,
        branch: &str,
        title: &str,
        author: &Attribution,
    ) -> Result<ChangeRequestRef, GatewayError> {
        (**self).open_change_request(branch, title, author).await
    }
    async fn merge(
        &self,
        id: u64,
        head: &str,
        author: &Attribution,
    ) -> Result<String, GatewayError> {
        (**self).merge(id, head, author).await
    }
    async fn release_status(&self, id: u64) -> Result<Option<DeployState>, GatewayError> {
        (**self).release_status(id).await
    }
    async fn redeploy(&self, id: u64) -> Result<Redeploy, GatewayError> {
        (**self).redeploy(id).await
    }
    async fn site_models(&self) -> Result<Value, GatewayError> {
        (**self).site_models().await
    }
    async fn put_blueprint(&self, body: &Value) -> Result<crate::gateway::ModelsPut, GatewayError> {
        (**self).put_blueprint(body).await
    }
    async fn put_theme_data(
        &self,
        branch: &str,
        data: &site_design::ThemeData,
        author: &Attribution,
    ) -> Result<String, GatewayError> {
        (**self).put_theme_data(branch, data, author).await
    }
    async fn site_design(&self, version: u32) -> Result<Value, GatewayError> {
        (**self).site_design(version).await
    }
    async fn site_audit(
        &self,
        branch: &str,
        head: &str,
        round: u32,
    ) -> Result<Option<site_quality::QaReport>, GatewayError> {
        (**self).site_audit(branch, head, round).await
    }
}

// ------------------------------------------------------------------ the article as a post

/// The blocks an article page becomes (all from WordPress core).
pub const ARTICLE_BLOCKS: &[&str] = &[
    "core/paragraph",
    "core/heading",
    "core/list",
    "core/list-item",
    "core/quote",
    "core/image",
    "core/group",
    "core/buttons",
    "core/button",
];

/// The section block kinds a WordPress site's block set can hold (paragraph needs `core/paragraph`,
/// list `core/list` and `core/list-item`, tip `core/quote`); `None` for a site without a block set
/// (not WordPress), whose writers keep every kind.
pub fn section_kinds(block_set: &[String]) -> Option<Vec<&'static str>> {
    if block_set.is_empty() {
        return None;
    }
    let has = |b: &str| block_set.iter().any(|s| s == b);
    let kinds: Vec<&'static str> = [
        ("paragraph", &["core/paragraph"][..]),
        ("list", &["core/list", "core/list-item"][..]),
        ("tip", &["core/quote"][..]),
    ]
    .into_iter()
    .filter(|(_, needs)| needs.iter().all(|b| has(b)))
    .map(|(k, _)| k)
    .collect();
    Some(kinds)
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The article's inline Markdown (links, `**strong**`, `*em*`/`_em_`) as HTML, escaped first.
pub fn inline_html(md: &str) -> String {
    let s = esc(md);
    let mut out = String::new();
    let mut rest = s.as_str();
    // Links: [text](url)
    while let Some(open) = rest.find('[') {
        let Some(mid) = rest[open..].find("](").map(|i| open + i) else {
            break;
        };
        let Some(close) = rest[mid..].find(')').map(|i| mid + i) else {
            break;
        };
        out.push_str(&rest[..open]);
        let text = &rest[open + 1..mid];
        let url = &rest[mid + 2..close];
        out.push_str(&format!("<a href=\"{url}\">{text}</a>"));
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    let mut s = emphasis(&out, "**", "strong");
    s = emphasis(&s, "*", "em");
    emphasis(&s, "_", "em")
}

fn emphasis(s: &str, mark: &str, tag: &str) -> String {
    let parts: Vec<&str> = s.split(mark).collect();
    if parts.len() < 3 {
        return s.to_string();
    }
    let mut out = String::new();
    for (i, p) in parts.iter().enumerate() {
        if i == 0 {
            out.push_str(p);
        } else if i % 2 == 1 && i + 1 < parts.len() {
            out.push_str(&format!("<{tag}>{p}</{tag}>"));
        } else if i % 2 == 1 {
            out.push_str(mark);
            out.push_str(p);
        } else {
            out.push_str(p);
        }
    }
    out
}

/// HTML back to the article's inline Markdown (what [`inline_html`] writes).
pub fn inline_markdown(html: &str) -> String {
    let mut s = html.to_string();
    for (tag, mark) in [("strong", "**"), ("em", "*")] {
        s = s
            .replace(&format!("<{tag}>"), mark)
            .replace(&format!("</{tag}>"), mark);
    }
    let mut out = String::new();
    let mut rest = s.as_str();
    while let Some(i) = rest.find("<a href=\"") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 9..];
        let Some(q) = after.find('"') else { break };
        let url = &after[..q];
        let Some(gt) = after.find('>') else { break };
        let Some(end) = after.find("</a>") else { break };
        out.push_str(&format!("[{}]({url})", &after[gt + 1..end]));
        rest = &after[end + 4..];
    }
    out.push_str(rest);
    out.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}

fn block(name: &str, attrs: Option<Value>, inner: &str) -> String {
    let a = attrs.map(|v| format!(" {v}")).unwrap_or_default();
    format!("<!-- wp:{name}{a} -->\n{inner}\n<!-- /wp:{name} -->")
}

fn para(html: &str, class: Option<&str>) -> String {
    match class {
        Some(c) => block(
            "paragraph",
            Some(json!({"className": c})),
            &format!("<p class=\"{c}\">{html}</p>"),
        ),
        None => block("paragraph", None, &format!("<p>{html}</p>")),
    }
}

fn str_of<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}

/// The article page (as `agents::article::assemble_page` builds it) as a WordPress post, checked
/// against the site's block set. The errors say what a capability refused.
pub fn page_to_post(page: &Value, block_set: &[String]) -> Result<WpPost, Vec<String>> {
    let mut issues = Vec::new();
    if !block_set.is_empty() {
        for b in ARTICLE_BLOCKS {
            if !block_set.iter().any(|s| s == b) {
                issues.push(format!("the site's block set has no {b}"));
            }
        }
    }
    let slug_route = page["slug"]["en"]
        .as_str()
        .or_else(|| page["slug"].as_str())
        .unwrap_or("");
    let slug = slug_route
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    if slug.is_empty() {
        issues.push("the page has no slug".into());
    }
    let title = page["title"]["en"]
        .as_str()
        .or_else(|| page["title"].as_str())
        .unwrap_or("")
        .to_string();
    let mut excerpt = page["seo"]["description"]["en"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let mut featured = None;
    let mut parts = Vec::new();
    for (i, b) in page["body"].as_array().into_iter().flatten().enumerate() {
        match str_of(b, "type") {
            "editorial-hero" => {
                if let Some(sub) = b["subtitle"].as_str().filter(|s| !s.is_empty()) {
                    excerpt = sub.to_string();
                    parts.push(para(&esc(sub), Some("sp-dek")));
                }
                let id = page["metadata"]["hero_media_id"]
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| {
                        page["metadata"]["hero_media_id"]
                            .as_u64()
                            .map(|n| n.to_string())
                    });
                match id.as_deref().map(str::parse::<u64>) {
                    Some(Ok(n)) => featured = Some(n),
                    _ => issues.push(format!(
                        "/body/{i}: the hero is not an attachment from the media index ({})",
                        id.unwrap_or_default()
                    )),
                }
            }
            "paragraph" => parts.push(para(&inline_html(str_of(b, "markdown")), None)),
            "heading" => {
                let level = b["level"].as_u64().unwrap_or(2);
                parts.push(block(
                    "heading",
                    (level != 2).then(|| json!({"level": level})),
                    &format!(
                        "<h{level} class=\"wp-block-heading\">{}</h{level}>",
                        esc(str_of(b, "text"))
                    ),
                ));
            }
            "list" => {
                let ordered = b["ordered"].as_bool().unwrap_or(false);
                let items: Vec<String> = b["items"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(|t| block("list-item", None, &format!("<li>{}</li>", inline_html(t))))
                    .collect();
                let tag = if ordered { "ol" } else { "ul" };
                parts.push(block(
                    "list",
                    ordered.then(|| json!({"ordered": true})),
                    &format!(
                        "<{tag} class=\"wp-block-list\">{}</{tag}>",
                        items.join("\n")
                    ),
                ));
            }
            "callout" => {
                let inner = para(&inline_html(str_of(b, "content")), None);
                parts.push(block(
                    "quote",
                    Some(json!({"className": "sp-callout"})),
                    &format!(
                        "<blockquote class=\"wp-block-quote sp-callout\">{inner}</blockquote>"
                    ),
                ));
            }
            "image" => {
                let id = page["metadata"]["inline_media_id"]
                    .as_str()
                    .and_then(|s| s.parse::<u64>().ok());
                let cap = b["caption"]
                    .as_str()
                    .filter(|c| !c.is_empty())
                    .map(|c| {
                        format!(
                            "<figcaption class=\"wp-element-caption\">{}</figcaption>",
                            esc(c)
                        )
                    })
                    .unwrap_or_default();
                let class = id
                    .map(|n| format!(" class=\"wp-image-{n}\""))
                    .unwrap_or_default();
                parts.push(block(
                    "image",
                    Some(match id {
                        Some(n) => json!({"id": n, "sizeSlug": "large"}),
                        None => json!({"sizeSlug": "large"}),
                    }),
                    &format!("<figure class=\"wp-block-image size-large\"><img src=\"{}\" alt=\"{}\"{class}/>{cap}</figure>", esc(str_of(b, "src")), esc(str_of(b, "alt"))),
                ));
            }
            "closing-note" => {
                let mut inner = vec![
                    para(&esc(str_of(b, "badge")), Some("sp-badge")),
                    block(
                        "heading",
                        Some(json!({"level": 3})),
                        &format!(
                            "<h3 class=\"wp-block-heading\">{}</h3>",
                            esc(str_of(b, "title"))
                        ),
                    ),
                    // `content` is HTML-escaped already (the frozen theme renders it as HTML).
                    para(str_of(b, "content"), None),
                ];
                // An action whose link a fix removed has no button.
                let buttons: Vec<String> = b["actions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|a| !str_of(a, "href").is_empty())
                    .map(|a| {
                        let cls = if str_of(a, "variant") == "primary" { "" } else { " is-style-outline" };
                        let attrs = if cls.is_empty() { None } else { Some(json!({"className": "is-style-outline"})) };
                        block("button", attrs, &format!("<div class=\"wp-block-button{cls}\"><a class=\"wp-block-button__link wp-element-button\" href=\"{}\">{}</a></div>", esc(str_of(a, "href")), esc(str_of(a, "label"))))
                    })
                    .collect();
                if !buttons.is_empty() {
                    inner.push(block(
                        "buttons",
                        None,
                        &format!(
                            "<div class=\"wp-block-buttons\">{}</div>",
                            buttons.join("\n")
                        ),
                    ));
                }
                parts.push(block(
                    "group",
                    Some(json!({"className": "sp-closing-note"})),
                    &format!(
                        "<div class=\"wp-block-group sp-closing-note\">{}</div>",
                        inner.join("\n")
                    ),
                ));
            }
            other => issues.push(format!("/body/{i}: no capability writes a {other:?} block")),
        }
    }
    let category = page["metadata"]["category"]
        .as_str()
        .filter(|c| !c.is_empty())
        .map(|c| vec![c.to_string()])
        .unwrap_or_default();
    if issues.is_empty() {
        Ok(WpPost {
            post_type: "post".into(),
            slug,
            title,
            excerpt,
            content: parts.join("\n\n"),
            status: "publish".into(),
            featured_media: featured,
            categories: category,
        })
    } else {
        Err(issues)
    }
}

fn inner_html(nodes: &[Node]) -> String {
    nodes
        .iter()
        .map(|n| match n {
            Node::Html { html } => html.clone(),
            Node::Block { .. } => String::new(),
        })
        .collect()
}

fn strip_tag(html: &str, tag: &str) -> String {
    let h = html.trim();
    let Some(gt) = h.find('>') else {
        return h.to_string();
    };
    if !h.starts_with(&format!("<{tag}")) {
        return h.to_string();
    }
    let close = format!("</{tag}>");
    h[gt + 1..]
        .strip_suffix(&close)
        .unwrap_or(&h[gt + 1..])
        .to_string()
}

fn unesc(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}

fn class_of(attrs: &Value) -> &str {
    attrs["className"].as_str().unwrap_or("")
}

/// A post the pipeline wrote, back as an article page (for refresh and fix jobs). A post with
/// blocks no capability writes is refused: its update would lose them.
pub fn post_to_page(file: &WpPostFile) -> Result<Value, String> {
    let p = &file.post;
    let mut body = vec![];
    let mut hero = json!({"type": "editorial-hero", "title": esc(&p.title)});
    if let Some(url) = &file.featured_url {
        hero["image"] = json!(url);
    }
    for n in blocks::parse(&p.content) {
        let (name, attrs, inner) = match &n {
            Node::Html { html } if html.trim().is_empty() => continue,
            Node::Html { .. } => return Err("the post has HTML outside blocks".into()),
            Node::Block { attrs, inner, .. } => (
                n.full_name().unwrap_or_default(),
                attrs.clone(),
                inner.clone().unwrap_or_default(),
            ),
        };
        let html = inner_html(&inner);
        match (name.as_str(), class_of(&attrs)) {
            ("core/paragraph", "sp-dek") => hero["subtitle"] = json!(unesc(&strip_tag(&html, "p"))),
            ("core/paragraph", _) => body.push(
                json!({"type": "paragraph", "markdown": inline_markdown(&strip_tag(&html, "p"))}),
            ),
            ("core/heading", _) => {
                let level = attrs["level"].as_u64().unwrap_or(2);
                body.push(json!({"type": "heading", "level": level, "text": unesc(&strip_tag(&html, &format!("h{level}")))}));
            }
            ("core/list", _) => {
                let items: Vec<String> = inner
                    .iter()
                    .filter_map(|c| match c {
                        Node::Block { inner: Some(i), .. } => {
                            Some(inline_markdown(&strip_tag(&inner_html(i), "li")))
                        }
                        _ => None,
                    })
                    .collect();
                body.push(json!({"type": "list", "ordered": attrs["ordered"].as_bool().unwrap_or(false), "items": items}));
            }
            ("core/quote", "sp-callout") => {
                let text = inner.iter().find_map(|c| match c {
                    Node::Block { inner: Some(i), .. } => {
                        Some(inline_markdown(&strip_tag(&inner_html(i), "p")))
                    }
                    _ => None,
                });
                body.push(json!({"type": "callout", "style": "info", "content": text.unwrap_or_default()}));
            }
            ("core/image", _) => {
                let attr = |k: &str| {
                    html.split(&format!("{k}=\""))
                        .nth(1)
                        .and_then(|r| r.split('"').next())
                        .map(unesc)
                        .unwrap_or_default()
                };
                let mut img = json!({"type": "image", "src": attr("src"), "alt": attr("alt")});
                if let Some(c) = html
                    .split("<figcaption class=\"wp-element-caption\">")
                    .nth(1)
                    .and_then(|r| r.split("</figcaption>").next())
                {
                    img["caption"] = json!(unesc(c));
                }
                body.push(img);
            }
            ("core/group", "sp-closing-note") => {
                let mut note = json!({"type": "closing-note"});
                let mut actions = vec![];
                for c in &inner {
                    let Node::Block {
                        attrs: a,
                        inner: Some(i),
                        ..
                    } = c
                    else {
                        continue;
                    };
                    let h = inner_html(i);
                    match (c.full_name().unwrap_or_default().as_str(), class_of(a)) {
                        ("core/paragraph", "sp-badge") => {
                            note["badge"] = json!(unesc(&strip_tag(&h, "p")))
                        }
                        ("core/heading", _) => note["title"] = json!(unesc(&strip_tag(&h, "h3"))),
                        ("core/paragraph", _) => note["content"] = json!(strip_tag(&h, "p")),
                        ("core/buttons", _) => {
                            for btn in i {
                                let Node::Block {
                                    attrs: ba,
                                    inner: Some(bi),
                                    ..
                                } = btn
                                else {
                                    continue;
                                };
                                let bh = inner_html(bi);
                                let href = bh
                                    .split("href=\"")
                                    .nth(1)
                                    .and_then(|r| r.split('"').next())
                                    .map(unesc)
                                    .unwrap_or_default();
                                let label = bh
                                    .split('>')
                                    .nth(2)
                                    .and_then(|r| r.split("</a").next())
                                    .map(unesc)
                                    .unwrap_or_default();
                                let variant = if class_of(ba) == "is-style-outline" {
                                    "secondary"
                                } else {
                                    "primary"
                                };
                                actions.push(
                                    json!({"label": label, "href": href, "variant": variant}),
                                );
                            }
                        }
                        _ => {}
                    }
                }
                if !actions.is_empty() {
                    note["actions"] = json!(actions);
                }
                body.push(note);
            }
            (other, _) => {
                return Err(format!(
                    "the post has a {other} block, which no capability writes"
                ))
            }
        }
    }
    body.insert(0, hero);
    Ok(json!({
        "id": format!("{}-{}", p.post_type, file.id),
        "slug": {"en": format!("/en/blog/{}", p.slug)},
        "title": {"en": p.title},
        "page_type": "blog-post",
        "seo": {"title": {"en": p.title}, "description": {"en": p.excerpt}},
        "body": body,
        "metadata": {"category": p.categories.first().cloned().unwrap_or_default(), "hero_media_id": p.featured_media.map(|n| n.to_string()).unwrap_or_default()},
        "status": "published",
    }))
}

// ------------------------------------------------------------------ the jobs' port

/// The slug in an article path (`content/pages/blog/<slug>.json`).
fn slug_of_path(path: &str) -> Option<&str> {
    path.rsplit('/').next()?.strip_suffix(".json")
}

/// A branch name for a key the jobs give (a content id): lowercase letters, digits and dashes.
pub fn branch_name(prefix: &str, key: &str) -> String {
    let k: String = key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("{prefix}-{}", k.trim_matches('-'))
}

/// The jobs' [`Gateway`] for a company on WordPress: each call becomes capabilities on a
/// [`SiteEngine`] (module docs). `block_set` is the site's (from its knowledge pack).
pub struct EngineGateway<E> {
    engine: E,
    block_set: Vec<String>,
}

impl<E: SiteEngine> EngineGateway<E> {
    pub fn new(engine: E, block_set: Vec<String>) -> Self {
        Self { engine, block_set }
    }

    pub fn engine(&self) -> &E {
        &self.engine
    }

    async fn write(
        &self,
        branch_key: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
        expect_live: Option<&str>,
    ) -> Result<DraftPr, GatewayError> {
        let post = page_to_post(page, &self.block_set).map_err(|issues| {
            GatewayError(format!("the article was refused: {}", issues.join("; ")))
        })?;
        let who = attribution.cloned().unwrap_or_default();
        if let Some(version) = expect_live {
            let live = self
                .engine
                .find_post(LIVE, &post.post_type, &post.slug)
                .await?
                .ok_or_else(|| GatewayError(format!("no post {} on live", post.slug)))?;
            if live.version != version {
                return Err(GatewayError(format!(
                    "the post {} changed on live since it was read",
                    post.slug
                )));
            }
        }
        let branch = self.engine.branch_for(branch_key).await?;
        let existing = self
            .engine
            .find_post(&branch, &post.post_type, &post.slug)
            .await?;
        self.engine
            .save_post(&branch, existing.map(|f| f.id), &post, &who)
            .await?;
        let title = message.lines().next().unwrap_or(&post.title);
        let cr = self
            .engine
            .open_change_request(&branch, title, &who)
            .await?;
        Ok(DraftPr {
            number: cr.id,
            branch: cr.branch,
            head_sha: cr.head,
        })
    }
}

#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
impl<E: SiteEngine> Gateway for EngineGateway<E> {
    async fn open_draft(
        &self,
        content_id: &str,
        path: &str,
        page: &Value,
        message: &str,
    ) -> Result<DraftPr, GatewayError> {
        self.open_draft_as(content_id, path, page, message, None)
            .await
    }

    async fn open_draft_as(
        &self,
        content_id: &str,
        _path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
    ) -> Result<DraftPr, GatewayError> {
        self.write(
            &branch_name("draft", content_id),
            page,
            message,
            attribution,
            None,
        )
        .await
    }

    async fn merge(&self, pr_number: u64, head_sha: &str) -> Result<String, GatewayError> {
        self.merge_as(pr_number, head_sha, None).await
    }

    async fn merge_as(
        &self,
        pr_number: u64,
        head_sha: &str,
        attribution: Option<&Attribution>,
    ) -> Result<String, GatewayError> {
        self.engine
            .merge(
                pr_number,
                head_sha,
                &attribution.cloned().unwrap_or_default(),
            )
            .await
    }

    async fn deploy_state(&self, pr_number: u64) -> Result<Option<DeployState>, GatewayError> {
        self.engine.release_status(pr_number).await
    }

    async fn redeploy(&self, pr_number: u64) -> Result<Redeploy, GatewayError> {
        self.engine.redeploy(pr_number).await
    }

    async fn read_page(&self, path: &str) -> Result<Option<PageFile>, GatewayError> {
        let Some(slug) = slug_of_path(path) else {
            return Ok(None);
        };
        let Some(file) = self.engine.find_post(LIVE, "post", slug).await? else {
            return Ok(None);
        };
        let page = post_to_page(&file).map_err(|e| GatewayError(format!("{path}: {e}")))?;
        Ok(Some(PageFile {
            page,
            sha: file.version,
        }))
    }

    async fn open_update_as(
        &self,
        content_id: &str,
        _path: &str,
        page: &Value,
        message: &str,
        attribution: Option<&Attribution>,
        blob_sha: &str,
    ) -> Result<DraftPr, GatewayError> {
        self.write(
            &branch_name("update", content_id),
            page,
            message,
            attribution,
            Some(blob_sha),
        )
        .await
    }

    async fn site_models(&self) -> Result<Value, GatewayError> {
        self.engine.site_models().await
    }

    async fn put_blueprint(&self, body: &Value) -> Result<crate::gateway::ModelsPut, GatewayError> {
        self.engine.put_blueprint(body).await
    }

    async fn put_tool(
        &self,
        _graph: &Value,
        _message: &str,
    ) -> Result<crate::gateway::ModelsPut, GatewayError> {
        Err(GatewayError(
            "tools on a WordPress site land with the Studio (plan M6)".into(),
        ))
    }

    async fn put_theme(
        &self,
        _item: &str,
        _files: &BTreeMap<String, String>,
        _message: &str,
    ) -> Result<crate::gateway::ThemePr, GatewayError> {
        Err(GatewayError(
            "a WordPress site's theme is edited in the Paint shop (plan M6)".into(),
        ))
    }

    async fn merge_theme(&self, _number: u64, _head_sha: &str) -> Result<String, GatewayError> {
        Err(GatewayError(
            "a WordPress site's theme is edited in the Paint shop (plan M6)".into(),
        ))
    }

    async fn site_design(&self, version: u32) -> Result<Value, GatewayError> {
        self.engine.site_design(version).await
    }

    async fn site_audit(
        &self,
        branch: &str,
        head_sha: &str,
        round: u32,
    ) -> Result<Option<site_quality::QaReport>, GatewayError> {
        self.engine.site_audit(branch, head_sha, round).await
    }

    /// The theme as data on its branch (ADR-0093) and the branch's change request into live: the
    /// web designer's Draft. The Publish job merges it like an article ([`Gateway::merge_as`]).
    async fn put_theme_data(
        &self,
        branch: &str,
        data: &site_design::ThemeData,
        message: &str,
        attribution: Option<&Attribution>,
    ) -> Result<crate::gateway::ThemePr, GatewayError> {
        let issues = data.validate_shape();
        if !issues.is_empty() {
            return Err(GatewayError(format!(
                "the theme data was refused: {}",
                issues
                    .iter()
                    .map(|i| format!("{}: {}", i.at, i.message))
                    .collect::<Vec<_>>()
                    .join("; ")
            )));
        }
        let who = attribution.cloned().unwrap_or_default();
        let branch = self.engine.branch_for(branch).await?;
        self.engine.put_theme_data(&branch, data, &who).await?;
        let title = message.lines().next().unwrap_or("Theme");
        let cr = self
            .engine
            .open_change_request(&branch, title, &who)
            .await?;
        Ok(crate::gateway::ThemePr {
            number: cr.id,
            branch: cr.branch,
            head_sha: cr.head,
        })
    }
}

pub mod fake;
