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
    for r in [Role::ArtDirector, Role::WebDeveloper] {
        assert_eq!(p(r).model, models::OPUS);
        assert_eq!(p(r).effort, Effort::High);
        assert!(p(r).vision);
    }
    for r in [Role::SeoSpecialist, Role::Analyst, Role::MarketingManager] {
        assert_eq!(p(r).model, models::SONNET);
        assert!(p(r).web_search);
    }
    assert_eq!(p(Role::PhotoEditor).model, models::HAIKU);
    assert_eq!(
        (p(Role::Secretary).model.as_str(), p(Role::Secretary).effort),
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
    for &k in JobKind::ALL {
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
        agents::roles::ROLES_TOML.replace("[jobs.critic-review]", "[jobs.critic-reviewX]");
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
    assert_eq!(
        pending,
        [
            "ternary-bonsai-2-27b",
            "gemma-4-e4b-it-qat",
            "muse-glimmer-30b"
        ]
    );
    // Ternary Bonsai 2 is pinned to a real repo and checksum (ADR-0057); it
    // stays eval_pending until the qualification benchmark has run.
    let bonsai = r.get("ternary-bonsai-2-27b").unwrap();
    assert_eq!(bonsai.hf_repo, "prism-ml/Ternary-Bonsai-2-27B-gguf");
    assert_eq!(
        bonsai.verified_sha256(),
        Ok("53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3")
    );
    assert_eq!(bonsai.verified_repo(), Ok(bonsai.hf_repo.as_str()));
    // Gemma 4 E4B (ADR-0066) is pinned to a real checksum as well.
    let gemma = r.get("gemma-4-e4b-it-qat").unwrap();
    assert_eq!(
        gemma.verified_sha256(),
        Ok("df0fd4ee07072c607c29a0a1cb4f98918426cca12f45a2776bdd6ee6d09a4de3")
    );
    // every other checksum is still a placeholder: loading must be refused
    for m in r
        .models()
        .iter()
        .filter(|m| m.id != bonsai.id && m.id != gemma.id)
    {
        assert!(
            matches!(
                m.verified_sha256(),
                Err(RegistryError::UnverifiedChecksum { .. })
            ),
            "{}",
            m.id
        );
    }
    assert!(r.unverified().len() >= r.models().len() - 2);
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
    // every staff role can chat in meetings on the small models, but the
    // large model only serves writing/analysis roles
    for role in agents::Role::staff() {
        assert!(
            pick(Tier::Low, Tier::Low, role, Seniority::Junior).is_some(),
            "{role}"
        );
    }
    assert_eq!(
        pick(Tier::High, Tier::Low, Role::ArtDirector, Seniority::Senior),
        Some("qwen3-4b-q4f16")
    );
    // role not allowed (non-staff)
    assert_eq!(
        pick(Tier::High, Tier::Low, Role::Ceo, Seniority::Senior),
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
