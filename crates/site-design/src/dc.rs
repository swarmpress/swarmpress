//! Claude Design's page runtime, read without running it.
//!
//! A Claude Design page is markup inside `<x-dc>` with a small template
//! language: `<sc-for list="{{items}}" as="x" hint-placeholder-count="4">`
//! repeats its children, `<sc-if value="{{flag}}">` shows them,
//! `{{x.name}}` substitutes a value. The values come from a data script
//! (`<script type="text/x-dc">`): a class whose `renderVals()` returns an
//! object. The crate never executes it: [`read_render_vals`] reads the
//! returned object as a JavaScript *literal* (strings, numbers, booleans,
//! arrays, objects, `const` strings and `+` between strings); every other
//! expression (calls, arrow functions, `this.state`) is left out, and a loop
//! over a list that could not be read repeats its children
//! `hint-placeholder-count` times with empty values, as the design tool's
//! own placeholder view does. [`expand`] then gives the static page.
//!
//! One kind of code is read: a `const` **arrow function of plain arithmetic** over its
//! parameters (`const c = (x, y, r) => 'M' + (x - r) + ' ' + y`), called with literal arguments.
//! Such helpers draw an icon set's paths or a curve; they are evaluated exactly (numbers in
//! millionths, no floating point), and anything else in a body makes the call unreadable.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::dom::{El, Node};

/// The most items one loop expands (a design is a few screens, not a database).
pub const MAX_LOOP: usize = 200;

/// A list of data the page loops over, with the label shown above it.
#[derive(Clone, Debug, PartialEq)]
pub struct DataList {
    /// The data key (`core`, `villages`).
    pub key: String,
    /// The nearest label above the loop (`Village pigments — fill only…`).
    pub label: Option<String>,
    /// The items, when the list was a literal.
    pub items: Vec<Value>,
}

// --- the literal reader ------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Ident(String),
    Str(String),
    /// A template literal with `${…}`: not a literal.
    Tpl,
    Num(String),
    Punct(char),
    /// `=>`, `===`, `...` and other multi-character operators.
    Op(String),
}

fn lex(src: &str) -> Vec<Tok> {
    let cs: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < cs.len() {
        let c = cs[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '/' && cs.get(i + 1) == Some(&'/') {
            while i < cs.len() && cs[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && cs.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < cs.len() && !(cs[i] == '*' && cs[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else if c == '\'' || c == '"' || c == '`' {
            let q = c;
            i += 1;
            let mut s = String::new();
            let mut tpl = false;
            while i < cs.len() && cs[i] != q {
                if cs[i] == '\\' && i + 1 < cs.len() {
                    i += 1;
                    s.push(match cs[i] {
                        'n' => '\n',
                        't' => '\t',
                        x => x,
                    });
                } else {
                    if q == '`' && cs[i] == '$' && cs.get(i + 1) == Some(&'{') {
                        tpl = true;
                    }
                    s.push(cs[i]);
                }
                i += 1;
            }
            i += 1;
            out.push(if tpl { Tok::Tpl } else { Tok::Str(s) });
        } else if c.is_ascii_digit()
            || (c == '.' && cs.get(i + 1).is_some_and(char::is_ascii_digit))
        {
            let mut s = String::new();
            while i < cs.len() && (cs[i].is_ascii_alphanumeric() || cs[i] == '.' || cs[i] == '_') {
                s.push(cs[i]);
                i += 1;
            }
            out.push(Tok::Num(s));
        } else if c.is_alphabetic() || c == '_' || c == '$' {
            let mut s = String::new();
            while i < cs.len() && (cs[i].is_alphanumeric() || cs[i] == '_' || cs[i] == '$') {
                s.push(cs[i]);
                i += 1;
            }
            out.push(Tok::Ident(s));
        } else if "{}[](),;:?".contains(c) {
            out.push(Tok::Punct(c));
            i += 1;
        } else {
            let mut s = String::new();
            while i < cs.len() && "=<>!+-*/%&|^.~".contains(cs[i]) {
                s.push(cs[i]);
                i += 1;
            }
            if s.is_empty() {
                s.push(c);
                i += 1;
            }
            if s == "+" {
                out.push(Tok::Punct('+'));
            } else if s == "=" {
                out.push(Tok::Punct('='));
            } else {
                out.push(Tok::Op(s));
            }
        }
    }
    out
}

struct Reader<'a> {
    t: &'a [Tok],
    i: usize,
    consts: BTreeMap<String, Value>,
    /// Arrow functions of plain arithmetic: name → (parameters, body tokens).
    funcs: BTreeMap<String, (Vec<String>, Vec<Tok>)>,
}

/// A value inside an arrow function's body: a number in millionths, or text.
#[derive(Clone, Debug, PartialEq)]
enum Ev {
    Num(i64),
    Str(String),
}

const MICRO: i64 = 1_000_000;

fn ev_num(text: &str) -> Option<i64> {
    let (neg, t) = match text.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, text),
    };
    let (int, frac) = t.split_once('.').unwrap_or((t, ""));
    if int.is_empty() && frac.is_empty() || frac.len() > 6 {
        return None;
    }
    let i: i64 = if int.is_empty() { 0 } else { int.parse().ok()? };
    let mut f = 0i64;
    if !frac.is_empty() {
        f = frac.parse::<i64>().ok()? * 10i64.pow(6 - frac.len() as u32);
    }
    let v = i.checked_mul(MICRO)?.checked_add(f)?;
    Some(if neg { -v } else { v })
}

/// A number in millionths as JavaScript prints it (`6.5`, `-13`, `0.22`).
fn ev_text(n: i64) -> String {
    let sign = if n < 0 { "-" } else { "" };
    let a = n.unsigned_abs();
    let int = a / MICRO as u64;
    let frac = a % MICRO as u64;
    if frac == 0 {
        format!("{sign}{int}")
    } else {
        let f = format!("{frac:06}");
        format!("{sign}{int}.{}", f.trim_end_matches('0'))
    }
}

impl Ev {
    fn of(v: &Value) -> Option<Ev> {
        match v {
            Value::Number(n) => n.as_i64().and_then(|i| i.checked_mul(MICRO)).map(Ev::Num),
            Value::String(s) => Some(match ev_num(s) {
                Some(n)
                    if s.chars()
                        .all(|c| c.is_ascii_digit() || c == '.' || c == '-') =>
                {
                    Ev::Num(n)
                }
                _ => Ev::Str(s.clone()),
            }),
            _ => None,
        }
    }

    fn text(&self) -> String {
        match self {
            Ev::Num(n) => ev_text(*n),
            Ev::Str(s) => s.clone(),
        }
    }
}

/// Evaluates an arrow function's body (plain arithmetic and `+` on text) with its arguments.
struct Body<'a> {
    t: &'a [Tok],
    i: usize,
    env: &'a BTreeMap<String, Ev>,
}

impl Body<'_> {
    fn op(&self, o: &str) -> bool {
        matches!(self.t.get(self.i), Some(Tok::Op(x)) if x == o)
    }

    fn sum(&mut self) -> Option<Ev> {
        let mut acc = self.prod()?;
        loop {
            if self.t.get(self.i) == Some(&Tok::Punct('+')) {
                self.i += 1;
                let r = self.prod()?;
                acc = match (acc, r) {
                    (Ev::Num(a), Ev::Num(b)) => Ev::Num(a.checked_add(b)?),
                    (a, b) => Ev::Str(format!("{}{}", a.text(), b.text())),
                };
            } else if self.op("-") {
                self.i += 1;
                match (acc, self.prod()?) {
                    (Ev::Num(a), Ev::Num(b)) => acc = Ev::Num(a.checked_sub(b)?),
                    _ => return None,
                }
            } else {
                return Some(acc);
            }
        }
    }

    fn prod(&mut self) -> Option<Ev> {
        let mut acc = self.unary()?;
        loop {
            let mul = self.op("*");
            if !(mul || self.op("/")) {
                return Some(acc);
            }
            self.i += 1;
            let (Ev::Num(a), Ev::Num(b)) = (acc, self.unary()?) else {
                return None;
            };
            acc = Ev::Num(if mul {
                (i128::from(a) * i128::from(b) / i128::from(MICRO))
                    .try_into()
                    .ok()?
            } else {
                if b == 0 {
                    return None;
                }
                (i128::from(a) * i128::from(MICRO) / i128::from(b))
                    .try_into()
                    .ok()?
            });
        }
    }

    fn unary(&mut self) -> Option<Ev> {
        if self.op("-") {
            self.i += 1;
            return match self.unary()? {
                Ev::Num(n) => Some(Ev::Num(-n)),
                Ev::Str(_) => None,
            };
        }
        match self.t.get(self.i)?.clone() {
            Tok::Num(n) => {
                self.i += 1;
                ev_num(&n).map(Ev::Num)
            }
            Tok::Str(s) => {
                self.i += 1;
                Some(Ev::Str(s))
            }
            Tok::Ident(id) => {
                self.i += 1;
                self.env.get(&id).cloned()
            }
            Tok::Punct('(') => {
                self.i += 1;
                let v = self.sum()?;
                (self.t.get(self.i) == Some(&Tok::Punct(')'))).then_some(())?;
                self.i += 1;
                Some(v)
            }
            _ => None,
        }
    }
}

impl Reader<'_> {
    fn peek(&self) -> Option<&Tok> {
        self.t.get(self.i)
    }

    fn is(&self, c: char) -> bool {
        self.peek() == Some(&Tok::Punct(c))
    }

    /// Skips one expression: to the next `,` `;` or closer at depth 0.
    fn skip_expr(&mut self) {
        let mut depth = 0i32;
        while let Some(t) = self.peek() {
            match t {
                Tok::Punct('(' | '[' | '{') => depth += 1,
                Tok::Punct(')' | ']' | '}') => {
                    if depth == 0 {
                        return;
                    }
                    depth -= 1;
                }
                Tok::Punct(',' | ';') if depth == 0 => return,
                _ => {}
            }
            self.i += 1;
        }
    }

    /// The position of a top-level `?` in the expression starting here (a conditional).
    fn ternary_at(&self) -> Option<usize> {
        let mut depth = 0i32;
        for (k, t) in self.t.iter().enumerate().skip(self.i) {
            match t {
                Tok::Punct('(' | '[' | '{') => depth += 1,
                Tok::Punct(')' | ']' | '}') => {
                    if depth == 0 {
                        return None;
                    }
                    depth -= 1;
                }
                Tok::Punct(',' | ';') if depth == 0 => return None,
                Tok::Punct('?') if depth == 0 => {
                    // `?.` and `??` are not conditionals.
                    let next = self.t.get(k + 1);
                    return (!matches!(next, Some(Tok::Punct('.' | '?')))
                        && !matches!(self.t.get(k.wrapping_sub(1)), Some(Tok::Punct('?'))))
                    .then_some(k);
                }
                _ => {}
            }
        }
        None
    }

    /// An expression: `Some` when it is a literal, `None` (skipped) otherwise. A conditional
    /// (`f === 'All' ? all : …`) reads as its first branch: the page as it first renders.
    fn expr(&mut self) -> Option<Value> {
        if let Some(q) = self.ternary_at() {
            self.i = q + 1;
            let v = self.branch();
            self.skip_expr();
            return v;
        }
        self.expr_plain()
    }

    /// A conditional's first branch, up to its `:`.
    fn branch(&mut self) -> Option<Value> {
        let start = self.i;
        let v = self.term();
        if v.is_some() && self.is(':') {
            self.i += 1;
            return v;
        }
        self.i = start;
        None
    }

    fn expr_plain(&mut self) -> Option<Value> {
        let start = self.i;
        let v = self.term();
        let v = match v {
            Some(mut acc) => {
                let mut ok = true;
                while self.is('+') {
                    self.i += 1;
                    match (self.term(), &acc) {
                        (Some(r), Value::String(a)) => {
                            acc = Value::String(format!("{a}{}", scalar(&r)));
                        }
                        (Some(Value::String(r)), Value::Number(n)) => {
                            acc = Value::String(format!("{n}{r}"));
                        }
                        _ => {
                            ok = false;
                            break;
                        }
                    }
                }
                ok.then_some(acc)
            }
            None => None,
        };
        // Anything after the literal other than a delimiter makes it an expression.
        let at_end = matches!(
            self.peek(),
            None | Some(Tok::Punct(',' | ';' | ')' | ']' | '}'))
        );
        if v.is_some() && at_end {
            return v;
        }
        self.i = start;
        self.skip_expr();
        None
    }

    fn term(&mut self) -> Option<Value> {
        match self.peek()?.clone() {
            Tok::Str(s) => {
                self.i += 1;
                Some(Value::String(s))
            }
            Tok::Num(n) => {
                self.i += 1;
                if let Ok(i) = n.parse::<i64>() {
                    Some(Value::from(i))
                } else {
                    // Fractions stay text: the crate is integer-only.
                    Some(Value::String(n))
                }
            }
            Tok::Ident(id) => {
                self.i += 1;
                match id.as_str() {
                    "true" => Some(Value::Bool(true)),
                    "false" => Some(Value::Bool(false)),
                    "null" | "undefined" => Some(Value::Null),
                    _ if self.is('(') && self.funcs.contains_key(&id) => self.call(&id),
                    _ if self.is('(') || self.is('.') => None,
                    _ => self.consts.get(&id).cloned(),
                }
            }
            Tok::Punct('[') => {
                self.i += 1;
                let mut items = Vec::new();
                let mut all = true;
                while !self.is(']') && self.peek().is_some() {
                    match self.expr() {
                        Some(v) => items.push(v),
                        None => all = false,
                    }
                    if self.is(',') {
                        self.i += 1;
                    } else if !self.is(']') {
                        return None;
                    }
                }
                self.i += 1;
                // A list with an item that is not a literal is not a literal.
                all.then_some(Value::Array(items))
            }
            Tok::Punct('{') => {
                self.i += 1;
                let mut m = Map::new();
                while !self.is('}') && self.peek().is_some() {
                    let key = match self.peek()?.clone() {
                        Tok::Ident(k) | Tok::Str(k) | Tok::Num(k) => k,
                        _ => {
                            self.skip_expr();
                            if self.is(',') {
                                self.i += 1;
                            }
                            continue;
                        }
                    };
                    self.i += 1;
                    if self.is(':') {
                        self.i += 1;
                        if let Some(v) = self.expr() {
                            m.insert(key.clone(), v);
                        }
                    } else if self.is('(') {
                        // A method: skip its parameters and body.
                        self.skip_expr();
                        if self.is('{') {
                            self.skip_expr();
                        }
                    }
                    // Shorthand `{ label }`: the variable's value when it is a literal.
                    if (self.is(',') || self.is('}')) && !m.contains_key(&key) {
                        if let Some(v) = self.consts.get(&key) {
                            m.insert(key.clone(), v.clone());
                        }
                    }
                    if self.is(',') {
                        self.i += 1;
                    } else if !self.is('}') {
                        self.skip_expr();
                        if self.is(',') {
                            self.i += 1;
                        }
                    }
                }
                self.i += 1;
                Some(Value::Object(m))
            }
            _ => None,
        }
    }
}

impl Reader<'_> {
    /// `name(args…)` of a known arrow function, at its `(`: the body's value with the arguments.
    fn call(&mut self, name: &str) -> Option<Value> {
        self.i += 1;
        let mut args = Vec::new();
        while !self.is(')') && self.peek().is_some() {
            let v = self.expr();
            args.push(v.as_ref().and_then(Ev::of));
            if self.is(',') {
                self.i += 1;
            } else if !self.is(')') {
                self.skip_expr();
                return None;
            }
        }
        self.i += 1;
        let (params, body) = self.funcs.get(name)?;
        if params.len() != args.len() {
            return None;
        }
        let mut env = BTreeMap::new();
        for (p, a) in params.iter().zip(args) {
            env.insert(p.clone(), a?);
        }
        for (k, v) in &self.consts {
            if let (false, Some(e)) = (env.contains_key(k), Ev::of(v)) {
                env.insert(k.clone(), e);
            }
        }
        let mut b = Body {
            t: body,
            i: 0,
            env: &env,
        };
        let v = b.sum()?;
        (b.i == body.len()).then(|| Value::String(v.text()))
    }

    /// At `name =`'s value: an arrow function `(a, b) => body` up to its `;`, when it is one.
    fn arrow(&mut self) -> Option<(Vec<String>, Vec<Tok>)> {
        let start = self.i;
        if !self.is('(') {
            return None;
        }
        let mut k = self.i + 1;
        let mut params = Vec::new();
        loop {
            match self.t.get(k) {
                Some(Tok::Ident(p)) => params.push(p.clone()),
                Some(Tok::Punct(')')) => break,
                _ => return None,
            }
            k += 1;
            match self.t.get(k) {
                Some(Tok::Punct(',')) => k += 1,
                Some(Tok::Punct(')')) => break,
                _ => return None,
            }
        }
        if self.t.get(k + 1) != Some(&Tok::Op("=>".into())) {
            return None;
        }
        self.i = k + 2;
        let body_start = self.i;
        self.skip_expr();
        let body = self.t[body_start..self.i].to_vec();
        if body
            .iter()
            .any(|t| matches!(t, Tok::Punct('{' | '[' | '?')) || matches!(t, Tok::Tpl))
        {
            self.i = start;
            self.skip_expr();
            return Some((Vec::new(), Vec::new()));
        }
        Some((params, body))
    }
}

/// A value as text, the way the template prints it.
pub fn scalar(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

/// The literal parts of what `renderVals()` returns, as JSON. An empty
/// object when there is no `renderVals` or its result is not an object literal.
pub fn read_render_vals(script: &str) -> Value {
    read_script(script).1
}

/// The `const` values `renderVals()` defines before it returns (the lists a page computes from,
/// an icon set's paths), and what it returns ([`read_render_vals`]).
pub fn read_script(script: &str) -> (BTreeMap<String, Value>, Value) {
    let empty = || Value::Object(Map::new());
    let Some(at) = script.find("renderVals") else {
        return (BTreeMap::new(), empty());
    };
    let toks = lex(&script[at..]);
    // renderVals ( ) {
    let Some(open) = toks.iter().position(|t| *t == Tok::Punct('{')) else {
        return (BTreeMap::new(), empty());
    };
    let mut r = Reader {
        t: &toks,
        i: open + 1,
        consts: BTreeMap::new(),
        funcs: BTreeMap::new(),
    };
    while let Some(t) = r.peek().cloned() {
        match t {
            Tok::Ident(k) if k == "const" || k == "let" || k == "var" => {
                r.i += 1;
                let name = match r.peek() {
                    Some(Tok::Ident(n)) => n.clone(),
                    _ => {
                        r.skip_expr();
                        continue;
                    }
                };
                r.i += 1;
                if r.is('=') {
                    r.i += 1;
                    if let Some((params, body)) = r.arrow() {
                        if !body.is_empty() {
                            r.funcs.insert(name, (params, body));
                        }
                    } else if let Some(v) = r.expr() {
                        r.consts.insert(name, v);
                    }
                }
                if r.is(';') {
                    r.i += 1;
                }
            }
            Tok::Ident(k) if k == "return" => {
                r.i += 1;
                let v = match r.expr() {
                    Some(v @ Value::Object(_)) => v,
                    _ => empty(),
                };
                return (r.consts, v);
            }
            Tok::Punct('}') => break,
            // `for (…) { … }`, `if (…) { … }`: the header and the block, skipped whole.
            Tok::Ident(k) if matches!(k.as_str(), "for" | "if" | "while") => {
                r.i += 1;
                for (open, close) in [('(', ')'), ('{', '}')] {
                    if !r.is(open) {
                        continue;
                    }
                    let mut depth = 0i32;
                    while let Some(t) = r.peek() {
                        if *t == Tok::Punct(open) {
                            depth += 1;
                        } else if *t == Tok::Punct(close) {
                            depth -= 1;
                            if depth == 0 {
                                r.i += 1;
                                break;
                            }
                        }
                        r.i += 1;
                    }
                }
            }
            _ => {
                r.skip_expr();
                if r.is(';') || r.is(',') || r.is(')') {
                    r.i += 1;
                } else if r.is('}') {
                    // The end of a block statement (`for (…) { … }`).
                    r.i += 1;
                }
            }
        }
    }
    (r.consts, empty())
}

/// The page's data script's text, when it has one.
pub fn page_script(html: &El) -> Option<String> {
    html.find(&|e| e.tag == "script" && e.attr("type") == Some("text/x-dc"))
        .map(El::raw_text)
}

// --- expansion ---------------------------------------------------------------

/// `{{ path }}` → the value's text, or empty when it is unknown.
fn lookup<'a>(path: &str, scopes: &'a [(String, Value)], root: &'a Value) -> Option<&'a Value> {
    let path = path.trim();
    let mut parts = path.split('.');
    let head = parts.next()?;
    let mut v = scopes
        .iter()
        .rev()
        .find(|(k, _)| k == head)
        .map(|(_, v)| v)
        .or_else(|| root.get(head))?;
    for p in parts {
        v = match v {
            Value::Object(m) => m.get(p)?,
            Value::Array(a) => a.get(p.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(v)
}

fn literal(expr: &str) -> Option<Value> {
    match expr.trim() {
        "true" => Some(Value::Bool(true)),
        "false" => Some(Value::Bool(false)),
        _ => None,
    }
}

fn substitute(s: &str, scopes: &[(String, Value)], root: &Value) -> String {
    if !s.contains("{{") {
        return s.to_string();
    }
    let mut out = String::new();
    let mut rest = s;
    while let Some(a) = rest.find("{{") {
        out.push_str(&rest[..a]);
        let after = &rest[a + 2..];
        let Some(b) = after.find("}}") else {
            out.push_str(&rest[a..]);
            return out;
        };
        let expr = &after[..b];
        if let Some(v) = literal(expr).or_else(|| lookup(expr, scopes, root).cloned()) {
            out.push_str(&scalar(&v));
        }
        rest = &after[b + 2..];
    }
    out.push_str(rest);
    out
}

fn binding(attr: Option<&str>) -> Option<&str> {
    let a = attr?.trim();
    a.strip_prefix("{{")?.strip_suffix("}}").map(str::trim)
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty() && s != "false",
        Value::Number(n) => n.as_i64() != Some(0),
        _ => true,
    }
}

/// Is this a short label (an eyebrow or a sub-heading)?
pub fn is_label(e: &El) -> bool {
    let t = e.text();
    !t.is_empty() && t.chars().count() <= 90 && e.descendants().len() <= 4
}

struct Expander<'a> {
    root: &'a Value,
    lists: Vec<DataList>,
}

impl Expander<'_> {
    fn children(
        &mut self,
        nodes: &[Node],
        scopes: &mut Vec<(String, Value)>,
        label: Option<&str>,
    ) -> Vec<Node> {
        let mut out = Vec::new();
        // The first element child, when it is a label, labels its later siblings.
        let first = nodes.iter().find_map(|n| match n {
            Node::El(e) => Some(e),
            Node::Text(_) => None,
        });
        let own_label = first
            .filter(|e| is_label(e) && !e.tag.starts_with("sc-"))
            .map(|e| crate::dom::collapse(&substitute(&e.text(), scopes, self.root)));
        for n in nodes {
            let lbl = own_label.as_deref().or(label);
            match n {
                Node::Text(t) => out.push(Node::Text(substitute(t, scopes, self.root))),
                Node::El(e) => self.element(e, scopes, lbl, &mut out),
            }
        }
        out
    }

    fn element(
        &mut self,
        e: &El,
        scopes: &mut Vec<(String, Value)>,
        label: Option<&str>,
        out: &mut Vec<Node>,
    ) {
        match e.tag.as_str() {
            "sc-for" => {
                let name = e.attr("as").unwrap_or("item").to_string();
                let key = binding(e.attr("list")).unwrap_or_default().to_string();
                let items: Option<Vec<Value>> = match lookup(&key, scopes, self.root) {
                    Some(Value::Array(a)) => Some(a.clone()),
                    _ => None,
                };
                let hint = e
                    .attr("hint-placeholder-count")
                    .and_then(|h| h.trim().parse::<usize>().ok())
                    .unwrap_or(1);
                let items = match items {
                    Some(a) => {
                        self.lists.push(DataList {
                            key: key.clone(),
                            label: label.map(str::to_string),
                            items: a.clone(),
                        });
                        a
                    }
                    None => vec![Value::Null; hint],
                };
                for it in items.into_iter().take(MAX_LOOP) {
                    scopes.push((name.clone(), it));
                    out.extend(self.children(&e.children, scopes, label));
                    scopes.pop();
                }
            }
            "sc-if" => {
                let shown = match binding(e.attr("value")) {
                    Some(b) => literal(b)
                        .or_else(|| lookup(b, scopes, self.root).cloned())
                        .map(|v| truthy(&v))
                        .unwrap_or_else(|| {
                            binding(e.attr("hint-placeholder-val"))
                                .and_then(literal)
                                .is_none_or(|v| truthy(&v))
                        }),
                    None => true,
                };
                if shown {
                    out.extend(self.children(&e.children, scopes, label));
                }
            }
            _ => {
                let tag = match e.tag.strip_prefix("sc-raw-") {
                    Some(t) => t.to_string(),
                    None => e.tag.clone(),
                };
                let attrs = e
                    .attrs
                    .iter()
                    .map(|(k, v)| (k.clone(), substitute(v, scopes, self.root)))
                    .collect();
                let children = if tag == "script" || tag == "style" {
                    e.children.clone()
                } else {
                    self.children(&e.children, scopes, label)
                };
                out.push(Node::El(El {
                    tag,
                    attrs,
                    children,
                }));
            }
        }
    }
}

/// The page's data (its `text/x-dc` script), when it has one.
pub fn page_data(html: &El) -> Option<Value> {
    html.find(&|e| e.tag == "script" && e.attr("type") == Some("text/x-dc"))
        .map(|s| read_render_vals(&s.raw_text()))
}

/// Expands a Claude Design page: loops, conditions and substitutions with the
/// page's literal data. A page without the runtime is returned unchanged.
pub fn expand(html: &El) -> (El, Vec<DataList>) {
    if html.find_tag("x-dc").is_none() {
        return (html.clone(), Vec::new());
    }
    let data = page_data(html).unwrap_or(Value::Object(Map::new()));
    let mut x = Expander {
        root: &data,
        lists: Vec::new(),
    };
    let mut scopes = Vec::new();
    let mut out = Vec::new();
    x.element(html, &mut scopes, None, &mut out);
    let el = out
        .into_iter()
        .find_map(|n| match n {
            Node::El(e) => Some(e),
            Node::Text(_) => None,
        })
        .unwrap_or_default();
    (el, x.lists)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_literals_and_leaves_code_out() {
        let v = read_render_vals(
            r#"class Component extends DCLogic {
  constructor(...a) { super(...a); this.state = { f: 'All' }; }
  renderVals() {
    const D = "font-family:'Bodoni'";
    const f = this.state.f;
    let left = 0; for (let i = 0; i < 3; i++) left += 2;
    return {
      a: [{ n: 'x', s: D + ';size:1' }, { n: "y", s: 'z' }],
      calls: [row(1), row(2)],
      pick: () => this.setState({ f: 'x' }),
      count: 7, ok: true, frac: 0.5,
      mapped: ['a'].map((l) => ({ l })),
    };
  }
}"#,
        );
        assert_eq!(
            v,
            json!({
                "a": [{"n": "x", "s": "font-family:'Bodoni';size:1"}, {"n": "y", "s": "z"}],
                "count": 7, "ok": true, "frac": "0.5"
            })
        );
    }

    #[test]
    fn arrow_functions_of_plain_arithmetic_are_evaluated() {
        let (consts, v) = read_script(
            r#"class C { renderVals() {
const c = (x, y, r) => 'M' + (x - r) + ' ' + y + 'a' + r + ' 0 ' + (2 * r) + ' ' + (-2 * r);
const curve = (a, b) => 'C' + (a * 100) + ',' + (100 - b * 100);
const bad = (x) => x.map(1);
const ui = [['search', [c(11, 11, 6.5), 'M20 20l-4.2-4.2']], ['x', [bad(1)]]];
return { d: curve(0.22, 1), e: c(12, 12, 9) };
} }"#,
        );
        assert_eq!(v["d"], json!("C22,0"));
        assert_eq!(v["e"], json!("M3 12a9 0 18 -18"));
        // A list with an item that cannot be read is not a literal.
        assert!(!consts.contains_key("ui"));
        let (consts, _) = read_script(
            "class C { renderVals() { const c = (x, r) => 'M' + (x - r); const ui = [['s', [c(11, 6.5)]]]; return {}; } }",
        );
        assert_eq!(consts["ui"], json!([["s", ["M4.5"]]]));
        assert_eq!(ev_text(ev_num("-13").unwrap()), "-13");
        assert_eq!(ev_text(ev_num("0.25").unwrap() * 2), "0.5");
    }

    #[test]
    fn a_conditional_reads_as_its_first_branch() {
        let v = read_render_vals(
            r#"class C { renderVals() {
  const all = [{ n: 'a' }, { n: 'b' }];
  const f = this.state.f;
  const acts = f === 'All' ? all : all.filter((x) => x.k === f);
  return { acts, shown: f ? 'yes' : 'no', safe: x?.y, both: a ?? 'z' };
} }"#,
        );
        assert_eq!(v["shown"], json!("yes"));
        // A shorthand property is its variable's value (the conditional's first branch); the
        // optional chain and `??` are not conditionals.
        assert_eq!(v["acts"], json!([{"n": "a"}, {"n": "b"}]));
        assert!(v.get("safe").is_none());
        let v = read_render_vals(
            "class C { renderVals() { const all = [{n:'a'}]; const acts = f === 'All' ? all : []; return { acts: acts }; } }",
        );
        assert_eq!(v["acts"], json!([{"n": "a"}]));
    }

    #[test]
    fn expands_loops_with_data_and_with_placeholders() {
        let page = crate::dom::parse(
            r#"<body><x-dc><div><div class="lbl">Core</div>
<div><sc-for list="{{core}}" as="s" hint-placeholder-count="9"><i style="background:{{s.hex}}">{{s.name}}</i></sc-for></div>
<sc-for list="{{unknown}}" as="u" hint-placeholder-count="2"><b>{{u.x}}</b></sc-for>
<sc-if value="{{ false }}"><em>no</em></sc-if></div></x-dc>
<script type="text/x-dc">class C { renderVals() { return { core: [{name:'Ink',hex:'#000'},{name:'Paper',hex:'#fff'}] }; } }</script></body>"#,
        );
        let (el, lists) = expand(&page);
        let b = crate::dom::body(&el).unwrap();
        assert_eq!(b.count(&|e| e.tag == "i"), 2);
        assert_eq!(b.count(&|e| e.tag == "b"), 2);
        assert_eq!(b.count(&|e| e.tag == "em"), 0);
        assert!(b.outer_html().contains("background:#fff\">Paper"));
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].label.as_deref(), Some("Core"));
    }
}
