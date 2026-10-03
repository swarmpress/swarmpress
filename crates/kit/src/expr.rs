//! Integer expressions of the brick script.
//!
//! The grammar is closed: integer literals, `$param`, `+`, `-`, `*`, unary
//! minus and parentheses. No division, comparisons or calls, so every
//! expression terminates and is exact (checked `i64`, overflow is an error).
//!
//! ```text
//! expr   := term (("+" | "-") term)*
//! term   := factor ("*" factor)*
//! factor := INT | "$" ident | "(" expr ")" | "-" factor
//! ident  := [a-z_][a-z0-9_]*
//! ```
//!
//! Expressions have a canonical text ([`Expr::canonical`]): operators spaced,
//! parentheses only where the tree needs them, a minus folded into a literal.
//! An expression without parameters is folded to its value, so `"-3"`, `-3`
//! and `"1 - 4"` have the same canonical form and the same design hash.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

/// Longest expression text accepted.
pub const MAX_EXPR_LEN: usize = 256;
/// Deepest nesting of parentheses and unary minus.
const MAX_DEPTH: usize = 32;

/// An integer in the brick script: a JSON integer or an expression string.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Num {
    Int(i64),
    Expr(String),
}

impl Num {
    pub fn is_zero(&self) -> bool {
        matches!(self, Num::Int(0))
    }

    pub fn zero() -> Num {
        Num::Int(0)
    }

    /// Parse (a literal parses to itself).
    pub fn parse(&self) -> Result<Expr, ExprError> {
        match self {
            Num::Int(n) => Ok(Expr::Lit(*n)),
            Num::Expr(s) => Expr::parse(s),
        }
    }

    /// The canonical form: a literal for constant expressions, else the
    /// canonical expression text.
    pub fn canonical(&self) -> Result<Num, ExprError> {
        match self {
            Num::Int(n) => Ok(Num::Int(*n)),
            Num::Expr(s) => Ok(Expr::parse(s)?.canonical_num()),
        }
    }

    pub fn eval(&self, env: &Env) -> Result<i64, ExprError> {
        match self {
            Num::Int(n) => Ok(*n),
            Num::Expr(s) => Expr::parse(s)?.eval(env),
        }
    }
}

impl From<i64> for Num {
    fn from(n: i64) -> Num {
        Num::Int(n)
    }
}

impl From<&str> for Num {
    fn from(s: &str) -> Num {
        Num::Expr(s.to_string())
    }
}

/// The parameters an expression may read: integer parameters by name, and
/// the names of non-integer parameters (so the error can say so).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Env {
    pub ints: BTreeMap<String, i64>,
    pub others: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
}

impl BinOp {
    const fn prec(self) -> u8 {
        match self {
            BinOp::Add | BinOp::Sub => 1,
            BinOp::Mul => 2,
        }
    }

    const fn symbol(self) -> &'static str {
        match self {
            BinOp::Add => " + ",
            BinOp::Sub => " - ",
            BinOp::Mul => " * ",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Expr {
    Lit(i64),
    Param(String),
    Neg(Box<Expr>),
    Bin(BinOp, Box<Expr>, Box<Expr>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExprError {
    Syntax(String),
    UnknownParam(String),
    NotInteger(String),
    Overflow,
}

impl std::fmt::Display for ExprError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExprError::Syntax(m) => write!(f, "syntax: {m}"),
            ExprError::UnknownParam(p) => write!(f, "unknown parameter ${p}"),
            ExprError::NotInteger(p) => write!(f, "${p} is not an integer parameter"),
            ExprError::Overflow => write!(f, "integer overflow"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Tok {
    Int(i64),
    Param(String),
    Plus,
    Minus,
    Star,
    Open,
    Close,
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_lowercase() || c == '_'
}

fn is_ident(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'
}

fn tokens(s: &str) -> Result<Vec<Tok>, ExprError> {
    if s.len() > MAX_EXPR_LEN {
        return Err(ExprError::Syntax(format!(
            "longer than {MAX_EXPR_LEN} characters"
        )));
    }
    let chars: Vec<char> = s.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match c {
            ' ' | '\t' => i += 1,
            '+' => {
                out.push(Tok::Plus);
                i += 1;
            }
            '-' => {
                out.push(Tok::Minus);
                i += 1;
            }
            '*' => {
                out.push(Tok::Star);
                i += 1;
            }
            '(' => {
                out.push(Tok::Open);
                i += 1;
            }
            ')' => {
                out.push(Tok::Close);
                i += 1;
            }
            '0'..='9' => {
                let mut n: i64 = 0;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    let d = i64::from(chars[i] as u8 - b'0');
                    n = n
                        .checked_mul(10)
                        .and_then(|n| n.checked_add(d))
                        .ok_or(ExprError::Overflow)?;
                    i += 1;
                }
                out.push(Tok::Int(n));
            }
            '$' => {
                i += 1;
                if i >= chars.len() || !is_ident_start(chars[i]) {
                    return Err(ExprError::Syntax("`$` must start a parameter name".into()));
                }
                let start = i;
                while i < chars.len() && is_ident(chars[i]) {
                    i += 1;
                }
                out.push(Tok::Param(chars[start..i].iter().collect()));
            }
            other => {
                return Err(ExprError::Syntax(format!("unexpected `{other}`")));
            }
        }
    }
    Ok(out)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    depth: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    fn expr(&mut self) -> Result<Expr, ExprError> {
        let mut left = self.term()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Plus) => BinOp::Add,
                Some(Tok::Minus) => BinOp::Sub,
                _ => return Ok(left),
            };
            self.pos += 1;
            let right = self.term()?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
    }

    fn term(&mut self) -> Result<Expr, ExprError> {
        let mut left = self.factor()?;
        while self.peek() == Some(&Tok::Star) {
            self.pos += 1;
            let right = self.factor()?;
            left = Expr::Bin(BinOp::Mul, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn factor(&mut self) -> Result<Expr, ExprError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(ExprError::Syntax("nested too deeply".into()));
        }
        let out = match self.next() {
            Some(Tok::Int(n)) => Ok(Expr::Lit(n)),
            Some(Tok::Param(p)) => Ok(Expr::Param(p)),
            Some(Tok::Open) => {
                let e = self.expr()?;
                match self.next() {
                    Some(Tok::Close) => Ok(e),
                    _ => Err(ExprError::Syntax("missing `)`".into())),
                }
            }
            Some(Tok::Minus) => match self.factor()? {
                // A minus on a literal is part of the literal.
                Expr::Lit(n) => n.checked_neg().map(Expr::Lit).ok_or(ExprError::Overflow),
                e => Ok(Expr::Neg(Box::new(e))),
            },
            Some(t) => Err(ExprError::Syntax(format!("unexpected {t:?}"))),
            None => Err(ExprError::Syntax("unexpected end".into())),
        };
        self.depth -= 1;
        out
    }
}

impl Expr {
    pub fn parse(s: &str) -> Result<Expr, ExprError> {
        let toks = tokens(s)?;
        if toks.is_empty() {
            return Err(ExprError::Syntax("empty expression".into()));
        }
        let mut p = Parser {
            toks,
            pos: 0,
            depth: 0,
        };
        let e = p.expr()?;
        if p.pos != p.toks.len() {
            return Err(ExprError::Syntax(format!("unexpected {:?}", p.toks[p.pos])));
        }
        Ok(e)
    }

    /// Whether the expression reads any parameter.
    pub fn has_params(&self) -> bool {
        match self {
            Expr::Lit(_) => false,
            Expr::Param(_) => true,
            Expr::Neg(e) => e.has_params(),
            Expr::Bin(_, a, b) => a.has_params() || b.has_params(),
        }
    }

    /// Parameters read, in order of appearance.
    pub fn params(&self, out: &mut Vec<String>) {
        match self {
            Expr::Lit(_) => {}
            Expr::Param(p) => out.push(p.clone()),
            Expr::Neg(e) => e.params(out),
            Expr::Bin(_, a, b) => {
                a.params(out);
                b.params(out);
            }
        }
    }

    pub fn eval(&self, env: &Env) -> Result<i64, ExprError> {
        match self {
            Expr::Lit(n) => Ok(*n),
            Expr::Param(p) => match env.ints.get(p) {
                Some(v) => Ok(*v),
                None if env.others.contains_key(p) => Err(ExprError::NotInteger(p.clone())),
                None => Err(ExprError::UnknownParam(p.clone())),
            },
            Expr::Neg(e) => e.eval(env)?.checked_neg().ok_or(ExprError::Overflow),
            Expr::Bin(op, a, b) => {
                let (a, b) = (a.eval(env)?, b.eval(env)?);
                match op {
                    BinOp::Add => a.checked_add(b),
                    BinOp::Sub => a.checked_sub(b),
                    BinOp::Mul => a.checked_mul(b),
                }
                .ok_or(ExprError::Overflow)
            }
        }
    }

    /// The canonical text (see the module docs).
    pub fn canonical(&self) -> String {
        let mut s = String::new();
        self.print(&mut s, 0);
        s
    }

    /// The canonical [`Num`]: constant expressions fold to their value.
    pub fn canonical_num(&self) -> Num {
        if !self.has_params() {
            if let Ok(v) = self.eval(&Env::default()) {
                return Num::Int(v);
            }
        }
        match self {
            Expr::Lit(n) => Num::Int(*n),
            e => Num::Expr(e.canonical()),
        }
    }

    fn print(&self, out: &mut String, min_prec: u8) {
        match self {
            Expr::Lit(n) => {
                let _ = write!(out, "{n}");
            }
            Expr::Param(p) => {
                out.push('$');
                out.push_str(p);
            }
            Expr::Neg(e) => {
                out.push('-');
                e.print(out, 3);
            }
            Expr::Bin(op, a, b) => {
                let prec = op.prec();
                let paren = prec < min_prec;
                if paren {
                    out.push('(');
                }
                a.print(out, prec);
                out.push_str(op.symbol());
                // Operators are left-associative: a right operand of the same
                // precedence keeps its parentheses so the tree round-trips.
                b.print(out, prec + 1);
                if paren {
                    out.push(')');
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, i64)]) -> Env {
        Env {
            ints: pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            others: BTreeMap::new(),
        }
    }

    #[test]
    fn evaluates_with_precedence() {
        let e = env(&[("w", 24), ("h", 3)]);
        assert_eq!(Expr::parse("$w - 3").unwrap().eval(&e), Ok(21));
        assert_eq!(Expr::parse("2 * $w - 3 * $h").unwrap().eval(&e), Ok(39));
        assert_eq!(Expr::parse("2 * ($w - 3)").unwrap().eval(&e), Ok(42));
        assert_eq!(Expr::parse("-$h - -2").unwrap().eval(&e), Ok(-1));
        assert_eq!(Expr::parse("$w-$w-$w").unwrap().eval(&e), Ok(-24));
    }

    #[test]
    fn refuses_bad_text() {
        for bad in [
            "", "3 +", "$", "$W", "4 / 2", "(1", "1)", "1.5", "$w $h", "abc",
        ] {
            assert!(Expr::parse(bad).is_err(), "{bad:?} should not parse");
        }
        assert_eq!(
            Expr::parse("9223372036854775807 + 1")
                .unwrap()
                .eval(&Env::default()),
            Err(ExprError::Overflow)
        );
        assert_eq!(
            Expr::parse("$x").unwrap().eval(&Env::default()),
            Err(ExprError::UnknownParam("x".into()))
        );
    }

    #[test]
    fn canonical_text_round_trips() {
        for s in [
            "$w-3",
            "(($w))",
            "$a - ($b - $c)",
            "$a - $b - $c",
            "$a * ($b + 2)",
            "-($a + 1) * 3",
            "--$a",
            "2 - -3 * $a",
        ] {
            let e = Expr::parse(s).unwrap();
            let c = e.canonical();
            assert_eq!(Expr::parse(&c).unwrap(), e, "{s:?} → {c:?}");
        }
        assert_eq!(Expr::parse("$w-3").unwrap().canonical(), "$w - 3");
        assert_eq!(Num::from("1 - 4").canonical(), Ok(Num::Int(-3)));
        assert_eq!(Num::from("-3").canonical(), Ok(Num::Int(-3)));
        assert_eq!(Num::from(" 7 ").canonical(), Ok(Num::Int(7)));
    }
}
