//! One structural type system for blueprints and tools (design §3.2).
//!
//! A type is a named schema in a restricted JSON Schema subset: closed
//! `object`s, `array`, `string`, `integer`, `number`, `boolean`, `enum`, and
//! `$ref` to another named type (including `LocalizedString`). A type
//! *expression* names a type and may mark it a list (`Article[]`) or optional
//! (`Weather?`).
//!
//! [`TypeRegistry::fits`] decides whether a producer's value can stand where
//! a consumer expects one: every field the consumer requires must exist in
//! the producer with a fitting type; extra producer fields are fine; an
//! `integer` fits a `number`, a `string` fits a `LocalizedString` (v2 text
//! fields take either) and an `enum` fits a `string` or a wider `enum`. The
//! same check serves block slots, tool ports and the bindings between them.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::issue::{Issue, IssueCode};

/// How deep `fits` follows references before it gives up (recursive types).
const MAX_DEPTH: u32 = 16;

/// A type: one of the subset's shapes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Ty {
    String,
    Integer,
    Number,
    Boolean,
    /// `{ "en": …, "<lang>": … }`, `en` required.
    Localized,
    Enum(BTreeSet<String>),
    Array(Box<Ty>),
    /// Field name → (type, required). Closed: no other fields.
    Object(BTreeMap<String, (Ty, bool)>),
    /// Another named type.
    Ref(String),
}

/// A type expression: `Name`, `Name[]`, `Name?`, `Name[]?`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TypeExpr {
    pub name: String,
    pub list: bool,
    pub optional: bool,
}

impl TypeExpr {
    pub fn parse(s: &str) -> Result<TypeExpr, String> {
        let (rest, optional) = match s.strip_suffix('?') {
            Some(r) => (r, true),
            None => (s, false),
        };
        let (name, list) = match rest.strip_suffix("[]") {
            Some(r) => (r, true),
            None => (rest, false),
        };
        let ok = !name.is_empty()
            && name.len() <= 64
            && name.as_bytes()[0].is_ascii_alphabetic()
            && name.bytes().all(|c| c.is_ascii_alphanumeric());
        if !ok {
            return Err(format!(
                "{s:?} is not a type expression (Name, Name[], Name? or Name[]?)"
            ));
        }
        Ok(TypeExpr {
            name: name.to_string(),
            list,
            optional,
        })
    }

    /// The same type, one item of a list.
    pub fn item(&self) -> TypeExpr {
        TypeExpr {
            name: self.name.clone(),
            list: false,
            optional: false,
        }
    }
}

impl std::fmt::Display for TypeExpr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}{}{}",
            self.name,
            if self.list { "[]" } else { "" },
            if self.optional { "?" } else { "" }
        )
    }
}

/// The scalar and built-in type names.
pub const SCALARS: [&str; 4] = ["string", "integer", "number", "boolean"];

fn obj(fields: &[(&str, Ty, bool)]) -> Ty {
    Ty::Object(
        fields
            .iter()
            .map(|(n, t, r)| (n.to_string(), (t.clone(), *r)))
            .collect(),
    )
}

fn builtins() -> BTreeMap<String, Ty> {
    let s = Ty::String;
    let loc = Ty::Localized;
    let page = [
        ("id", s.clone(), true),
        ("path", s.clone(), true),
        ("page_type", s.clone(), true),
        ("route", s.clone(), true),
        ("title", loc.clone(), true),
    ];
    let mut article = page.to_vec();
    article.push(("published_at", s.clone(), false));
    article.push(("hero", Ty::Ref("Media".into()), false));
    let entity = [
        ("slug", s.clone(), true),
        ("name", s.clone(), true),
        ("canonical_url", s.clone(), false),
    ];
    let mut out = BTreeMap::new();
    out.insert("string".into(), Ty::String);
    out.insert("integer".into(), Ty::Integer);
    out.insert("number".into(), Ty::Number);
    out.insert("boolean".into(), Ty::Boolean);
    out.insert("LocalizedString".into(), Ty::Localized);
    out.insert(
        "Media".into(),
        obj(&[
            ("id", s.clone(), true),
            ("url", s.clone(), true),
            ("alt", loc.clone(), false),
        ]),
    );
    out.insert("Page".into(), obj(&page));
    out.insert("Article".into(), obj(&article));
    out.insert(
        "FeedItem".into(),
        obj(&[
            ("title", s.clone(), true),
            ("link", s.clone(), true),
            ("published", s.clone(), false),
            ("summary", s.clone(), false),
        ]),
    );
    out.insert(
        "SearchResult".into(),
        obj(&[
            ("title", s.clone(), true),
            ("url", s.clone(), true),
            ("snippet", s.clone(), false),
        ]),
    );
    for kind in ["Village", "Trail", "Transport", "Category"] {
        out.insert(kind.into(), obj(&entity));
    }
    out
}

/// Built-in types plus a site's own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypeRegistry {
    types: BTreeMap<String, Ty>,
    builtin: BTreeSet<String>,
}

impl Default for TypeRegistry {
    fn default() -> Self {
        let types = builtins();
        let builtin = types.keys().cloned().collect();
        TypeRegistry { types, builtin }
    }
}

/// A JSON Schema of the subset as a [`Ty`]; `path` is for issues.
pub fn parse_schema(v: &Value, path: &str) -> Result<Ty, Vec<Issue>> {
    let bad = |m: String| vec![Issue::new(IssueCode::BadType, path, m)];
    let Some(o) = v.as_object() else {
        return Err(bad("a type is a JSON Schema object".into()));
    };
    if let Some(r) = o.get("$ref") {
        let name = r.as_str().unwrap_or_default();
        let name = name.strip_prefix("#/types/").unwrap_or(name);
        TypeExpr::parse(name).map_err(bad)?;
        return Ok(Ty::Ref(name.to_string()));
    }
    if let Some(values) = o.get("enum") {
        let set: BTreeSet<String> = values
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect();
        if set.is_empty() || values.as_array().map(Vec::len) != Some(set.len()) {
            return Err(bad("an enum lists distinct strings".into()));
        }
        return Ok(Ty::Enum(set));
    }
    let known = [
        "type",
        "items",
        "properties",
        "required",
        "additionalProperties",
        "description",
        "title",
    ];
    if let Some(k) = o.keys().find(|k| !known.contains(&k.as_str())) {
        return Err(bad(format!("`{k}` is outside the type subset")));
    }
    match o.get("type").and_then(Value::as_str) {
        Some("string") => Ok(Ty::String),
        Some("integer") => Ok(Ty::Integer),
        Some("number") => Ok(Ty::Number),
        Some("boolean") => Ok(Ty::Boolean),
        Some("array") => {
            let items = o
                .get("items")
                .ok_or_else(|| bad("an array names its items".into()))?;
            Ok(Ty::Array(Box::new(parse_schema(
                items,
                &format!("{path}/items"),
            )?)))
        }
        Some("object") => {
            if o.get("additionalProperties") != Some(&Value::Bool(false)) {
                return Err(bad(
                    "an object is closed: \"additionalProperties\": false".into()
                ));
            }
            let required: BTreeSet<&str> = o
                .get("required")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let mut fields = BTreeMap::new();
            let mut issues = Vec::new();
            let props = o.get("properties").and_then(Value::as_object);
            for (name, schema) in props.into_iter().flatten() {
                match parse_schema(schema, &format!("{path}/properties/{name}")) {
                    Ok(t) => {
                        fields.insert(name.clone(), (t, required.contains(name.as_str())));
                    }
                    Err(mut e) => issues.append(&mut e),
                }
            }
            for r in &required {
                if !fields.contains_key(*r) {
                    issues.push(Issue::new(
                        IssueCode::BadType,
                        path,
                        format!("required field {r} has no property"),
                    ));
                }
            }
            if issues.is_empty() {
                Ok(Ty::Object(fields))
            } else {
                Err(issues)
            }
        }
        Some(other) => Err(bad(format!("type {other:?} is outside the subset"))),
        None => Err(bad("a type names its `type`, `enum` or `$ref`".into())),
    }
}

impl TypeRegistry {
    /// The built-ins plus `types` (name → schema). A site type may not reuse a
    /// built-in name, and every reference must resolve.
    pub fn with_site(types: &BTreeMap<String, Value>) -> Result<TypeRegistry, Vec<Issue>> {
        let mut reg = TypeRegistry::default();
        let mut issues = Vec::new();
        for (name, schema) in types {
            let path = format!("/types/{name}");
            if let Err(m) = TypeExpr::parse(name).and_then(|t| {
                if t.list || t.optional {
                    Err(format!("{name:?} is a name, not an expression"))
                } else {
                    Ok(())
                }
            }) {
                issues.push(Issue::new(IssueCode::BadType, &path, m));
                continue;
            }
            if reg.builtin.contains(name) {
                issues.push(Issue::new(
                    IssueCode::BadType,
                    &path,
                    format!("{name} is a built-in type"),
                ));
                continue;
            }
            match parse_schema(schema, &path) {
                Ok(t) => {
                    reg.types.insert(name.clone(), t);
                }
                Err(mut e) => issues.append(&mut e),
            }
        }
        for (name, t) in &reg.types {
            let mut refs = BTreeSet::new();
            collect_refs(t, &mut refs);
            for r in refs {
                if !reg.types.contains_key(&r) {
                    issues.push(Issue::new(
                        IssueCode::UnknownType,
                        format!("/types/{name}"),
                        format!("{name} refers to {r}, which is not a type"),
                    ));
                }
            }
        }
        if issues.is_empty() {
            Ok(reg)
        } else {
            Err(issues)
        }
    }

    pub fn get(&self, name: &str) -> Option<&Ty> {
        self.types.get(name)
    }

    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.types.keys().map(String::as_str)
    }

    /// Whether the expression names a known type.
    pub fn knows(&self, t: &TypeExpr) -> bool {
        self.types.contains_key(&t.name)
    }

    /// Whether a producer of `producer` can feed a consumer of `consumer`.
    /// `Err` lists why not, field by field.
    pub fn fits(&self, producer: &TypeExpr, consumer: &TypeExpr) -> Result<(), Vec<String>> {
        let mut why = Vec::new();
        if producer.optional && !consumer.optional {
            why.push(format!("{producer} may be missing; {consumer} is required"));
        }
        if producer.list != consumer.list {
            why.push(format!(
                "{producer} is {} list; {consumer} is {}",
                if producer.list { "a" } else { "not a" },
                if consumer.list { "one" } else { "not" }
            ));
        }
        match (self.get(&producer.name), self.get(&consumer.name)) {
            (None, _) => why.push(format!("{} is not a type", producer.name)),
            (_, None) => why.push(format!("{} is not a type", consumer.name)),
            (Some(p), Some(c)) => self.fits_ty(p, c, "", 0, &mut why),
        }
        if why.is_empty() {
            Ok(())
        } else {
            Err(why)
        }
    }

    /// [`Self::fits`] for types without a name (a field's type, a list's item).
    pub fn fits_shape(&self, producer: &Ty, consumer: &Ty) -> Result<(), Vec<String>> {
        let mut why = Vec::new();
        self.fits_ty(producer, consumer, "", 0, &mut why);
        if why.is_empty() {
            Ok(())
        } else {
            Err(why)
        }
    }

    /// The type of an expression (lists as arrays; `?` is a binding matter, not a shape).
    pub fn ty_of(&self, t: &TypeExpr) -> Ty {
        let base = Ty::Ref(t.name.clone());
        if t.list {
            Ty::Array(Box::new(base))
        } else {
            base
        }
    }

    /// The type found at `path` (`$`, `$.a.b`, `$.items[0].name`, `$.items[]`)
    /// inside `t`, if every step exists. `[n]` and `[]` step into an array.
    pub fn type_at(&self, t: &Ty, path: &str) -> Option<Ty> {
        let rest = path.strip_prefix('$')?;
        let mut cur = t.clone();
        let mut chars = rest;
        while !chars.is_empty() {
            if let Some(r) = chars.strip_prefix('.') {
                let end = r.find(['.', '[']).unwrap_or(r.len());
                let name = &r[..end];
                if name.is_empty() {
                    return None;
                }
                match self.resolve(&cur)? {
                    Ty::Object(f) => cur = f.get(name)?.0.clone(),
                    _ => return None,
                }
                chars = &r[end..];
            } else {
                let r = chars.strip_prefix('[')?;
                let end = r.find(']')?;
                let idx = &r[..end];
                if !idx.is_empty() && !idx.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                match self.resolve(&cur)? {
                    Ty::Array(item) => cur = (**item).clone(),
                    _ => return None,
                }
                chars = &r[end + 1..];
            }
        }
        Some(cur)
    }

    /// Whether a JSON value is of type `t`: field-path reasons when not.
    /// Closed objects refuse extra fields; an `integer` is a whole number; a
    /// `LocalizedString` is a string or an object with `en`; `null` is only
    /// an optional value. The runtime twin of the TypeScript interpreter's
    /// `validate` (`packages/toolgraph/src/types.ts`).
    pub fn validate(&self, v: &Value, t: &TypeExpr) -> Result<(), Vec<String>> {
        let mut why = Vec::new();
        if v.is_null() {
            if !t.optional {
                why.push("the value: missing".into());
            }
        } else {
            let ty = self.ty_of(t);
            self.validate_ty(v, &ty, "", 0, &mut why);
        }
        if why.is_empty() {
            Ok(())
        } else {
            Err(why)
        }
    }

    fn validate_ty(&self, v: &Value, t: &Ty, at: &str, depth: u32, why: &mut Vec<String>) {
        let here = if at.is_empty() {
            "the value".to_string()
        } else {
            at.to_string()
        };
        if why.len() >= 20 || depth > MAX_DEPTH {
            return;
        }
        let Some(t) = self.resolve(t) else {
            why.push(format!("{here}: an unknown type"));
            return;
        };
        let bad = |what: &str, why: &mut Vec<String>| why.push(format!("{here}: not {what}"));
        match t {
            Ty::String => {
                if !v.is_string() {
                    bad("a string", why)
                }
            }
            Ty::Integer => {
                if !(v.is_i64() || v.is_u64()) {
                    bad("an integer", why)
                }
            }
            Ty::Number => {
                if !v.is_number() {
                    bad("a number", why)
                }
            }
            Ty::Boolean => {
                if !v.is_boolean() {
                    bad("a boolean", why)
                }
            }
            Ty::Localized => match v {
                Value::String(_) => {}
                Value::Object(o)
                    if o.get("en").is_some_and(Value::is_string)
                        && o.values().all(Value::is_string) => {}
                _ => bad("a LocalizedString (a string or {en, …})", why),
            },
            Ty::Enum(set) => {
                if !v.as_str().is_some_and(|s| set.contains(s)) {
                    bad(
                        &format!(
                            "one of {}",
                            set.iter().cloned().collect::<Vec<_>>().join(", ")
                        ),
                        why,
                    )
                }
            }
            Ty::Array(item) => match v.as_array() {
                None => bad("a list", why),
                Some(a) => {
                    for (i, x) in a.iter().enumerate() {
                        self.validate_ty(x, item, &format!("{at}[{i}]"), depth + 1, why);
                    }
                }
            },
            Ty::Object(fields) => match v.as_object() {
                None => bad("an object", why),
                Some(o) => {
                    for (name, (ft, required)) in fields {
                        let path = if at.is_empty() {
                            name.clone()
                        } else {
                            format!("{at}.{name}")
                        };
                        match o.get(name) {
                            None | Some(Value::Null) if *required => {
                                why.push(format!("{path}: missing"))
                            }
                            None | Some(Value::Null) => {}
                            Some(x) => self.validate_ty(x, ft, &path, depth + 1, why),
                        }
                    }
                    for k in o.keys().filter(|k| !fields.contains_key(*k)) {
                        let path = if at.is_empty() {
                            k.clone()
                        } else {
                            format!("{at}.{k}")
                        };
                        why.push(format!("{path}: not a field of this type"));
                    }
                }
            },
            Ty::Ref(_) => why.push(format!("{here}: a reference does not resolve")),
        }
    }

    fn resolve<'a>(&'a self, t: &'a Ty) -> Option<&'a Ty> {
        let mut t = t;
        for _ in 0..MAX_DEPTH {
            match t {
                Ty::Ref(name) => t = self.types.get(name)?,
                other => return Some(other),
            }
        }
        None
    }

    fn fits_ty(&self, p: &Ty, c: &Ty, at: &str, depth: u32, why: &mut Vec<String>) {
        let here = if at.is_empty() { "the value" } else { at };
        if depth > MAX_DEPTH {
            why.push(format!("{here}: types nest too deeply to compare"));
            return;
        }
        let (Some(p), Some(c)) = (self.resolve(p), self.resolve(c)) else {
            why.push(format!("{here}: a reference does not resolve"));
            return;
        };
        match (p, c) {
            (Ty::String, Ty::String)
            | (Ty::Integer, Ty::Integer)
            | (Ty::Integer, Ty::Number)
            | (Ty::Number, Ty::Number)
            | (Ty::Boolean, Ty::Boolean)
            | (Ty::Localized, Ty::Localized)
            | (Ty::String, Ty::Localized)
            | (Ty::Enum(_), Ty::String) => {}
            (Ty::Enum(a), Ty::Enum(b)) => {
                let extra: Vec<&String> = a.difference(b).collect();
                if !extra.is_empty() {
                    why.push(format!(
                        "{here}: values {} are not allowed",
                        extra
                            .iter()
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ));
                }
            }
            (Ty::Array(a), Ty::Array(b)) => self.fits_ty(a, b, &format!("{at}[]"), depth + 1, why),
            (Ty::Object(pf), Ty::Object(cf)) => {
                for (name, (ct, required)) in cf {
                    let path = if at.is_empty() {
                        name.clone()
                    } else {
                        format!("{at}.{name}")
                    };
                    match pf.get(name) {
                        None if *required => why.push(format!("{path}: missing")),
                        None => {}
                        Some((pt, preq)) => {
                            if *required && !preq {
                                why.push(format!("{path}: may be missing"));
                            }
                            self.fits_ty(pt, ct, &path, depth + 1, why);
                        }
                    }
                }
            }
            (p, c) => why.push(format!("{here}: {} does not fit {}", shape(p), shape(c))),
        }
    }
}

fn shape(t: &Ty) -> &'static str {
    match t {
        Ty::String => "string",
        Ty::Integer => "integer",
        Ty::Number => "number",
        Ty::Boolean => "boolean",
        Ty::Localized => "LocalizedString",
        Ty::Enum(_) => "enum",
        Ty::Array(_) => "array",
        Ty::Object(_) => "object",
        Ty::Ref(_) => "reference",
    }
}

fn collect_refs(t: &Ty, out: &mut BTreeSet<String>) {
    match t {
        Ty::Ref(n) => {
            out.insert(n.clone());
        }
        Ty::Array(a) => collect_refs(a, out),
        Ty::Object(f) => f.values().for_each(|(t, _)| collect_refs(t, out)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn t(s: &str) -> TypeExpr {
        TypeExpr::parse(s).unwrap()
    }

    fn site() -> TypeRegistry {
        let types: BTreeMap<String, Value> = serde_json::from_value(json!({
            "Weather": { "type": "object", "additionalProperties": false,
                "required": ["temperature", "condition"],
                "properties": {
                    "temperature": { "type": "integer" },
                    "condition": { "enum": ["sun", "rain"] },
                    "note": { "type": "string" }
                } },
            "WeatherCard": { "type": "object", "additionalProperties": false,
                "required": ["temperature"],
                "properties": {
                    "temperature": { "type": "number" },
                    "condition": { "type": "string" }
                } },
            "Teaser": { "type": "object", "additionalProperties": false,
                "required": ["title", "hero"],
                "properties": { "title": { "$ref": "LocalizedString" }, "hero": { "$ref": "Media" } } }
        }))
        .unwrap();
        TypeRegistry::with_site(&types).unwrap()
    }

    #[test]
    fn expressions_parse_and_print() {
        for s in ["Article", "Article[]", "Weather?", "Article[]?", "string"] {
            assert_eq!(t(s).to_string(), s);
        }
        for bad in ["", "[]", "Article?[]", "a-b", "Ärticle", "Article[][]"] {
            assert!(TypeExpr::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn structural_fit() {
        let r = site();
        assert_eq!(r.fits(&t("Weather"), &t("WeatherCard")), Ok(()));
        assert_eq!(r.fits(&t("Weather[]"), &t("WeatherCard[]")), Ok(()));
        assert_eq!(r.fits(&t("Weather"), &t("WeatherCard?")), Ok(()));
        let why = r.fits(&t("WeatherCard"), &t("Weather")).unwrap_err();
        assert!(
            why.contains(&"temperature: number does not fit integer".to_string()),
            "{why:?}"
        );
        assert!(
            why.contains(&"condition: may be missing".to_string()),
            "{why:?}"
        );
        assert!(r.fits(&t("Weather?"), &t("WeatherCard")).is_err());
        assert!(r.fits(&t("Weather[]"), &t("WeatherCard")).is_err());
        // Built-ins: an article is a page; a page is not an article only if
        // the article requires more, and it does not.
        assert_eq!(r.fits(&t("Article"), &t("Page")), Ok(()));
        assert_eq!(r.fits(&t("Page"), &t("Article")), Ok(()));
        assert!(r.fits(&t("Page"), &t("Teaser")).is_err());
        assert_eq!(r.fits(&t("string"), &t("LocalizedString")), Ok(()));
        assert!(r.fits(&t("LocalizedString"), &t("string")).is_err());
        assert_eq!(r.fits(&t("integer"), &t("number")), Ok(()));
        assert!(r.fits(&t("Nope"), &t("Page")).is_err());
    }

    #[test]
    fn values_are_validated() {
        let r = site();
        let ok = json!({ "temperature": 21, "condition": "sun" });
        assert_eq!(r.validate(&ok, &t("Weather")), Ok(()));
        assert_eq!(
            r.validate(&json!([ok.clone(), ok.clone()]), &t("Weather[]")),
            Ok(())
        );
        assert_eq!(r.validate(&Value::Null, &t("Weather?")), Ok(()));
        let why = r
            .validate(
                &json!({ "temperature": 2.5, "condition": "fog", "wind": 3 }),
                &t("Weather"),
            )
            .unwrap_err();
        assert!(
            why.contains(&"temperature: not an integer".to_string()),
            "{why:?}"
        );
        assert!(
            why.iter().any(|w| w.starts_with("condition: not one of")),
            "{why:?}"
        );
        assert!(
            why.contains(&"wind: not a field of this type".to_string()),
            "{why:?}"
        );
        let why = r
            .validate(&json!([{ "temperature": 1 }]), &t("Weather[]"))
            .unwrap_err();
        assert_eq!(why, ["[0].condition: missing"]);
        assert!(r
            .validate(
                &json!({ "title": { "de": "x" }, "hero": { "id": "m", "url": "u" } }),
                &t("Teaser")
            )
            .is_err());
        assert_eq!(
            r.validate(
                &json!({ "title": "x", "hero": { "id": "m", "url": "u" } }),
                &t("Teaser")
            ),
            Ok(())
        );
        assert!(r.validate(&Value::Null, &t("Weather")).is_err());
    }

    #[test]
    fn the_subset_is_enforced() {
        let bad = |v: Value| {
            let types: BTreeMap<String, Value> = BTreeMap::from([("X".to_string(), v)]);
            TypeRegistry::with_site(&types).unwrap_err()
        };
        assert_eq!(
            bad(json!({ "type": "object", "properties": {} }))[0].code,
            IssueCode::BadType
        );
        assert_eq!(bad(json!({ "oneOf": [] }))[0].code, IssueCode::BadType);
        assert_eq!(
            bad(json!({ "type": "string", "pattern": "x" }))[0].code,
            IssueCode::BadType
        );
        assert_eq!(
            bad(json!({ "$ref": "Missing" }))[0].code,
            IssueCode::UnknownType
        );
        let shadow: BTreeMap<String, Value> =
            BTreeMap::from([("Article".to_string(), json!({ "type": "string" }))]);
        assert!(TypeRegistry::with_site(&shadow).is_err());
    }
}
