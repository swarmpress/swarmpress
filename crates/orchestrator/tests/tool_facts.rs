//! The site's tools in a Draft's research (ADR-0072 §7.4, FEAT-091): with a
//! tool caller, the writer asks the site's on-demand tools for facts after
//! the web research, and what the tools returned joins the dossier with the
//! tool as its source; without one, nothing changes.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use agents::fake_writer;
use agents::pipeline::Brief;
use agents::tool_use::ToolCaller;
use agents::FakeLlm;
use async_trait::async_trait;
use blueprint::site::SiteContext;
use blueprint::tools::ToolGraph;
use blueprint::Blueprint;
use orchestrator::{
    BriefRecord, FakeGateway, FakeSite, JobKind, JobRequest, MemStore, Orchestrator, Outcome, Store,
};
use serde_json::{json, Value};

mod common;
use common::{site, team, COMPANY};

const ITEM: &str = "work-item-1";
const BRIEF_REF: u64 = 42;

struct Weather(Mutex<Vec<String>>);

#[async_trait]
impl ToolCaller for Weather {
    async fn call(&self, tool: &str, _input: &Value) -> Result<Value, String> {
        self.0.lock().unwrap().push(tool.to_string());
        Ok(json!({ "weather": { "temperature": 21, "condition": "sun" } }))
    }
}

fn fixture(path: &str) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../blueprint/tests/fixtures")
                .join(path),
        )
        .unwrap(),
    )
    .unwrap()
}

async fn setup() -> (Arc<MemStore>, Arc<FakeGateway>) {
    let store = Arc::new(MemStore::new());
    let rec = BriefRecord {
        job_id: 1,
        brief: Brief {
            content_id: "content-2a".into(),
            title: "A sunny walk to Corniglia".into(),
            slug: "a-sunny-walk-to-corniglia".into(),
            angle: "The high path in good weather.".into(),
            keywords: vec!["Corniglia".into()],
            target_words: 600,
            language: "en".into(),
            notes: String::new(),
        },
        writer: "staff-1".into(),
        editor: "staff-5".into(),
        minutes: vec![],
        work_item: None,
        staff: team(),
        kind: None,
        target: None,
    };
    store
        .put_brief(COMPANY, BRIEF_REF, serde_json::to_value(rec).unwrap())
        .await
        .unwrap();
    let gateway = Arc::new(FakeGateway::new());
    let mut types: BTreeMap<String, Value> = BTreeMap::new();
    for t in ["Weather", "WeatherReport"] {
        types.insert(t.into(), fixture(&format!("site/blueprint/types/{t}.json")));
    }
    let mut s = FakeSite::new(Blueprint::empty(), types, SiteContext::default());
    let g = ToolGraph::from_value(&fixture("site/blueprint/tools/weather.tool.json")).unwrap();
    s.tools.insert(g.id.clone(), g);
    gateway.set_site(s);
    (store, gateway)
}

fn job() -> JobRequest {
    JobRequest {
        company_id: COMPANY.into(),
        job_id: 2,
        kind: JobKind::Draft,
        project: "project-1".into(),
        work_item: Some(ITEM.into()),
        brief_ref: Some(BRIEF_REF),
        revision: 0,
        staff: team(),
        meeting: None,
        context: Value::Null,
        approved_by: None,
    }
}

fn tasks(llm: &FakeLlm) -> Vec<String> {
    llm.calls()
        .iter()
        .filter_map(|c| {
            c.request
                .messages
                .first()?
                .text
                .lines()
                .next()?
                .strip_prefix("## Task: ")
                .map(String::from)
        })
        .collect()
}

#[tokio::test]
async fn the_writer_asks_the_site_s_tools_and_their_facts_join_the_dossier() {
    let (store, gateway) = setup().await;
    let llm = Arc::new(fake_writer::fake_writer([]));
    let host = Arc::new(Weather(Mutex::default()));
    let o = Orchestrator::new(store.clone(), gateway, llm.clone(), site()).with_tools(host.clone());
    let out = o.run(&job()).await.unwrap();
    assert!(
        matches!(&out[0], Outcome::JobCompleted { digest, .. } if digest.ok),
        "{out:?}"
    );
    let t = tasks(&llm);
    assert_eq!(&t[..3], ["research", "tool facts", "tool facts"], "{t:?}");
    assert_eq!(*host.0.lock().unwrap(), ["weather"]);
    // The tool's answer reached the model as data, and the fact joined the dossier with the tool as its source.
    let art = store
        .get_artifact(COMPANY, ITEM)
        .await
        .unwrap()
        .unwrap()
        .to_string();
    assert!(art.contains("tool:weather"), "{art}");
}

#[tokio::test]
async fn without_a_caller_nothing_changes() {
    let (store, gateway) = setup().await;
    let llm = Arc::new(fake_writer::fake_writer([]));
    let o = Orchestrator::new(store, gateway, llm.clone(), site());
    o.run(&job()).await.unwrap();
    assert!(!tasks(&llm).iter().any(|t| t == "tool facts"));
}
