//! The persona catalog (schema v2, organization.md §3, ADR-0030): loading,
//! validation, coverage, prompt formatting and work routing.

use std::collections::BTreeSet;

use agents::personas::{
    format_persona_for_prompt, format_persona_for_prompt_on, format_work_style,
    format_writing_style_for_prompt, persona_json_schema, Catalog, WritingStyle, BUILTIN,
    POOL_ID_START,
};
use agents::{best_writer_for, catalog_json, Persona, Role, Seniority, Traits};

const STAFF: [(u16, &str, &str); 13] = [
    (1, "giulia", "Giulia Rossi"),
    (2, "isabella", "Isabella Ferraro"),
    (3, "lorenzo", "Lorenzo Bertolotti"),
    (4, "sophia", "Sophia Lanza"),
    (5, "marco", "Marco Vitali"),
    (6, "francesca", "Francesca De Luca"),
    (7, "elena", "Elena Marchetti"),
    (8, "paolo", "Paolo Bianchi"),
    (9, "chiara", "Chiara Galli"),
    (10, "luca", "Luca Moretti"),
    (11, "davide", "Davide Conti"),
    (12, "alessia", "Alessia Ferri"),
    (13, "matteo", "Matteo Greco"),
];

fn src(slug: &str) -> &'static str {
    BUILTIN.iter().find(|(s, _)| *s == slug).unwrap().1
}

#[test]
fn every_file_in_the_directory_is_in_the_catalog() {
    let dir = format!("{}/personas", env!("CARGO_MANIFEST_DIR"));
    let on_disk: BTreeSet<String> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "toml"))
        .map(|p| p.file_stem().unwrap().to_string_lossy().into_owned())
        .collect();
    let builtin: BTreeSet<String> = BUILTIN.iter().map(|(s, _)| s.to_string()).collect();
    assert_eq!(on_disk, builtin);
    // and each file on disk is what was compiled in
    for (slug, s) in BUILTIN {
        let disk = std::fs::read_to_string(format!("{dir}/{slug}.toml")).unwrap();
        assert_eq!(disk, *s, "{slug}");
    }
}

#[test]
fn catalog_loads_and_validates() {
    let c = Catalog::builtin();
    assert_eq!(c.all().len(), BUILTIN.len());
    let staff: Vec<(u16, &str, &str)> = c
        .staff()
        .map(|p| (p.id, p.slug.as_str(), p.name.as_str()))
        .collect();
    assert_eq!(staff, STAFF);
    assert!(c.pool().count() >= 14);
    assert!(c.pool().all(|p| p.id >= POOL_ID_START));
    for p in c.all() {
        p.validate().unwrap();
        assert!(!p.bio.starts_with('\n'), "{}", p.slug);
        assert!(p.cv.experience.len() >= 2, "{}", p.slug);
        assert!(!p.cv.education.is_empty(), "{}", p.slug);
        assert_eq!(Some(p.department), p.role.department(), "{}", p.slug);
        // TOML round trip
        let back = Persona::from_toml_str(&p.to_toml_string().unwrap()).unwrap();
        assert_eq!(&back, p);
    }
    // the reference company (organization.md §10)
    let role = |slug: &str| c.get(slug).unwrap().role;
    assert_eq!(role("sophia"), Role::EditorInChief);
    assert_eq!(role("marco"), Role::Editor);
    assert_eq!(role("francesca"), Role::Photographer);
    assert_eq!(role("elena"), Role::Cfo);
    assert_eq!(role("paolo"), Role::Secretary);
    assert_eq!(role("chiara"), Role::Strategist);
    assert_eq!(role("matteo"), Role::DataScientist);
    assert_eq!(role("luca"), Role::WebDeveloper);
    assert_eq!(role("davide"), Role::ItEngineer);
    assert_eq!(role("alessia"), Role::SeoSpecialist);
    for w in ["giulia", "isabella", "lorenzo"] {
        assert_eq!(role(w), Role::Writer);
    }
    assert_eq!(c.next_pool_id(), c.pool().map(|p| p.id).max().unwrap() + 1);
}

#[test]
fn ids_slugs_and_names_are_unique() {
    let c = Catalog::builtin();
    let ids: BTreeSet<u16> = c.all().iter().map(|p| p.id).collect();
    let slugs: BTreeSet<&str> = c.all().iter().map(|p| p.slug.as_str()).collect();
    let names: BTreeSet<&str> = c.all().iter().map(|p| p.name.as_str()).collect();
    assert_eq!(ids.len(), c.all().len());
    assert_eq!(slugs.len(), c.all().len());
    assert_eq!(names.len(), c.all().len());

    // a duplicate id is reported
    let dup = src("elena").replace("id = 7\n", "id = 1\n");
    let err =
        Catalog::from_sources([("giulia", src("giulia")), ("elena", dup.as_str())]).unwrap_err();
    assert!(err.0.iter().any(|e| e.contains("duplicate id 1")), "{err}");
}

#[test]
fn relationships_reference_existing_people() {
    let c = Catalog::builtin();
    for p in c.all() {
        for r in p.friends().iter().chain(p.friction()) {
            assert!(c.get(r).is_some(), "{} → {r}", p.slug);
        }
    }
    // the cinqueterre team has relationships
    assert!(c.staff().all(|p| !p.friends().is_empty()));
    // a dangling reference fails the catalog
    let err = Catalog::from_sources([("giulia", src("giulia"))]).unwrap_err();
    assert!(err
        .0
        .iter()
        .any(|e| e.contains("relationship to unknown persona \"isabella\"")));
}

#[test]
fn every_role_has_someone_in_staff_or_pool() {
    let c = Catalog::builtin();
    for role in Role::staff() {
        assert!(c.with_role(role).count() >= 1, "nobody is a {role}");
    }
    assert!(
        c.pool().any(|p| p.role == Role::DataScientist),
        "a data-scientist candidate"
    );
    let seniorities: BTreeSet<Seniority> = c.pool().map(|p| p.seniority).collect();
    assert_eq!(seniorities.len(), 4, "pool spans junior..star");
    let pronouns: BTreeSet<&str> = c.all().iter().map(|p| p.pronouns.as_str()).collect();
    assert!(pronouns.contains("they/them"));
}

#[test]
fn schema_rejects_bad_personas() {
    let giulia = src("giulia");
    let bad = |from: &str, to: &str| {
        let s = giulia.replacen(from, to, 1);
        assert_ne!(s, giulia, "replacement {from:?} did not apply");
        Persona::from_toml_str(&s)
    };
    // unknown field
    assert!(bad("age = 38\n", "age = 38\nshoe_size = 39\n").is_err());
    // missing required field (pronouns)
    assert!(bad("pronouns = \"she/her\"\n", "").is_err());
    // empty required field
    assert!(bad("hometown = \"La Spezia, Italy\"", "hometown = \"  \"").is_err());
    // pronouns must be stated
    assert!(bad("pronouns = \"she/her\"", "pronouns = \"she\"").is_err());
    // department must match role
    assert!(bad("department = \"editorial\"", "department = \"strategy\"").is_err());
    // salary outside the role band
    assert!(bad("salary_eur_month = 4200", "salary_eur_month = 42000").is_err());
    // trait out of range
    assert!(bad("rigor = 65", "rigor = 150").is_err());
    // unknown role
    assert!(bad("role = \"writer\"", "role = \"linker\"").is_err());
    // bad dates
    assert!(bad("years = \"2006–2009\"", "years = \"2009–2006\"").is_err());
    assert!(bad("birthday = \"03-14\"", "birthday = \"14-03\"").is_err());
    // writers need a writing style
    let no_style = giulia.split("\n[writing_style]").next().unwrap().to_owned()
        + "\n"
        + &giulia[giulia.find("\n[relationships]").unwrap()..];
    assert!(Persona::from_toml_str(&no_style)
        .unwrap_err()
        .to_string()
        .contains("needs [writing_style]"));
    // relationships to oneself
    assert!(bad(
        "friends = [\"isabella\", \"francesca\"]",
        "friends = [\"giulia\"]"
    )
    .is_err());
    // partisan world topics
    assert!(bad(
        "topics = [\"Ligurian fishing quotas\"",
        "topics = [\"the Green Party\""
    )
    .is_err());
    // too few values
    assert!(bad(
        "values = [\"craft over speed\", \"local first\", \"honesty about trade-offs\"]",
        "values = [\"craft over speed\"]"
    )
    .is_err());
    // slug must match the file name
    let err = Catalog::from_sources([("giulia-rossi", giulia)]).unwrap_err();
    assert!(err.0.iter().any(|e| e.contains("must match the file name")));
}

#[test]
fn every_persona_validates_against_the_json_schema() {
    let v = claude::SchemaValidator::new(&persona_json_schema()).unwrap();
    for p in Catalog::builtin().all() {
        let j = serde_json::to_value(p).unwrap();
        v.validate(&j)
            .unwrap_or_else(|e| panic!("{}: {e:?}", p.slug));
        assert_eq!(&Persona::from_json_value(&j).unwrap(), p);
    }
}

#[test]
fn catalog_json_is_camel_case() {
    let j = catalog_json();
    assert_eq!(j["schemaVersion"], 2);
    let personas = j["personas"].as_array().unwrap();
    assert_eq!(personas.len(), Catalog::builtin().all().len());
    let giulia = &personas[0];
    assert_eq!(giulia["slug"], "giulia");
    assert_eq!(giulia["salaryEurMonth"], 4200);
    assert_eq!(giulia["inPool"], false);
    assert!(giulia["life"]["workStyle"].as_str().is_some());
    assert!(giulia["writingStyle"]["samplePhrases"]["en"].is_array());
    assert!(
        giulia["traditions"]["name_day"].is_string(),
        "data keys kept"
    );
    assert!(giulia["cv"]["education"][0]["where"].as_str().is_some());
    assert_eq!(j["roles"].as_array().unwrap().len(), 21);
    assert_eq!(j["departments"][0]["id"], "executive-office");
}

#[test]
fn traditions_and_occasions() {
    let c = Catalog::builtin();
    let giulia = c.get("giulia").unwrap();
    assert!(giulia.traditions_for("christmas").unwrap().contains("fish"));
    assert_eq!(giulia.occasions_on(12, 25), ["christmas"]);
    assert_eq!(giulia.occasions_on(5, 22), ["name_day"]);
    assert_eq!(giulia.occasions_on(3, 14), ["birthday"]);
    let aarav = c.get("aarav").unwrap();
    assert!(aarav.traditions_for("christmas").is_none());
    assert!(aarav.traditions_for("diwali").is_some());
    let matteo = c.get("matteo").unwrap();
    assert_eq!(matteo.occasions_on(9, 21), ["birthday", "name_day"]);
    let p = format_persona_for_prompt_on(giulia, "en", Some("christmas"));
    assert!(p.contains("**Today (christmas):** Cooks the Christmas Eve fish dinner"));
    assert!(!format_persona_for_prompt(giulia, "en").contains("**Today"));
}

#[test]
fn persona_prompt_snapshots() {
    for slug in ["elena", "paolo", "chiara", "giulia", "matteo"] {
        let p = Persona::builtin(slug).unwrap();
        insta::assert_snapshot!(
            format!("persona_{slug}"),
            format_persona_for_prompt(&p, "en")
        );
    }
}

#[test]
fn persona_prompt_is_bounded_and_characterful() {
    for p in Catalog::builtin().all() {
        let text = format_persona_for_prompt(p, "en");
        assert!(text.len() < 5200, "{}: {} bytes", p.slug, text.len());
        assert!(text.contains(&p.life.hobbies[0]), "{}", p.slug);
        assert!(text.contains(&p.life.quirks[0]), "{}", p.slug);
        assert!(text.contains(&p.pronouns), "{}", p.slug);
    }
    // relationships render as names
    let g = format_persona_for_prompt(&Persona::builtin("giulia").unwrap(), "en");
    assert!(g.contains("You get on well with Isabella Ferraro (Outdoors & Adventure Writer)"));
    assert!(g.contains("You often disagree with Lorenzo Bertolotti"));
}

#[test]
fn persona_prompt_uses_language_phrases_with_en_fallback() {
    let p = Persona::builtin("lorenzo").unwrap();
    let de = format_persona_for_prompt(&p, "de");
    assert!(de.contains("- \"Die Ursprünge dieses Dorfes reichen zurück bis...\""));
    let es = format_persona_for_prompt(&p, "es");
    assert!(es.contains("- \"The origins of this village date to...\""));
}

#[test]
fn writing_style_snapshots() {
    for slug in [
        "giulia",
        "isabella",
        "lorenzo",
        "sophia",
        "marco",
        "francesca",
    ] {
        let p = Persona::builtin(slug).unwrap();
        insta::assert_snapshot!(
            format!("writing_style_{slug}"),
            format_writing_style_for_prompt(p.writing_style.as_ref().unwrap())
        );
    }
}

#[test]
fn writing_style_matches_legacy_for_marco() {
    let p = Persona::builtin("marco").unwrap();
    assert_eq!(
        format_writing_style_for_prompt(p.writing_style.as_ref().unwrap()),
        "\n## Writing Style Guidelines\n**Tone:** Maintain a polished, business-appropriate voice\n**Vocabulary:** Use everyday words accessible to all readers\n**Sentences:** Keep sentences brief and punchy\n**Formality:** Balance formality - neither stiff nor overly casual\n**Perspective:** Maintain objective distance, referring to \"visitors\" or \"travelers\"\n**Description:** Focus on concrete facts and practical information\n"
    );
}

#[test]
fn empty_or_unknown_style_renders_nothing() {
    assert_eq!(
        format_writing_style_for_prompt(&WritingStyle::default()),
        ""
    );
    let s = WritingStyle {
        tone: Some("sarcastic".into()),
        humor: Some("lots".into()),
        ..Default::default()
    };
    assert_eq!(format_writing_style_for_prompt(&s), "");
}

#[test]
fn work_style_snapshots() {
    let low = Traits {
        rigor: 10,
        speed: 10,
        creativity: 10,
        sociability: 10,
        resilience: 10,
        ambition: 10,
    };
    insta::assert_snapshot!(
        "work_style_low_junior",
        format_work_style(&low, Seniority::Junior)
    );
    let p = Persona::builtin("lorenzo").unwrap();
    insta::assert_snapshot!(
        "work_style_lorenzo",
        format_work_style(&p.traits, p.seniority)
    );
}

fn team(slugs: &[&str]) -> Vec<Persona> {
    slugs.iter().map(|s| Persona::builtin(s).unwrap()).collect()
}

#[test]
fn work_routing_follows_affinities_and_legacy_fallbacks() {
    let all = team(&[
        "giulia",
        "isabella",
        "lorenzo",
        "sophia",
        "marco",
        "francesca",
        "elena",
        "alessia",
    ]);
    let refs: Vec<&Persona> = all.iter().collect();
    let pick = |t: &str| best_writer_for(t, &refs);
    // organization.md §10: food → Giulia, hiking → Isabella, history →
    // Lorenzo, hotels → Sophia, practical → Marco, photography → Francesca
    assert_eq!(pick("restaurants").as_deref(), Some("giulia"));
    assert_eq!(pick("Wine").as_deref(), Some("giulia"));
    assert_eq!(pick("hiking").as_deref(), Some("isabella"));
    assert_eq!(pick("beaches").as_deref(), Some("isabella"));
    assert_eq!(pick("history").as_deref(), Some("lorenzo"));
    assert_eq!(pick("churches").as_deref(), Some("lorenzo"));
    assert_eq!(pick("hotels").as_deref(), Some("sophia"));
    assert_eq!(pick("bed and breakfast").as_deref(), Some("sophia"));
    assert_eq!(pick("getting-here").as_deref(), Some("marco"));
    assert_eq!(pick("practical-info").as_deref(), Some("marco"));
    assert_eq!(pick("photography").as_deref(), Some("francesca"));
    assert_eq!(pick("sunset").as_deref(), Some("francesca"));
    // partial match (legacy: "local-cuisine-guide" contains "local-cuisine")
    assert_eq!(pick("local-cuisine-guide").as_deref(), Some("giulia"));
    // no match → Isabella (legacy default); non-writers never get pages
    assert_eq!(pick("finance").as_deref(), Some("isabella"));
    assert_eq!(pick("seo").as_deref(), Some("isabella"));

    // fallbacks when the specialist is not on the team
    let no_giulia = team(&["isabella", "lorenzo", "marco"]);
    let r: Vec<&Persona> = no_giulia.iter().collect();
    assert_eq!(
        best_writer_for("restaurants", &r).as_deref(),
        Some("isabella")
    );
    let no_lorenzo = team(&["sophia", "giulia"]);
    let r: Vec<&Persona> = no_lorenzo.iter().collect();
    assert_eq!(best_writer_for("history", &r).as_deref(), Some("sophia"));
    let only_marco = team(&["marco", "giulia"]);
    let r: Vec<&Persona> = only_marco.iter().collect();
    // lorenzo → sophia → isabella → giulia
    assert_eq!(best_writer_for("museums", &r).as_deref(), Some("giulia"));

    // a team without anyone who writes pages
    let office = team(&["elena", "paolo"]);
    let r: Vec<&Persona> = office.iter().collect();
    assert_eq!(best_writer_for("food", &r), None);
    // a new hire with matching affinities is picked up
    let mixed = team(&["valentina", "marco"]);
    let r: Vec<&Persona> = mixed.iter().collect();
    assert_eq!(best_writer_for("events", &r).as_deref(), Some("valentina"));
}

// ---------------------------------------------------------------- SDK pack schema

fn repo_file(rel: &str) -> String {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// Every property path (`cv.experience[].org`) and every enum, so key sets
/// and wire names can be compared between the two schemas.
fn shape(v: &serde_json::Value, path: &str, out: &mut BTreeSet<String>) {
    if let Some(e) = v.get("enum").and_then(|e| e.as_array()) {
        let mut vals: Vec<&str> = e.iter().filter_map(|x| x.as_str()).collect();
        vals.sort_unstable();
        out.insert(format!("{path} enum {}", vals.join(",")));
    }
    if let Some(props) = v.get("properties").and_then(|p| p.as_object()) {
        for (k, sub) in props {
            let p = if path.is_empty() {
                k.clone()
            } else {
                format!("{path}.{k}")
            };
            out.insert(p.clone());
            shape(sub, &p, out);
        }
    }
    if let Some(items) = v.get("items") {
        shape(items, &format!("{path}[]"), out);
    }
}

/// `packages/sdk/schemas/persona.schema.json` (generated from the SDK's zod
/// `PersonaSchema`) must describe exactly the Rust `Persona`: the same keys
/// at every level and the same role/department/seniority wire names. The
/// Rust catalog is the source of truth; fix the SDK schema when this fails.
#[test]
fn sdk_pack_persona_schema_matches_rust() {
    let sdk: serde_json::Value =
        serde_json::from_str(&repo_file("packages/sdk/schemas/persona.schema.json")).unwrap();
    let (mut a, mut b) = (BTreeSet::new(), BTreeSet::new());
    shape(&persona_json_schema(), "", &mut a);
    shape(&sdk, "", &mut b);
    let only_rust: Vec<_> = a.difference(&b).collect();
    let only_sdk: Vec<_> = b.difference(&a).collect();
    assert!(
        only_rust.is_empty() && only_sdk.is_empty(),
        "persona schema drift\n  only in Rust: {only_rust:?}\n  only in SDK: {only_sdk:?}"
    );
    assert_eq!(sdk["additionalProperties"], false);

    let v = claude::SchemaValidator::new(&sdk).unwrap();
    for p in Catalog::builtin().all() {
        v.validate(&serde_json::to_value(p).unwrap())
            .unwrap_or_else(|e| panic!("{} vs the SDK schema: {e:?}", p.slug));
    }
}

/// Example pack personas are real v2 personas the Rust loader accepts.
#[test]
fn example_pack_personas_load_in_rust() {
    let rosa = Persona::from_toml_str(&repo_file(
        "examples/extensions/harvest-season/content/personas/rosa.toml",
    ))
    .unwrap_or_else(|e| panic!("rosa: {e}"));
    assert_eq!((rosa.slug.as_str(), rosa.role), ("rosa", Role::Writer));
    assert!(Catalog::builtin().by_id(rosa.id).is_none());
}
