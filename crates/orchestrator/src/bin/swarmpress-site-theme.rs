//! `swarmpress-site-theme`: the web designer's job (ADR-0093, FEAT-115) run once on a design, outside
//! the game: the runner's step for a design before its theme goes to a site.
//!
//! ```text
//! swarmpress-site-theme --design FILE|DIR --content DIR --out DIR
//!                       [--llm fake|hosted] [--server URL] [--login NAME] [--version N]
//! ```
//!
//! `--design` is a Claude Design standalone export (one `.html`) or a bundle directory; `--content`
//! the site repo's `content/` (cinqueterre.travel's): its menus and footer give the pages a menu
//! may link (the site's closed world). The orchestrator's own `SiteTheme` job runs on it, with the
//! fake web designer (`--llm fake`, the default) or GPT-6-Luna through the central server's
//! `/api/llm/generate` (`--llm hosted`: a dev login, its company and lease; the server holds the
//! provider's key, this program never sees it). Nothing is deployed and no site repository is
//! touched: the theme goes on an in-memory branch, and `--out` gets:
//!
//! - `theme-data.json`: the `ThemeData` with its font files under `assets/` (for
//!   `swarmpress-wp-migrate --theme-data`: the importer writes it onto `canvas`);
//! - `report.json`: the digest, every template's and part's outcome (repair rounds and the issues
//!   repaired), the notes, the model calls, or the failure and why;
//! - `site.json`: the site as the job saw it; `design/`: the bundle's files, for the visual
//!   comparison (`apps/game/e2e/theme-visual.mts`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use agents::fake_writer::fake_writer;
use agents::llm::{DeltaSink, LlmRole};
use agents::{Llm, LlmError, LlmRequest};
use async_trait::async_trait;
use content_import_wp::plan::MenuItem;
use orchestrator::{
    FakeGateway, JobKind, JobRequest, MemStore, Orchestrator, Outcome, SiteBinding, StaffRef, Store,
};
use serde_json::{json, Value};
use site_design::model::QuerySource;
use site_design::{interpret, DesignBundle, DesignSource};
use theme_designer::{Collection, SiteContext, SiteLink};

const COMPANY: &str = "cli";
const ITEM: &str = "work-item-1";

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn die(msg: impl std::fmt::Display) -> ! {
    eprintln!("swarmpress-site-theme: {msg}");
    std::process::exit(2)
}

fn read_dir(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap_or_else(|e| die(format!("{}: {e}", d.display()))) {
            let p = e.unwrap_or_else(|e| die(e)).path();
            if p.is_dir() {
                stack.push(p);
            } else {
                let rel = p
                    .strip_prefix(root)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(rel, std::fs::read(&p).unwrap_or_else(|e| die(e)));
            }
        }
    }
    out
}

fn bundle(path: &Path) -> DesignBundle {
    if path.is_dir() {
        DesignBundle::new(read_dir(path), DesignSource::Upload, 0)
            .unwrap_or_else(|e| die(format!("{}: {e:?}", path.display())))
    } else {
        let name = path
            .file_name()
            .map_or("design.html".into(), |n| n.to_string_lossy().into_owned());
        let bytes = std::fs::read(path).unwrap_or_else(|e| die(format!("{}: {e}", path.display())));
        DesignBundle::from_upload(BTreeMap::from([(name, bytes)]), DesignSource::Upload, 0)
            .unwrap_or_else(|e| die(format!("{}: {e:?}", path.display())))
    }
}

fn flatten(lang: &str, items: &[MenuItem], out: &mut Vec<SiteLink>) {
    for it in items {
        let url = it.url.trim();
        if !url.is_empty() && !url.contains('#') && !it.label.trim().is_empty() {
            out.push(SiteLink {
                lang: lang.to_string(),
                label: it.label.clone(),
                url: url.to_string(),
            });
        }
        flatten(lang, &it.children, out);
    }
}

/// The site as the theme sees it, from its content (the import's menus and footer).
fn site_of(content: &Path) -> SiteContext {
    let site = content_import_wp::Site::read(content).unwrap_or_else(|e| die(e));
    let plan = content_import_wp::plan::plan(&site);
    let mut links = Vec::new();
    for (lang, items) in &plan.menus {
        flatten(lang, items, &mut links);
    }
    for by_lang in plan.named_menus.values() {
        for (lang, items) in by_lang {
            flatten(lang, items, &mut links);
        }
    }
    // The blog's index under the design's word for it.
    for lang in content_import_wp::LANGS {
        links.push(SiteLink {
            lang: lang.into(),
            label: "Stories".into(),
            url: format!("/{lang}/blog/"),
        });
    }
    links.sort_by(|a, b| (&a.lang, &a.url, &a.label).cmp(&(&b.lang, &b.url, &b.label)));
    links.dedup();
    SiteContext {
        name: plan.title.clone(),
        languages: content_import_wp::LANGS
            .iter()
            .map(|l| l.to_string())
            .collect(),
        links,
        // What the import's WordPress can list by query today: its posts. The villages and the
        // stays are pages the home composes as content; no query selects them yet.
        collections: vec![
            Collection {
                name: "latest-stories".into(),
                label: "Latest stories".into(),
                source: QuerySource::Latest,
                keywords: vec!["stories".into(), "dispatch".into(), "latest".into()],
                query: json!({"postType": "post", "order": "desc", "orderBy": "date"}),
            },
            Collection {
                name: "editors-picks".into(),
                label: "Editors' picks".into(),
                source: QuerySource::Featured,
                keywords: vec!["picks".into(), "curated".into()],
                query: json!({"postType": "post", "sticky": "only"}),
            },
        ],
    }
}

// ------------------------------------------------------------------ hosted GPT-6-Luna

/// GPT-6-Luna through the central server (`POST /api/llm/generate`, ADR-0067): signed in with a
/// dev login, the company's lease renewed as it goes. The key stays on the server.
struct Hosted {
    http: reqwest::Client,
    server: String,
    cookie: String,
    company: String,
    lease: Mutex<(String, std::time::Instant)>,
    calls: Mutex<Vec<Value>>,
}

impl Hosted {
    async fn connect(server: &str, login: &str) -> Result<Hosted, String> {
        let http = reqwest::Client::new();
        let res = http
            .post(format!("{server}/auth/dev/login"))
            .json(&json!({"login": login}))
            .send()
            .await
            .map_err(|e| format!("dev login: {e}"))?;
        if !res.status().is_success() {
            return Err(format!(
                "dev login: {} (the server needs SWARMPRESS_DEV_AUTH=1)",
                res.status()
            ));
        }
        let cookie = res
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|v| v.split(';').next())
            .collect::<Vec<_>>()
            .join("; ");
        let me = |http: &reqwest::Client| {
            http.get(format!("{server}/api/companies/me"))
                .header(reqwest::header::COOKIE, cookie.clone())
                .send()
        };
        let mut res = me(&http).await.map_err(|e| e.to_string())?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            http.post(format!("{server}/api/companies"))
                .header(reqwest::header::COOKIE, cookie.clone())
                .json(&json!({"name": "Web designer (CLI)"}))
                .send()
                .await
                .map_err(|e| format!("company: {e}"))?;
            res = me(&http).await.map_err(|e| e.to_string())?;
        }
        let company: Value = res.json().await.map_err(|e| format!("company: {e}"))?;
        let company = company["id"]
            .as_str()
            .ok_or("the dev login has no company")?
            .to_string();
        let h = Hosted {
            http,
            server: server.to_string(),
            cookie,
            company,
            lease: Mutex::new((String::new(), std::time::Instant::now())),
            calls: Mutex::new(Vec::new()),
        };
        h.lease("acquire").await?;
        Ok(h)
    }

    async fn lease(&self, mode: &str) -> Result<String, String> {
        let current = self
            .lease
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .clone();
        let mut req = self
            .http
            .post(format!(
                "{}/api/companies/{}/lease",
                self.server, self.company
            ))
            .header(reqwest::header::COOKIE, self.cookie.clone())
            .json(&json!({"device_id": "cli-site-theme", "mode": mode, "kind": "self"}));
        if mode == "renew" {
            req = req.header("x-swarmpress-lease", current);
        }
        let res = req.send().await.map_err(|e| format!("lease: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("lease ({mode}): {}", res.status()));
        }
        let v: Value = res.json().await.map_err(|e| format!("lease: {e}"))?;
        let token = v["token"].as_str().ok_or("lease: no token")?.to_string();
        *self.lease.lock().unwrap_or_else(|e| e.into_inner()) =
            (token.clone(), std::time::Instant::now());
        Ok(token)
    }

    async fn token(&self) -> Result<String, String> {
        let (token, at) = self.lease.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if at.elapsed().as_secs() < 30 {
            return Ok(token);
        }
        self.lease("renew").await
    }

    async fn release(&self) {
        let token = self
            .lease
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .clone();
        let _ = self
            .http
            .delete(format!(
                "{}/api/companies/{}/lease",
                self.server, self.company
            ))
            .header(reqwest::header::COOKIE, self.cookie.clone())
            .header("x-swarmpress-lease", token)
            .send()
            .await;
    }

    async fn turn(&self, req: &LlmRequest, schema: Option<&Value>) -> Result<String, LlmError> {
        let mut messages = vec![json!({"role": "system", "content": req.system.join("\n\n")})];
        for m in &req.messages {
            let role = match m.role {
                LlmRole::User => "user",
                LlmRole::Assistant => "assistant",
            };
            messages.push(json!({"role": role, "content": m.text}));
        }
        let reasoning = req.reasoning_tokens.unwrap_or(0);
        let mut body = json!({
            "messages": messages,
            "kind": "web-design",
            "max_output_tokens": req.max_tokens + reasoning,
            "reasoning_effort": if reasoning > 0 { "medium" } else { "none" },
            "service_tier": "default",
        });
        if let Some(s) = schema {
            body["json_schema"] = s.clone();
        }
        let token = self.token().await.map_err(LlmError::Unavailable)?;
        let started = std::time::Instant::now();
        let res = self
            .http
            .post(format!("{}/api/llm/generate", self.server))
            .header(reqwest::header::COOKIE, self.cookie.clone())
            .header("x-swarmpress-lease", token)
            .json(&body)
            .send()
            .await
            .map_err(|e| LlmError::Unavailable(e.to_string()))?;
        let status = res.status();
        let v: Value = res.json().await.unwrap_or(Value::Null);
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(json!({
                "status": status.as_u16(),
                "finish": v["finish"],
                "usage": v["usage"],
                "cost_micros": v["cost_micros"],
                "duration_ms": started.elapsed().as_millis() as u64,
            }));
        match status.as_u16() {
            200 => {}
            503 | 504 => return Err(LlmError::Unavailable(format!("{status}: {}", v["error"]))),
            _ => return Err(LlmError::Backend(format!("{status}: {}", v["error"]))),
        }
        if v["finish"] == "length" {
            return Err(LlmError::Truncated {
                partial: v["text"].as_str().unwrap_or("").chars().take(200).collect(),
            });
        }
        Ok(v["text"].as_str().unwrap_or("").to_string())
    }
}

#[async_trait]
impl Llm for Hosted {
    async fn generate(
        &self,
        req: &LlmRequest,
        _on_delta: Option<DeltaSink<'_>>,
    ) -> Result<String, LlmError> {
        self.turn(req, None).await
    }

    async fn structured(&self, req: &LlmRequest, schema: &Value) -> Result<Value, LlmError> {
        let text = self.turn(req, Some(schema)).await?;
        let value = claude::extract_json(&text).map_err(|e| LlmError::InvalidOutput {
            errors: vec![e],
            answer: Some(text.chars().take(2000).collect()),
        })?;
        let validator = claude::SchemaValidator::new(schema)
            .map_err(|e| LlmError::Backend(format!("bad schema: {e}")))?;
        validator
            .validate(&value)
            .map_err(|errors| LlmError::InvalidOutput {
                errors,
                answer: Some(value.to_string().chars().take(2000).collect()),
            })?;
        Ok(value)
    }

    fn model_id(&self) -> Option<String> {
        Some("gpt-6-luna".into())
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        println!("usage: swarmpress-site-theme --design FILE|DIR --content DIR --out DIR [--llm fake|hosted] [--server URL] [--login NAME] [--version N]");
        return;
    }
    let need = |n: &str| arg(&args, n).unwrap_or_else(|| die(format!("missing {n}")));
    let design_path = PathBuf::from(need("--design"));
    let content = PathBuf::from(need("--content"));
    let out = PathBuf::from(need("--out"));
    let version: u32 = arg(&args, "--version")
        .map(|v| v.parse().unwrap_or_else(|_| die("--version is a number")))
        .unwrap_or(1);
    let which = arg(&args, "--llm").unwrap_or_else(|| "fake".into());
    std::fs::create_dir_all(&out).unwrap_or_else(|e| die(e));

    let b = bundle(&design_path);
    let design = interpret(&b);
    let site = site_of(&content);
    eprintln!(
        "design {} ({} files, bundle {}): {} templates, {} parts, {} pages read",
        design.title,
        b.files().len(),
        &b.hash()[..12],
        design.templates.len(),
        design.parts.len(),
        design.pages.len()
    );
    std::fs::write(
        out.join("site.json"),
        serde_json::to_string_pretty(&site).unwrap(),
    )
    .unwrap_or_else(|e| die(e));
    for (path, bytes) in b.files() {
        let p = out.join("design").join(path);
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).unwrap_or_else(|e| die(e));
        }
        std::fs::write(&p, bytes).unwrap_or_else(|e| die(e));
    }

    let gateway = FakeGateway::new();
    gateway.put_design(
        version,
        json!({"version": version, "manifest": b.manifest(), "design": design}),
    );
    let mut hosted: Option<Arc<Hosted>> = None;
    let llm: Arc<dyn Llm> = match which.as_str() {
        "fake" => Arc::new(fake_writer([])),
        "hosted" => {
            let server = arg(&args, "--server").unwrap_or_else(|| "http://127.0.0.1:8081".into());
            let login = arg(&args, "--login").unwrap_or_else(|| "web-designer-cli".into());
            let h = Arc::new(
                Hosted::connect(&server, &login)
                    .await
                    .unwrap_or_else(|e| die(e)),
            );
            hosted = Some(h.clone());
            h
        }
        other => die(format!("--llm {other}: fake or hosted")),
    };
    let binding = SiteBinding::from_json(&json!({
        "site_id": "cinqueterre.travel",
        "brand_name": site.name,
        "language": "en",
        "quality_bar": 7,
        "llm_profile": "local",
    }))
    .unwrap_or_else(|e| die(e));
    let o = Orchestrator::new(MemStore::new(), gateway, llm, binding);
    let req = JobRequest {
        company_id: COMPANY.into(),
        job_id: 1,
        kind: JobKind::SiteTheme,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(u64::from(version)),
        revision: 0,
        staff: vec![StaffRef {
            id: "staff-1".into(),
            persona: "serena".into(),
            role: "web-designer".into(),
        }],
        meeting: None,
        context: json!({"site": site}),
        approved_by: None,
    };
    let started = std::time::Instant::now();
    let result = o.run(&req).await;
    if let Some(h) = &hosted {
        h.release().await;
    }
    let posts = o.store().plan_json(COMPANY).await.unwrap_or_default()["posts"][ITEM].clone();
    let art = o
        .store()
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap_or_default();
    let calls = hosted
        .as_ref()
        .map(|h| Value::Array(h.calls.lock().unwrap_or_else(|e| e.into_inner()).clone()))
        .unwrap_or(Value::Null);
    let mut report = json!({
        "design": {"title": design.title, "bundle": b.hash(), "version": version, "templates": design.templates.iter().map(|t| &t.slug).collect::<Vec<_>>()},
        "llm": which,
        "seconds": started.elapsed().as_secs(),
        "posts": posts,
        "calls": calls,
    });
    let code = match result {
        Err(e) => {
            report["error"] = json!(e.to_string());
            eprintln!("the job did not run: {e}");
            1
        }
        Ok(outcomes) => {
            report["outcomes"] = serde_json::to_value(&outcomes).unwrap_or_default();
            match outcomes.last() {
                Some(Outcome::JobCompleted { digest, .. }) => {
                    let rec = &art
                        .as_ref()
                        .map(|a| a["site_theme"].clone())
                        .unwrap_or_default();
                    report["tasks"] = rec["tasks"].clone();
                    report["notes"] = rec["notes"].clone();
                    report["summary"] = rec["summary"].clone();
                    let mut theme: site_design::ThemeData =
                        serde_json::from_value(rec["theme"].clone()).unwrap_or_else(|e| die(e));
                    // The font files beside the data (the importer reads them relative to it).
                    for f in &mut theme.fonts {
                        for face in &mut f.faces {
                            let bytes = b.bytes(&face.file.path).unwrap_or_else(|| {
                                die(format!("{} is not in the bundle", face.file.path))
                            });
                            let p = out.join(&face.file.path);
                            if let Some(d) = p.parent() {
                                std::fs::create_dir_all(d).unwrap_or_else(|e| die(e));
                            }
                            std::fs::write(&p, bytes).unwrap_or_else(|e| die(e));
                        }
                    }
                    theme.design = b.hash().to_string();
                    std::fs::write(
                        out.join("theme-data.json"),
                        serde_json::to_string_pretty(&theme).unwrap(),
                    )
                    .unwrap_or_else(|e| die(e));
                    eprintln!(
                        "{}\ndigest: ok {}, score {}, {} tasks, {} issues repaired",
                        rec["summary"].as_str().unwrap_or(""),
                        digest.ok,
                        digest.score,
                        digest.words,
                        digest.qa_defects
                    );
                    0
                }
                Some(Outcome::JobFailed { reason, .. }) => {
                    eprintln!("the job failed ({reason:?}); report.json has the thread");
                    1
                }
                other => {
                    eprintln!("unexpected outcome {other:?}");
                    1
                }
            }
        }
    };
    std::fs::write(
        out.join("report.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .unwrap_or_else(|e| die(e));
    std::process::exit(code);
}
