//! Localized values.
//!
//! * [`LocalizedString`] is the strict v1 shape: an object keyed by language
//!   code with a required `en` entry (the fallback locale).
//! * [`Localized<T>`] is the schema-v2 shape for text fields: either a plain
//!   value (language-neutral, or authored in the page's only language) or an
//!   object keyed by language code. Real cinqueterre content already uses
//!   localized objects in places where the v1 schema says `string`, so v2
//!   accepts both.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The fallback language. Every localized object must carry it.
pub const FALLBACK_LANG: &str = "en";

/// Returns true for language keys we accept in localized objects:
/// `xx` or `xx-YY` / `xx-Yyyy` (BCP 47 language + optional region/script).
pub fn is_lang_code(key: &str) -> bool {
    let mut parts = key.split('-');
    let lang = parts.next().unwrap_or_default();
    if lang.len() != 2 || !lang.bytes().all(|b| b.is_ascii_lowercase()) {
        return false;
    }
    match (parts.next(), parts.next()) {
        (None, _) => true,
        (Some(sub), None) => {
            (2..=4).contains(&sub.len()) && sub.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        _ => false,
    }
}

/// Strict multi-language string: `en` is required.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalizedString {
    pub en: String,
    #[serde(flatten)]
    pub other: BTreeMap<String, String>,
}

impl LocalizedString {
    pub fn new(en: impl Into<String>) -> Self {
        Self {
            en: en.into(),
            other: BTreeMap::new(),
        }
    }

    pub fn with(mut self, lang: &str, value: impl Into<String>) -> Self {
        if lang == FALLBACK_LANG {
            self.en = value.into();
        } else {
            self.other.insert(lang.to_string(), value.into());
        }
        self
    }

    /// Value for `lang`, if present (no fallback).
    pub fn get_exact(&self, lang: &str) -> Option<&str> {
        if lang == FALLBACK_LANG {
            Some(&self.en)
        } else {
            self.other.get(lang).map(String::as_str)
        }
    }

    /// Value for `lang`, falling back to `en`.
    pub fn get(&self, lang: &str) -> &str {
        self.get_exact(lang).unwrap_or(&self.en)
    }

    /// All languages present, `en` first.
    pub fn langs(&self) -> impl Iterator<Item = &str> {
        std::iter::once(FALLBACK_LANG).chain(self.other.keys().map(String::as_str))
    }

    /// Iterate `(lang, value)` pairs, `en` first.
    pub fn iter(&self) -> impl Iterator<Item = (&str, &str)> {
        std::iter::once((FALLBACK_LANG, self.en.as_str()))
            .chain(self.other.iter().map(|(k, v)| (k.as_str(), v.as_str())))
    }
}

/// Schema-v2 localized value: a plain value or `{ "<lang>": value, ... }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Localized<T> {
    Plain(T),
    ByLang(BTreeMap<String, T>),
}

/// The common case: localized text.
pub type LocalizedText = Localized<String>;

impl<T> Localized<T> {
    /// Value for `lang`, falling back to `en`; a plain value answers every language.
    pub fn get(&self, lang: &str) -> Option<&T> {
        match self {
            Localized::Plain(v) => Some(v),
            Localized::ByLang(m) => m.get(lang).or_else(|| m.get(FALLBACK_LANG)),
        }
    }

    /// Value for `lang` without falling back (plain values answer every language).
    pub fn get_exact(&self, lang: &str) -> Option<&T> {
        match self {
            Localized::Plain(v) => Some(v),
            Localized::ByLang(m) => m.get(lang),
        }
    }

    /// A plain value, or a localized object that carries the fallback language.
    pub fn has_fallback(&self) -> bool {
        match self {
            Localized::Plain(_) => true,
            Localized::ByLang(m) => m.contains_key(FALLBACK_LANG),
        }
    }

    pub fn is_localized(&self) -> bool {
        matches!(self, Localized::ByLang(_))
    }
}

impl From<LocalizedString> for LocalizedText {
    fn from(value: LocalizedString) -> Self {
        let mut m = value.other;
        m.insert(FALLBACK_LANG.to_string(), value.en);
        Localized::ByLang(m)
    }
}

impl From<&str> for LocalizedText {
    fn from(value: &str) -> Self {
        Localized::Plain(value.to_string())
    }
}

/// Reads a JSON value that may be a plain string or a localized object.
/// Returns the text for `lang` (falling back to `en`, then to any value).
pub fn text_of(value: &serde_json::Value, lang: &str) -> Option<String> {
    match value {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(m) => m
            .get(lang)
            .or_else(|| m.get(FALLBACK_LANG))
            .or_else(|| m.values().next())
            .and_then(|v| v.as_str())
            .map(str::to_string),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn localized_string_requires_en() {
        let ok: LocalizedString =
            serde_json::from_value(json!({"en": "Hi", "de": "Hallo"})).unwrap();
        assert_eq!(ok.get("de"), "Hallo");
        assert_eq!(ok.get("fr"), "Hi");
        assert!(serde_json::from_value::<LocalizedString>(json!({"de": "Hallo"})).is_err());
        assert_eq!(ok.langs().collect::<Vec<_>>(), vec!["en", "de"]);
    }

    #[test]
    fn localized_accepts_plain_and_object() {
        let plain: LocalizedText = serde_json::from_value(json!("Hello")).unwrap();
        assert_eq!(plain.get("it").unwrap(), "Hello");
        let obj: LocalizedText = serde_json::from_value(json!({"en": "Hi", "it": "Ciao"})).unwrap();
        assert_eq!(obj.get("it").unwrap(), "Ciao");
        assert_eq!(obj.get("fr").unwrap(), "Hi");
        assert_eq!(obj.get_exact("fr"), None);
        assert!(obj.has_fallback());
        let no_en: LocalizedText = serde_json::from_value(json!({"it": "Ciao"})).unwrap();
        assert!(!no_en.has_fallback());
    }

    #[test]
    fn lang_codes() {
        for ok in ["en", "de", "pt-BR", "zh-Hant"] {
            assert!(is_lang_code(ok), "{ok}");
        }
        for bad in ["EN", "eng", "", "en-", "en-US-x", "title"] {
            assert!(!is_lang_code(bad), "{bad}");
        }
    }

    #[test]
    fn text_of_reads_both_shapes() {
        assert_eq!(text_of(&json!("x"), "de").unwrap(), "x");
        assert_eq!(text_of(&json!({"en": "a", "de": "b"}), "de").unwrap(), "b");
        assert_eq!(text_of(&json!({"en": "a"}), "de").unwrap(), "a");
        assert_eq!(text_of(&json!(3), "de"), None);
    }
}
