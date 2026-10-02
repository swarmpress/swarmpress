//! "Never invent numbers" (organization.md §6, §6a): every number in a CFO or
//! data-scientist output, whether a JSON number or a figure inside text, must
//! appear in the input data. Dropping decimals is allowed (`92,900` for
//! `92900.09`, `€92.9k` likewise); anything else that is not in the input is
//! an error fed back to the model.
//!
//! Identifiers and codes are not figures: digits glued to letters (`W41`,
//! `GA4`, `C1`), hyphenated ids (`project-1`, `ticket-3`) and path segments
//! are skipped.
//!
//! This is an output validator outside the deterministic sim, so comparing
//! figures with `f64` tolerance is fine here (rule 1 binds `sim-core` only).
#![allow(clippy::float_arithmetic)]

use serde_json::Value;

/// A number found in output or input.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundNumber {
    /// As written, e.g. `"€41,200"` → `"41,200"`.
    pub raw: String,
    /// Absolute value after applying a `k`/`m` multiplier.
    pub value: f64,
    /// Decimal places as written, minus the multiplier's exponent (so
    /// `92.9k` has -2: it is precise to the hundred).
    pub precision: i32,
}

/// Extracts figures from free text.
pub fn numbers_in_text(s: &str) -> Vec<FoundNumber> {
    let c: Vec<char> = s.chars().collect();
    let n = c.len();
    let digit = |i: usize| i < n && c[i].is_ascii_digit();
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        if !c[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        let mut j = i;
        while digit(j) {
            j += 1;
        }
        // thousands groups: ",ddd" not followed by another digit
        while j < n && c[j] == ',' && digit(j + 1) && digit(j + 2) && digit(j + 3) && !digit(j + 4)
        {
            j += 4;
        }
        let mut decimals = 0i32;
        if j < n && c[j] == '.' && digit(j + 1) {
            let mut k = j + 1;
            while digit(k) {
                k += 1;
            }
            decimals = (k - j - 1) as i32;
            j = k;
        }
        let prev = if start > 0 { c[start - 1] } else { ' ' };
        let prev2 = if start > 1 { c[start - 2] } else { ' ' };
        let raw: String = c[start..j].iter().collect();
        let mut skip = prev.is_alphabetic()
            || prev == '/'
            || prev == '#'
            || prev == '_'
            || (prev == '-' && prev2.is_alphanumeric())
            || (prev == '.' && prev2.is_ascii_digit());
        let mut mult_exp = 0i32;
        let mut end = j;
        if j < n && c[j].is_alphabetic() {
            let after = if j + 1 < n { c[j + 1] } else { ' ' };
            match c[j] {
                'k' | 'K' if !after.is_alphabetic() => {
                    mult_exp = 3;
                    end = j + 1;
                }
                'm' | 'M' if !after.is_alphabetic() => {
                    mult_exp = 6;
                    end = j + 1;
                }
                _ => skip = true, // ordinals, units glued to digits, codes
            }
        }
        if !skip {
            if let Ok(v) = raw.replace(',', "").parse::<f64>() {
                out.push(FoundNumber {
                    raw: c[start..end].iter().collect(),
                    value: v.abs() * 10f64.powi(mult_exp),
                    precision: decimals - mult_exp,
                });
            }
        }
        i = end.max(j);
    }
    out
}

/// Numbers in a JSON value: JSON numbers and figures in strings, skipping
/// the subtrees under `skip_keys`. Paths are JSON-pointer-like.
pub fn numbers_in_json(v: &Value, skip_keys: &[&str]) -> Vec<(String, FoundNumber)> {
    fn walk(v: &Value, path: &str, skip: &[&str], out: &mut Vec<(String, FoundNumber)>) {
        match v {
            Value::Number(num) => {
                if let Some(f) = num.as_f64() {
                    let raw = num.to_string();
                    let precision = raw.split_once('.').map_or(0, |(_, d)| d.len() as i32);
                    out.push((
                        path.to_owned(),
                        FoundNumber {
                            raw,
                            value: f.abs(),
                            precision,
                        },
                    ));
                }
            }
            Value::String(s) => {
                for n in numbers_in_text(s) {
                    out.push((path.to_owned(), n));
                }
            }
            Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    walk(x, &format!("{path}/{i}"), skip, out);
                }
            }
            Value::Object(m) => {
                for (k, x) in m {
                    if !skip.contains(&k.as_str()) {
                        walk(x, &format!("{path}/{k}"), skip, out);
                    }
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(v, "", skip_keys, &mut out);
    out
}

/// Dropping decimals may round or truncate (`74.5` → `74` or `75`);
/// abbreviating whole digits (`k`, `M`) must not change any digit that is
/// shown (`92.9k` for `92,900.09` is fine, `93k` is not).
fn matches(found: &FoundNumber, x: f64) -> bool {
    let scale = 10f64.powi(found.precision);
    let close = |a: f64| (a - found.value).abs() <= 1e-9 * found.value.max(1.0);
    let rounded = (x.abs() * scale).round() / scale;
    let truncated = (x.abs() * scale).trunc() / scale;
    if found.precision >= 0 {
        close(rounded) || close(truncated)
    } else {
        close(rounded) && close(truncated)
    }
}

/// Every number in `output` (except under `skip_keys`) must appear in
/// `input` (as a JSON number or a figure in its text), allowing dropped
/// decimals. Returns one error per invented figure.
pub fn check_number_provenance(
    output: &Value,
    input: &Value,
    skip_keys: &[&str],
) -> Result<(), Vec<String>> {
    let known: Vec<f64> = numbers_in_json(input, &[])
        .into_iter()
        .map(|(_, n)| n.value)
        .collect();
    let errors: Vec<String> = numbers_in_json(output, skip_keys)
        .into_iter()
        .filter(|(_, n)| !known.iter().any(|&x| matches(n, x)))
        .map(|(path, n)| {
            format!(
                "{}: the figure {:?} does not appear in the input data; use only numbers you were given, copied exactly",
                if path.is_empty() { "(root)" } else { &path },
                n.raw
            )
        })
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn vals(s: &str) -> Vec<f64> {
        numbers_in_text(s).into_iter().map(|n| n.value).collect()
    }

    #[test]
    fn extracts_figures_and_skips_ids() {
        assert_eq!(
            vals("Cash is €92,900.09 and runway 61 days"),
            [92900.09, 61.0]
        );
        assert_eq!(vals("62% engaged, +14 days"), [62.0, 14.0]);
        assert_eq!(
            vals("W41, GA4, en (C1), project-1, ticket-3, /en/blog/x-2"),
            Vec::<f64>::new()
        );
        assert_eq!(vals("€41.2k spent; 1.5M views"), [41200.0, 1_500_000.0]);
        assert_eq!(vals("the 3rd week, a 3D view"), Vec::<f64>::new());
        assert_eq!(vals("1,240 views"), [1240.0]);
    }

    #[test]
    fn dropped_decimals_are_allowed_but_not_rounding_up() {
        let input = json!({"cashEur": 92900.09, "spent": 41200});
        assert!(check_number_provenance(&json!({"t": "Cash €92,900"}), &input, &[]).is_ok());
        assert!(check_number_provenance(&json!({"t": "Cash €92.9k"}), &input, &[]).is_ok());
        assert!(check_number_provenance(&json!({"t": "Cash €93k"}), &input, &[]).is_err());
        let err =
            check_number_provenance(&json!({"t": "We spent €41,200 of €60,000"}), &input, &[])
                .unwrap_err();
        assert_eq!(err.len(), 1);
        assert!(err[0].contains("60,000"));
        // skipped subtrees
        assert!(check_number_provenance(&json!({"score": 9}), &input, &["score"]).is_ok());
    }
}
