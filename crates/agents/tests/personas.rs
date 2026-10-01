use agents::personas::{
    format_persona_for_prompt, format_work_style, format_writing_style_for_prompt, WritingStyle,
};
use agents::{Persona, Role, Seniority, Traits};

const NAMES: [&str; 6] = [
    "Giulia",
    "Isabella",
    "Lorenzo",
    "Sophia",
    "Marco",
    "Francesca",
];

#[test]
fn all_six_builtin_personas_load() {
    let all = Persona::builtin_all();
    assert_eq!(
        all.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        NAMES
    );
    for p in &all {
        assert_eq!(
            p.seniority,
            Seniority::Senior,
            "{} imported as Senior (plan C.6)",
            p.name
        );
        p.traits.validate().unwrap();
        for lang in ["en", "de", "fr", "it"] {
            assert_eq!(p.phrases(lang).len(), 5, "{} {lang}", p.name);
        }
        assert!(!p.persona.starts_with('\n'));
    }
    assert_eq!(Persona::builtin("Francesca").unwrap().role, Role::Media);
    assert_eq!(Persona::builtin("Giulia").unwrap().role, Role::Writer);
    assert!(Persona::builtin("Nobody").is_none());
}

#[test]
fn persona_prompt_snapshots() {
    for name in NAMES {
        let p = Persona::builtin(name).unwrap();
        insta::assert_snapshot!(
            format!("persona_{}", name.to_lowercase()),
            format_persona_for_prompt(&p, "en")
        );
    }
}

#[test]
fn persona_prompt_uses_language_phrases_with_en_fallback() {
    let p = Persona::builtin("Lorenzo").unwrap();
    insta::assert_snapshot!("persona_lorenzo_de", format_persona_for_prompt(&p, "de"));
    let es = format_persona_for_prompt(&p, "es");
    assert!(es.contains("- \"The origins of this village date to...\""));
}

#[test]
fn writing_style_snapshots() {
    for name in NAMES {
        let p = Persona::builtin(name).unwrap();
        insta::assert_snapshot!(
            format!("writing_style_{}", name.to_lowercase()),
            format_writing_style_for_prompt(&p.writing_style)
        );
    }
}

#[test]
fn writing_style_matches_legacy_for_marco() {
    let p = Persona::builtin("Marco").unwrap();
    assert_eq!(
        format_writing_style_for_prompt(&p.writing_style),
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
    let p = Persona::builtin("Lorenzo").unwrap();
    insta::assert_snapshot!(
        "work_style_lorenzo",
        format_work_style(&p.traits, p.seniority)
    );
}

#[test]
fn invalid_persona_toml_fails_loudly() {
    let src = agents::personas::Persona::builtin("Marco").unwrap();
    let mut toml_src = toml::to_string(&src).unwrap();
    toml_src = toml_src.replace("rigor = 90", "rigor = 150");
    assert!(Persona::from_toml_str(&toml_src).is_err());
}
