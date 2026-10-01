//! roles.toml (executors, role → model/effort) and models.toml (registry).

use agents::models::RegistryError;
use agents::roles::{ClaudeReason, Executor};
use agents::{JobKind, ModelRegistry, Role, RolesConfig, Route, Seniority, Tier};
use claude::{models, Effort};

#[test]
fn roles_table_matches_plan() {
    let c = RolesConfig::builtin();
    let p = |r| c.claude_profile(r, None).unwrap();
    assert_eq!(
        (
            p(Role::EditorInChief).model.as_str(),
            p(Role::EditorInChief).effort
        ),
        (models::OPUS, Effort::High)
    );
    assert_eq!(
        (p(Role::Writer).model.as_str(), p(Role::Writer).effort),
        (models::OPUS, Effort::Medium)
    );
    assert_eq!(
        (p(Role::Editor).model.as_str(), p(Role::Editor).effort),
        (models::OPUS, Effort::Medium)
    );
    for r in [Role::ArtDirector, Role::FrontendDev] {
        assert_eq!(p(r).model, models::OPUS);
        assert_eq!(p(r).effort, Effort::High);
        assert!(p(r).vision);
    }
    for r in [Role::Seo, Role::Linker, Role::Researcher] {
        assert_eq!(p(r).model, models::SONNET);
        assert!(p(r).web_search);
    }
    assert_eq!(p(Role::Media).model, models::HAIKU);
    assert_eq!(
        (p(Role::Chatter).model.as_str(), p(Role::Chatter).effort),
        (models::SONNET, Effort::Low)
    );
    assert!(c.claude_profile(Role::Ceo, None).is_none());
}

#[test]
fn seniority_overrides_model_but_not_effort() {
    let c = RolesConfig::builtin();
    let w = |s| c.claude_profile(Role::Writer, Some(s)).unwrap();
    assert_eq!(w(Seniority::Junior).model, models::HAIKU);
    assert_eq!(w(Seniority::Mid).model, models::SONNET);
    assert_eq!(w(Seniority::Senior).model, models::OPUS);
    assert_eq!(w(Seniority::Star).model, models::OPUS);
    assert_eq!(w(Seniority::Junior).effort, Effort::Medium);
}

#[test]
fn every_job_kind_has_a_policy() {
    let c = RolesConfig::builtin();
    for k in JobKind::ALL {
        let p = c.job(k);
        assert!(p.max_tokens > 0);
        if p.executor != Executor::Claude {
            assert!(p.min_tier.is_some(), "{k:?}");
        }
    }
    for k in [
        JobKind::Research,
        JobKind::ArtDirection,
        JobKind::ThemeCode,
        JobKind::VisualReview,
        JobKind::CriticReview,
    ] {
        assert_eq!(c.job(k).executor, Executor::Claude, "{k:?}");
    }
    assert_eq!(c.job(JobKind::Standup).executor, Executor::Browser);
    assert_eq!(c.job(JobKind::Draft).executor, Executor::BrowserThenClaude);
}

#[test]
fn routing() {
    let c = RolesConfig::builtin();
    // claude-only
    assert!(matches!(
        c.route(JobKind::Research, Some(Tier::High), false),
        Route::Claude {
            reason: ClaudeReason::Policy,
            ..
        }
    ));
    // browser-only standup never goes to Claude
    assert_eq!(
        c.route(JobKind::Standup, Some(Tier::Low), false),
        Route::Browser {
            min_tier: Tier::Low
        }
    );
    assert_eq!(
        c.route(JobKind::Standup, None, false),
        Route::QueueForBrowser {
            min_tier: Tier::Low
        }
    );
    // browser-then-claude
    assert_eq!(
        c.route(JobKind::Draft, Some(Tier::Mid), false),
        Route::Browser {
            min_tier: Tier::Mid
        }
    );
    assert_eq!(
        c.route(JobKind::Draft, None, false),
        Route::QueueForBrowser {
            min_tier: Tier::Mid
        }
    );
    match c.route(JobKind::Draft, Some(Tier::Low), false) {
        Route::Claude { profile, reason } => {
            assert_eq!(reason, ClaudeReason::DeviceTooWeak);
            assert_eq!(profile.model, models::OPUS);
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        c.route(JobKind::EditReview, Some(Tier::High), true),
        Route::Claude {
            reason: ClaudeReason::BrowserFailed,
            ..
        }
    ));
}

#[test]
fn invalid_roles_config_is_rejected() {
    let missing_job =
        agents::roles::ROLES_TOML.replace("[jobs.critic_review]", "[jobs.critic_reviewX]");
    assert!(RolesConfig::from_toml_str(&missing_job).is_err());
    let bad_model = agents::roles::ROLES_TOML.replacen("claude-opus-5-5", "claude-opus-9", 1);
    assert!(RolesConfig::from_toml_str(&bad_model).is_err());
    let no_tier = agents::roles::ROLES_TOML.replacen("min_tier = \"low\"\n", "", 1);
    assert!(RolesConfig::from_toml_str(&no_tier).is_err());
}

#[test]
fn model_registry_loads_and_flags_placeholders_loudly() {
    let r = ModelRegistry::builtin();
    assert!(r.models().len() >= 5);
    let pending: Vec<&str> = r
        .models()
        .iter()
        .filter(|m| m.eval_pending)
        .map(|m| m.id.as_str())
        .collect();
    assert_eq!(pending, ["ternary-bonsai-2-27b", "muse-glimmer-30b"]);
    // every checksum is still a placeholder: loading must be refused
    for m in r.models() {
        assert!(
            matches!(
                m.verified_sha256(),
                Err(RegistryError::UnverifiedChecksum { .. })
            ),
            "{}",
            m.id
        );
    }
    assert!(r.unverified().len() >= r.models().len());
    assert!(r
        .get("gpt-oss-20b-q4f16")
        .unwrap()
        .hf_repo
        .contains("gpt-oss-20b"));
}

#[test]
fn model_selection_by_tier_and_seniority() {
    let r = ModelRegistry::builtin();
    let pick = |device, min, role, s| r.select(device, min, role, s).map(|m| m.id.as_str());
    // low device: only the tiny model, and only for low-tier jobs
    assert_eq!(
        pick(Tier::Low, Tier::Low, Role::EditorInChief, Seniority::Senior),
        Some("qwen3-0.6b-q4f16")
    );
    assert_eq!(
        pick(Tier::Low, Tier::Mid, Role::Writer, Seniority::Senior),
        None
    );
    // high device drafting: junior gets the small model, senior the largest that fits
    assert_eq!(
        pick(Tier::High, Tier::Mid, Role::Writer, Seniority::Junior),
        Some("qwen3-4b-q4f16")
    );
    assert_eq!(
        pick(Tier::High, Tier::Mid, Role::Writer, Seniority::Senior),
        Some("gpt-oss-20b-q4f16")
    );
    // eval_pending models are never auto-selected
    for s in [
        Seniority::Junior,
        Seniority::Mid,
        Seniority::Senior,
        Seniority::Star,
    ] {
        let id = pick(Tier::High, Tier::High, Role::Writer, s).unwrap();
        assert_eq!(id, "gpt-oss-20b-q4f16");
    }
    // role not allowed
    assert_eq!(
        pick(Tier::High, Tier::Low, Role::ArtDirector, Seniority::Senior),
        None
    );
}

#[test]
fn duplicate_model_ids_rejected() {
    let dup = format!("{}\n{}", agents::models::MODELS_TOML, {
        let s = agents::models::MODELS_TOML;
        let i = s.find("[[model]]").unwrap();
        let j = s[i + 1..].find("[[model]]").unwrap() + i + 1;
        s[i..j].to_owned()
    });
    assert!(ModelRegistry::from_toml_str(&dup).is_err());
}
