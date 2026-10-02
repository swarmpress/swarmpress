//! Structured organization jobs on FakeLlm / FakeClaude: schemas, semantic
//! checks (numbers only from the input, closed worlds, rubric floors) and
//! candidate generation.

use std::sync::Arc;

use agents::jobs::analytics::{
    kpi_report, AnalyticsInput, AnalyticsRow, AnalyticsTable, GoalProgress,
};
use agents::jobs::hiring::{candidate_schema, generate_candidate, CandidateRequest};
use agents::jobs::office::{
    finance_report, finance_report_schema, secretary_triage, Delegation, TicketInput, TicketOption,
    TicketPriority, TicketTag,
};
use agents::jobs::production::{site_change_check, site_change_schema};
use agents::jobs::strategy::{
    plan_schedule_check, BoardItem, BoardMember, BoardPhase, DayWindow, PlanScheduleInput,
};
use agents::jobs::{JobCtx, JobStaff};
use agents::llm::LlmRole;
use agents::{
    Catalog, ClaudeLlm, FakeLlm, FakeReply, JobKind, LlmError, Role, RolesConfig, Seniority,
};
use claude::fake::responses;
use claude::FakeClaude;
use serde_json::{json, Value};

fn finance_data() -> Value {
    json!({
        "cashEur": 92900.09, "runwayDays": 61, "dailyBurnEur": 1520.4, "month": 1,
        "company": { "revenueEur": 0, "salariesEur": 38400, "rentEur": 2400, "upkeepEur": 600, "agencyEur": 1800 },
        "projects": [ { "id": "project-1", "budgetEurMonth": 60000, "spentEurMonth": 41200,
                        "revenueEurMonth": 0, "overBudget": false } ],
        "alerts": []
    })
}

fn report(observation: &str) -> Value {
    json!({
        "headline": "We have €92,900 in cash and 61 days of runway.",
        "observations": [observation],
        "risks": ["Revenue is still €0 while daily burn is €1,520."],
        "recommendations": ["Hold new hires until cinqueterre.travel earns its first revenue."],
        "plan_ops": []
    })
}

fn cfo() -> JobStaff {
    JobStaff::new("staff-7", Role::Cfo, Some(Seniority::Senior))
}

#[tokio::test]
async fn finance_report_uses_only_input_numbers() {
    let data = finance_data();
    let staff = cfo();
    let ctx = JobCtx {
        staff: &staff,
        system: "You are Elena.",
        plan: None,
    };

    let ok = FakeLlm::new([FakeReply::Json(report(
        "cinqueterre.travel spent €41,200 of its €60,000 budget.",
    ))]);
    let r = finance_report(&ok, ctx, &data).await.unwrap();
    assert!(r.headline.contains("61 days"));
    let call = &ok.calls()[0];
    assert_eq!(call.request.profile.job, JobKind::FinanceReport);
    assert_eq!(call.request.profile.role, Role::Cfo);
    assert_eq!(call.request.messages[0].role, LlmRole::User);
    assert!(call.request.messages[0]
        .text
        .contains("\"cashEur\": 92900.09"));
    assert_eq!(call.schema.as_ref().unwrap(), &finance_report_schema());

    // an invented figure (the 12% overspend and €48,000 are not in the data)
    let bad = FakeLlm::new([FakeReply::Json(report(
        "cinqueterre.travel is 12% over plan at €48,000.",
    ))]);
    match finance_report(&bad, ctx, &data).await.unwrap_err() {
        LlmError::InvalidOutput { errors } => {
            assert_eq!(errors.len(), 2, "{errors:?}");
            assert!(errors[0].contains("\"12\""));
            assert!(errors[1].contains("\"48,000\""));
        }
        e => panic!("{e:?}"),
    }
}

#[tokio::test]
async fn finance_report_on_claude_repairs_invented_numbers() {
    let fake = Arc::new(FakeClaude::with_script([
        responses::json(&report("Salaries were €40,000.")),
        responses::json(&report("Salaries were €38,400.")),
    ]));
    let llm = ClaudeLlm::new(fake.clone(), RolesConfig::builtin());
    let staff = cfo();
    let r = finance_report(
        &llm,
        JobCtx {
            staff: &staff,
            system: "You are Elena.",
            plan: None,
        },
        &finance_data(),
    )
    .await
    .unwrap();
    assert_eq!(r.observations, ["Salaries were €38,400."]);
    let reqs = fake.requests();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[0].model, claude::models::OPUS, "senior CFO → opus");
    let repair = serde_json::to_string(&reqs[1].messages).unwrap();
    assert!(repair.contains("does not appear in the input data"));
    assert!(repair.contains("40,000"));
}

#[tokio::test]
async fn jobs_refuse_the_wrong_role() {
    let staff = JobStaff::new("staff-1", Role::Writer, None);
    let llm = FakeLlm::new([]);
    let err = finance_report(
        &llm,
        JobCtx {
            staff: &staff,
            system: "",
            plan: None,
        },
        &finance_data(),
    )
    .await
    .unwrap_err();
    assert!(
        matches!(err, LlmError::Backend(m) if m.contains("writer cannot perform finance-report"))
    );
    assert!(llm.calls().is_empty());
}

fn ticket(tags: Vec<TicketTag>) -> TicketInput {
    TicketInput {
        id: "ticket-3".into(),
        kind: "budget-overrun".into(),
        from: "staff-7".into(),
        project: Some("project-1".into()),
        title: "cinqueterre.travel is over budget".into(),
        body: "Spend is €66,000 against a €60,000 budget this month.".into(),
        options: vec![
            TicketOption {
                id: "approve-overrun".into(),
                label: "Approve the overrun".into(),
            },
            TicketOption {
                id: "cut-scope".into(),
                label: "Cut scope".into(),
            },
        ],
        default_option: "cut-scope".into(),
        tags,
        deadline_minute: Some(1440),
    }
}

fn triage(priority: &str, option: &str) -> Value {
    json!({
        "priority": priority,
        "summary": "Elena reports cinqueterre.travel over budget this month; without an answer by the deadline the default cuts scope.",
        "proposed_option": option,
        "reasoning": "Financial decision: HIGH by the rubric.",
        "plan_ops": []
    })
}

#[tokio::test]
async fn secretary_triage_follows_the_rubric() {
    let staff = JobStaff::new("staff-8", Role::Secretary, Some(Seniority::Senior));
    let ctx = JobCtx {
        staff: &staff,
        system: "You are Paolo.",
        plan: None,
    };
    let t = ticket(vec![TicketTag::Financial]);

    let llm = FakeLlm::new([FakeReply::Json(triage("high", "cut-scope"))]);
    let out = secretary_triage(&llm, ctx, &t).await.unwrap();
    assert_eq!(out.priority, TicketPriority::High);
    assert_eq!(out.proposed_option, "cut-scope");
    // financial tickets never go to the secretary, whatever the policy
    assert!(!out.secretary_may_answer(&t, Delegation::LowAndMedium));
    // the schema restricts the option to the ticket's
    let schema = llm.calls()[0].schema.clone().unwrap();
    assert_eq!(
        schema["properties"]["proposed_option"]["enum"],
        json!(["approve-overrun", "cut-scope"])
    );

    // a financial ticket triaged Low violates the rubric floor
    let low = FakeLlm::new([FakeReply::Json(triage("low", "cut-scope"))]);
    match secretary_triage(&low, ctx, &t).await.unwrap_err() {
        LlmError::InvalidOutput { errors } => assert!(errors[0].contains("must be high")),
        e => panic!("{e:?}"),
    }
    // an invented option fails the schema
    let bad = FakeLlm::new([FakeReply::Json(triage("high", "hire-more"))]);
    assert!(matches!(
        secretary_triage(&bad, ctx, &t).await,
        Err(LlmError::InvalidOutput { .. })
    ));

    // delegation policy on an informational ticket
    let info = ticket(vec![TicketTag::Informational]);
    let llm = FakeLlm::new([FakeReply::Json(triage("low", "cut-scope"))]);
    let out = secretary_triage(&llm, ctx, &info).await.unwrap();
    assert!(out.secretary_may_answer(&info, Delegation::Low));
    assert!(!out.secretary_may_answer(&info, Delegation::Off));
}

fn row(page: &str, sessions: u64, visitors: u64, pageviews: u64) -> AnalyticsRow {
    AnalyticsRow {
        day: None,
        page: Some(page.into()),
        language: Some("en".into()),
        source: None,
        sessions,
        visitors,
        pageviews,
        engagement_time_s: 74.5,
        scroll_depth_pct: 62.0,
        outbound_clicks: 31,
        derived: [("wow_change_pct".to_string(), 18.0)].into_iter().collect(),
    }
}

fn analytics() -> AnalyticsInput {
    AnalyticsInput {
        project: "cinqueterre-travel".into(),
        period: "days 22–28".into(),
        tables: vec![AnalyticsTable {
            name: "by_page_this_week".into(),
            description: "Aggregated per page, this week".into(),
            rows: vec![
                row("/en/blog/last-light-on-sentiero-azzurro/", 1310, 1240, 1890),
                row("/en/riomaggiore/", 640, 610, 820),
            ],
        }],
        goals: vec![GoalProgress {
            goal: "Grow cinqueterre.travel to 40k monthly readers".into(),
            metric: "visitors".into(),
            target: 40000.0,
            current: 12000.0,
        }],
    }
}

fn kpi(top_note: &str, page: &str) -> Value {
    json!({
        "headline": "1,240 visitors read the Sentiero Azzurro piece this week.",
        "kpis": [{"metric": "visitors", "value": "1,240", "comparison": "up 18% week over week"}],
        "top_pages": [{"page": page, "note": top_note}],
        "bottom_pages": [{"page": "/en/riomaggiore/", "note": "610 visitors"}],
        "languages": ["English only so far"],
        "sources": ["not in this table"],
        "anomalies": [],
        "recommendations": ["Update the Riomaggiore page.", "Pitch a second trail piece.", "Translate the top piece."],
        "plan_ops": []
    })
}

#[tokio::test]
async fn kpi_report_numbers_and_pages_come_from_the_tables() {
    let staff = JobStaff::new("staff-13", Role::DataScientist, Some(Seniority::Mid));
    let ctx = JobCtx {
        staff: &staff,
        system: "You are Matteo.",
        plan: None,
    };
    let input = analytics();
    let page = "/en/blog/last-light-on-sentiero-azzurro/";

    let ok = FakeLlm::new([FakeReply::Json(kpi("62% scroll depth, 74 s engaged", page))]);
    let r = kpi_report(&ok, ctx, &input).await.unwrap();
    assert_eq!(r.recommendations.len(), 3);

    // an invented figure is rejected
    let bad = FakeLlm::new([FakeReply::Json(kpi(
        "2,500 visitors expected next week",
        page,
    ))]);
    match kpi_report(&bad, ctx, &input).await.unwrap_err() {
        LlmError::InvalidOutput { errors } => {
            assert_eq!(errors.len(), 1);
            assert!(errors[0].contains("2,500"));
        }
        e => panic!("{e:?}"),
    }
    // an invented page is rejected
    let bad = FakeLlm::new([FakeReply::Json(kpi("62% scroll depth", "/en/vernazza/"))]);
    match kpi_report(&bad, ctx, &input).await.unwrap_err() {
        LlmError::InvalidOutput { errors } => {
            assert!(errors[0].contains("not in the analytics tables"))
        }
        e => panic!("{e:?}"),
    }
}

#[test]
fn analytics_input_is_aggregates_only() {
    // user-level columns cannot even be deserialized
    let raw = json!({
        "project": "p", "period": "x",
        "tables": [{"name": "t", "description": "d", "rows": [{
            "visitor_id": "abc", "sessions": 1, "visitors": 1, "pageviews": 1,
            "engagement_time_s": 1.0, "scroll_depth_pct": 1.0, "outbound_clicks": 0
        }]}]
    });
    assert!(serde_json::from_value::<AnalyticsInput>(raw).is_err());
    // or smuggled in as derived columns
    let mut a = analytics();
    a.tables[0].rows[0]
        .derived
        .insert("user_count_by_ip".into(), 3.0);
    assert!(a.validate().unwrap_err()[0].contains("user-level"));
    // no data yet
    let mut empty = analytics();
    empty.tables[0].rows.clear();
    assert!(empty.validate().is_err());
}

#[tokio::test]
async fn candidate_generation_validates_as_a_persona() {
    let catalog = Catalog::builtin();
    let req = CandidateRequest::new(catalog, Role::Writer, Seniority::Junior, None);
    assert_eq!(req.id, catalog.next_pool_id());
    let staff = JobStaff::new("staff-9", Role::Strategist, None);
    let ctx = JobCtx {
        staff: &staff,
        system: "You are the hiring desk.",
        plan: None,
    };

    // a candidate in the persona schema, built from a pool persona
    let mut cand = serde_json::to_value(catalog.get("valentina").unwrap()).unwrap();
    cand["id"] = json!(req.id);
    cand["slug"] = json!("giorgia");
    cand["name"] = json!("Giorgia Lombardi");
    cand["relationships"] = json!({"friends": ["giulia"], "friction": []});
    // it validates against the schema the job sends
    claude::SchemaValidator::new(&candidate_schema())
        .unwrap()
        .validate(&json!({"candidate": cand, "plan_ops": []}))
        .unwrap();

    let llm = FakeLlm::new([FakeReply::Json(
        json!({"candidate": cand.clone(), "plan_ops": []}),
    )]);
    let out = generate_candidate(&llm, ctx, catalog, &req).await.unwrap();
    assert_eq!(out.candidate.slug, "giorgia");
    assert!(out.candidate.in_pool());
    assert!(catalog.admit(&out.candidate).is_ok());

    // duplicates and mismatches are rejected before they enter the pool
    let mut dup = cand.clone();
    dup["name"] = json!("Giulia Rossi");
    let mut wrong_role = cand.clone();
    wrong_role["role"] = json!("translator");
    let mut wrong_band = cand.clone();
    wrong_band["salary_eur_month"] = json!(9000);
    let mut stranger = cand.clone();
    stranger["relationships"] = json!({"friends": ["nobody"], "friction": []});
    for (bad, needle) in [
        (dup, "duplicates an existing persona"),
        (wrong_role, "requested writer"),
        (wrong_band, "outside the writer band"),
        (stranger, "unknown persona \"nobody\""),
    ] {
        let llm = FakeLlm::new([FakeReply::Json(json!({"candidate": bad, "plan_ops": []}))]);
        match generate_candidate(&llm, ctx, catalog, &req)
            .await
            .unwrap_err()
        {
            LlmError::InvalidOutput { errors } => {
                assert!(
                    errors.iter().any(|e| e.contains(needle)),
                    "{needle}: {errors:?}"
                )
            }
            e => panic!("{e:?}"),
        }
    }
}

#[test]
fn every_job_schema_carries_plan_ops() {
    use agents::jobs::{analytics as an, office, production as pr, strategy as st};
    let t = ticket(vec![]);
    let schemas = [
        office::finance_report_schema(),
        office::hiring_affordability_schema(),
        office::triage_schema(&t),
        office::thread_summary_schema(),
        st::strategy_pitch_schema(),
        st::project_business_case_schema(),
        st::weekly_plan_schema(),
        an::kpi_report_schema(),
        an::content_performance_schema(),
        pr::photo_brief_schema(),
        pr::site_change_schema(),
        pr::ops_check_schema(),
        pr::marketing_plan_schema(),
        candidate_schema(),
    ];
    for s in schemas {
        assert!(s["properties"]["plan_ops"].is_object(), "{s}");
        assert!(s["required"]
            .as_array()
            .unwrap()
            .contains(&json!("plan_ops")));
        claude::SchemaValidator::new(&s).unwrap();
    }
}

#[test]
fn plan_schedule_checks_roles_and_window() {
    let input = PlanScheduleInput {
        window: DayWindow {
            from_day: 8,
            to_day: 14,
        },
        items: vec![BoardItem {
            id: "work-item-4".into(),
            kind: "article".into(),
            title: "Harvest week".into(),
            phases: vec![
                BoardPhase {
                    kind: "draft".into(),
                    assignee: None,
                    estimate_min: 240,
                },
                BoardPhase {
                    kind: "media".into(),
                    assignee: None,
                    estimate_min: 120,
                },
            ],
            depends_on: vec![],
        }],
        team: vec![
            BoardMember {
                id: "staff-1".into(),
                name: "Giulia Rossi".into(),
                role: Role::Writer,
                load_pct: 60,
            },
            BoardMember {
                id: "staff-6".into(),
                name: "Francesca De Luca".into(),
                role: Role::Photographer,
                load_pct: 40,
            },
        ],
    };
    let out = |assignee: &str, phase: &str, day: u32| {
        json!({
            "assignments": [{"item": "work-item-4", "phase": phase, "assignee": assignee, "due_day": day}],
            "publish_dates": [], "deferred": [], "plan_ops": []
        })
    };
    assert!(plan_schedule_check(&input, &out("staff-1", "draft", 10)).is_ok());
    assert!(
        plan_schedule_check(&input, &out("staff-6", "draft", 10)).unwrap_err()[0]
            .contains("cannot take a draft phase")
    );
    assert!(plan_schedule_check(&input, &out("staff-1", "layout", 10)).is_err());
    assert!(plan_schedule_check(&input, &out("staff-1", "draft", 20)).is_err());
}

#[test]
fn site_change_is_artifacts_only() {
    let change = |path: &str, risk: &str, approval: bool| {
        json!({
            "summary": "s", "rationale": "r", "risk": risk, "requires_ceo_approval": approval,
            "files": [{"path": path, "change": "modify", "description": "d", "content": "x"}],
            "test_plan": ["open the page"], "plan_ops": []
        })
    };
    let v = claude::SchemaValidator::new(&site_change_schema()).unwrap();
    v.validate(&change("src/components/Hero.astro", "low", false))
        .unwrap();
    assert!(site_change_check(&change("src/components/Hero.astro", "low", false)).is_ok());
    assert!(site_change_check(&change("../secrets/.env", "low", false)).is_err());
    assert!(site_change_check(&change("/etc/passwd", "low", false)).is_err());
    assert!(site_change_check(&change(".github/workflows/deploy.yml", "low", false)).is_err());
    assert!(site_change_check(&change(".github/workflows/deploy.yml", "high", true)).is_ok());
}
