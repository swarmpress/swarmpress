//! MySQL as WordPress sends it, translated to SQLite.
//!
//! Text-level first (what sqlparser does not model the way SQLite needs),
//! then the parsed statement is rewritten and printed:
//!
//! - `SQL_CALC_FOUND_ROWS` is removed and flagged; `SELECT FOUND_ROWS()` is
//!   answered by the projection from the flagged query's count;
//! - `DESCRIBE t`, `SHOW TABLES`, `SHOW COLUMNS`, `SHOW INDEX`, `SHOW FULL
//!   COLUMNS`, `SHOW VARIABLES` are introspection, answered from the schema;
//! - `SET …` and transaction control are session statements;
//! - `INSERT IGNORE` becomes `INSERT OR IGNORE`;
//! - `ON DUPLICATE KEY UPDATE` becomes `ON CONFLICT (<the table's unique
//!   key>) DO UPDATE`, with `VALUES(col)` as `excluded.col`;
//! - MySQL functions WordPress uses become SQLite expressions.

use std::collections::BTreeMap;

use sqlparser::ast::{
    visit_expressions_mut, Assignment, AssignmentTarget, ConflictTarget, DoUpdate, Expr,
    FunctionArg, FunctionArgExpr, FunctionArguments, Ident, ObjectName, OnConflict,
    OnConflictAction, OnInsert, SqliteOnConflict, Statement, TableObject,
};
use sqlparser::dialect::MySqlDialect;
use sqlparser::parser::Parser;
use std::ops::ControlFlow;

/// What the translator needs to know about the tables: each table's unique keys (for upserts).
#[derive(Debug, Clone, Default)]
pub struct Schema {
    pub unique: BTreeMap<String, Vec<Vec<String>>>,
    /// Each table's columns (for `ALTER TABLE`), kept by the projection.
    pub columns: BTreeMap<String, Vec<String>>,
    /// The governed layer's definition of each core table (its CREATE TABLE and indexes), used
    /// when WordPress's installer creates one.
    pub core_ddl: BTreeMap<String, Vec<String>>,
}

impl Schema {
    /// Each table's statements in SQLite DDL: its CREATE TABLE, then the indexes on it.
    pub fn ddl_by_table(ddl: &str) -> BTreeMap<String, Vec<String>> {
        let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for stmt in ddl.split(';').map(str::trim).filter(|s| !s.is_empty()) {
            let lower = stmt.to_ascii_lowercase();
            let table = if lower.starts_with("create table") {
                stmt.find('(')
                    .map(|open| unquote(stmt["create table".len()..open].trim()))
            } else if lower.contains(" index ") {
                lower.find(" on ").and_then(|on| {
                    stmt.find('(')
                        .map(|open| unquote(stmt[on + 4..open].trim()))
                })
            } else {
                None
            };
            if let Some(t) = table {
                out.entry(t).or_default().push(stmt.to_string());
            }
        }
        out
    }

    /// The unique keys of `CREATE [UNIQUE] INDEX` statements and `PRIMARY KEY` columns in SQLite DDL.
    pub fn from_sqlite_ddl(ddl: &str) -> Schema {
        let mut s = Schema::default();
        for stmt in ddl.split(';') {
            let t = stmt.trim();
            let lower = t.to_ascii_lowercase();
            if lower.starts_with("create unique index") {
                // CREATE UNIQUE INDEX `name` ON `table` (`a`, `b`)
                if let (Some(on), Some(open), Some(close)) =
                    (lower.find(" on "), t.find('('), t.rfind(')'))
                {
                    let table = unquote(t[on + 4..open].trim());
                    let cols = t[open + 1..close]
                        .split(',')
                        .map(|c| unquote(c.split_whitespace().next().unwrap_or("")))
                        .collect();
                    s.unique.entry(table).or_default().push(cols);
                }
            } else if lower.starts_with("create table") {
                if let Some(open) = t.find('(') {
                    let table = unquote(t["create table".len()..open].trim());
                    for line in t[open + 1..].lines() {
                        let l = line.trim();
                        if l.to_ascii_lowercase().contains("primary key")
                            && !l.to_ascii_lowercase().starts_with("primary key")
                        {
                            let col = unquote(l.split_whitespace().next().unwrap_or(""));
                            s.unique
                                .entry(table.clone())
                                .or_default()
                                .insert(0, vec![col]);
                        }
                    }
                }
            }
        }
        s
    }
}

fn unquote(s: &str) -> String {
    s.trim_matches(|c| c == '`' || c == '"' || c == '[' || c == ']')
        .to_string()
}

/// What a statement became.
#[derive(Debug, Clone, PartialEq)]
pub enum Translated {
    /// SQLite to run. `write` names the table a write goes to; `calc_found_rows` asks the projection to count for `FOUND_ROWS()`.
    Sql {
        sql: String,
        write: Option<String>,
        calc_found_rows: bool,
    },
    /// A multi-table `DELETE a, b FROM …`: the row sets are selected first (`select`, one rowid column per
    /// target), then each target loses its rows; `tables` are the targets' tables in that order.
    MultiDelete {
        select: String,
        tables: Vec<String>,
    },
    /// `SELECT FOUND_ROWS()`.
    FoundRows,
    /// Schema introspection, answered from the projection.
    Describe(String),
    ShowTables(Option<String>),
    ShowIndex(String),
    ShowVariables,
    /// `SET …`, `START TRANSACTION`, `COMMIT`, `ROLLBACK`: no effect on the projection's content.
    Session,
    /// DDL for a plugin's table in the scratch store (`crate::ddl`).
    Ddl(crate::ddl::Ddl),
}

#[derive(Debug, Clone, PartialEq)]
pub enum TranslateError {
    Parse(String),
    Unsupported(String),
}

impl std::fmt::Display for TranslateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TranslateError::Parse(m) => write!(f, "parse: {m}"),
            TranslateError::Unsupported(m) => write!(f, "unsupported: {m}"),
        }
    }
}

/// The first word, upper-cased.
fn verb(sql: &str) -> String {
    sql.trim_start()
        .split(|c: char| c.is_whitespace() || c == '(')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase()
}

/// Translates one statement (module docs).
pub fn translate(mysql: &str, schema: &Schema) -> Result<Translated, TranslateError> {
    let trimmed = mysql.trim().trim_end_matches(';').trim();
    let upper = trimmed.to_ascii_uppercase();
    let v = verb(trimmed);
    // Introspection and session statements.
    if v == "DESCRIBE" || v == "DESC" {
        let table = unquote(trimmed.split_whitespace().nth(1).unwrap_or(""));
        return Ok(Translated::Describe(table));
    }
    if v == "SHOW" {
        let words: Vec<&str> = trimmed.split_whitespace().collect();
        let w = |i: usize| {
            words
                .get(i)
                .map(|x| x.to_ascii_uppercase())
                .unwrap_or_default()
        };
        if w(1) == "TABLES" {
            let like = upper
                .find(" LIKE ")
                .map(|i| trimmed[i + 6..].trim().trim_matches('\'').to_string());
            return Ok(Translated::ShowTables(like));
        }
        if w(1) == "COLUMNS" || (w(1) == "FULL" && w(2) == "COLUMNS") {
            let from = words
                .iter()
                .position(|x| x.eq_ignore_ascii_case("FROM"))
                .and_then(|i| words.get(i + 1))
                .map(|x| unquote(x))
                .unwrap_or_default();
            return Ok(Translated::Describe(from));
        }
        if w(1) == "INDEX" || w(1) == "KEYS" || w(1) == "INDEXES" {
            let from = words
                .iter()
                .position(|x| x.eq_ignore_ascii_case("FROM"))
                .and_then(|i| words.get(i + 1))
                .map(|x| unquote(x))
                .unwrap_or_default();
            return Ok(Translated::ShowIndex(from));
        }
        if w(1) == "VARIABLES" || w(1) == "SESSION" || w(1) == "GLOBAL" {
            return Ok(Translated::ShowVariables);
        }
        if w(1) == "CREATE" && w(2) == "TABLE" {
            return Ok(Translated::Describe(unquote(
                words.get(3).copied().unwrap_or(""),
            )));
        }
        return Err(TranslateError::Unsupported(format!("SHOW {}", w(1))));
    }
    if v == "SET" || v == "START" || v == "BEGIN" || v == "COMMIT" || v == "ROLLBACK" {
        return Ok(Translated::Session);
    }
    if upper.replace(' ', "").starts_with("SELECTFOUND_ROWS()") {
        return Ok(Translated::FoundRows);
    }
    if v == "CREATE" || v == "ALTER" || v == "DROP" || v == "TRUNCATE" || v == "RENAME" {
        return ddl(trimmed, &upper, schema);
    }
    // Text-level: SQL_CALC_FOUND_ROWS.
    let calc_found_rows = upper.contains("SQL_CALC_FOUND_ROWS");
    let text = if calc_found_rows {
        remove_word(trimmed, "SQL_CALC_FOUND_ROWS")
    } else {
        trimmed.to_string()
    };
    let mut stmts = Parser::parse_sql(&MySqlDialect {}, &text)
        .map_err(|e| TranslateError::Parse(e.to_string()))?;
    if stmts.len() != 1 {
        return Err(TranslateError::Unsupported(format!(
            "{} statements in one query",
            stmts.len()
        )));
    }
    let mut stmt = stmts.remove(0);
    rewrite_functions(&mut stmt);
    if let Some(t) = multi_delete(&stmt) {
        return Ok(t);
    }
    let write = rewrite(&mut stmt, schema)?;
    Ok(Translated::Sql {
        sql: strip_mysql_only(&stmt.to_string()),
        write,
        calc_found_rows,
    })
}

/// Clauses SQLite has no use for, as sqlparser prints them: row locks (a projection has one
/// writer) and MySQL's `FROM DUAL`.
fn strip_mysql_only(sql: &str) -> String {
    let mut out = sql.to_string();
    for clause in [
        " FOR UPDATE SKIP LOCKED",
        " FOR UPDATE NOWAIT",
        " FOR UPDATE",
        " FOR SHARE",
        " LOCK IN SHARE MODE",
        " FROM DUAL",
    ] {
        out = out.replace(clause, "");
    }
    out
}

fn parse_expr(sql: &str) -> Option<Expr> {
    Parser::new(&sqlparser::dialect::SQLiteDialect {})
        .try_with_sql(sql)
        .and_then(|mut p| p.parse_expr())
        .ok()
}

/// DDL: plugin tables go to the scratch store (`crate::ddl`); core tables accept only DDL that
/// changes nothing SQLite keeps.
fn ddl(sql: &str, upper: &str, schema: &Schema) -> Result<Translated, TranslateError> {
    use crate::ddl::{alter_table, create_index, create_table, is_core, Ddl};
    let words: Vec<&str> = sql.split_whitespace().collect();
    let word = |i: usize| {
        words
            .get(i)
            .map(|w| w.to_ascii_uppercase())
            .unwrap_or_default()
    };
    let unsupported = |m: String| TranslateError::Unsupported(m);
    let d = if upper.starts_with("CREATE TABLE") || upper.starts_with("CREATE TEMPORARY TABLE") {
        let d = create_table(sql).map_err(unsupported)?;
        if schema.columns.contains_key(&d.table) {
            // Exists already: CREATE TABLE IF NOT EXISTS semantics (dbDelta checks first anyway).
            return Ok(Translated::Session);
        }
        if is_core(&d.table) {
            // The installer creating a core table gets the governed layer's definition of it.
            let stmts = schema.core_ddl.get(&d.table).cloned().ok_or_else(|| {
                unsupported(format!(
                    "no governed definition of the core table {}",
                    d.table
                ))
            })?;
            let unique = Schema::from_sqlite_ddl(&stmts.join(";\n"))
                .unique
                .remove(&d.table)
                .unwrap_or_default();
            return Ok(Translated::Ddl(Ddl {
                table: d.table,
                stmts,
                unique,
            }));
        }
        d
    } else if upper.starts_with("CREATE INDEX") || upper.starts_with("CREATE UNIQUE INDEX") {
        // An index changes no content: allowed on core tables too.
        create_index(sql).map_err(unsupported)?
    } else if word(0) == "ALTER" && word(1) == "TABLE" {
        let table = unquote(words.get(2).copied().unwrap_or(""));
        let existing = schema.columns.get(&table).cloned().unwrap_or_default();
        let d = alter_table(sql, &existing).map_err(unsupported)?;
        if is_core(&d.table)
            && d.stmts.iter().any(|s| {
                !s.starts_with("CREATE INDEX")
                    && !s.starts_with("CREATE UNIQUE INDEX")
                    && !s.starts_with("DROP INDEX")
            })
        {
            return Err(unsupported(format!(
                "ALTER TABLE on the core table {}",
                d.table
            )));
        }
        d
    } else if word(0) == "DROP" && word(1) == "TABLE" {
        let table = unquote(words.last().copied().unwrap_or("").trim_end_matches(';'));
        if is_core(&table) {
            return Err(unsupported(format!("DROP TABLE on the core table {table}")));
        }
        Ddl {
            stmts: vec![format!("DROP TABLE IF EXISTS `{table}`")],
            table,
            unique: vec![],
        }
    } else if word(0) == "DROP" && word(1) == "INDEX" {
        let table = unquote(words.last().copied().unwrap_or(""));
        let name = unquote(words.get(2).copied().unwrap_or(""));
        if is_core(&table) {
            return Ok(Translated::Session);
        }
        Ddl {
            stmts: vec![format!("DROP INDEX IF EXISTS `{table}__{name}`")],
            table,
            unique: vec![],
        }
    } else if word(0) == "TRUNCATE" {
        let table = unquote(words.last().copied().unwrap_or(""));
        if is_core(&table) {
            return Err(unsupported(format!("TRUNCATE on the core table {table}")));
        }
        Ddl {
            stmts: vec![format!("DELETE FROM `{table}`")],
            table,
            unique: vec![],
        }
    } else {
        return Err(unsupported(format!("DDL {}", words.first().unwrap_or(&""))));
    };
    Ok(Translated::Ddl(d))
}

/// MySQL's multi-table `DELETE a, b FROM t a, t b WHERE …` (WordPress's expired-transient cleanup).
fn multi_delete(stmt: &Statement) -> Option<Translated> {
    let Statement::Delete(d) = stmt else {
        return None;
    };
    if d.tables.is_empty() {
        return None;
    }
    let from = match &d.from {
        sqlparser::ast::FromTable::WithFromKeyword(t)
        | sqlparser::ast::FromTable::WithoutKeyword(t) => t,
    };
    // alias (or table name) → table
    let mut by_alias: BTreeMap<String, String> = BTreeMap::new();
    for twj in from {
        if let sqlparser::ast::TableFactor::Table { name, alias, .. } = &twj.relation {
            let table = object_name(name);
            let key = alias
                .as_ref()
                .map(|a| a.name.value.clone())
                .unwrap_or_else(|| table.clone());
            by_alias.insert(key, table);
        }
    }
    let targets: Vec<String> = d.tables.iter().map(object_name).collect();
    let tables = targets
        .iter()
        .map(|t| by_alias.get(t).cloned().unwrap_or_else(|| t.clone()))
        .collect();
    let cols = targets
        .iter()
        .enumerate()
        .map(|(i, t)| format!("{t}.rowid AS r{i}"))
        .collect::<Vec<_>>()
        .join(", ");
    let from_sql = from
        .iter()
        .map(|t| t.to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let where_sql = d
        .selection
        .as_ref()
        .map(|w| format!(" WHERE {w}"))
        .unwrap_or_default();
    Some(Translated::MultiDelete {
        select: format!("SELECT {cols} FROM {from_sql}{where_sql}"),
        tables,
    })
}

fn remove_word(s: &str, word: &str) -> String {
    let lower = s.to_ascii_uppercase();
    match lower.find(word) {
        Some(i) => format!("{}{}", &s[..i], &s[i + word.len()..]),
        None => s.to_string(),
    }
}

fn table_name(t: &TableObject) -> String {
    match t {
        TableObject::TableName(n) => object_name(n),
        other => other.to_string(),
    }
}

fn object_name(n: &ObjectName) -> String {
    n.0.last()
        .map(|p| unquote(&p.to_string()))
        .unwrap_or_default()
}

/// Statement-level rewrites; returns the table a write goes to.
fn rewrite(stmt: &mut Statement, schema: &Schema) -> Result<Option<String>, TranslateError> {
    match stmt {
        Statement::Insert(ins) => {
            let table = table_name(&ins.table);
            if ins.ignore {
                ins.ignore = false;
                ins.or = Some(SqliteOnConflict::Ignore);
            }
            if ins.replace_into {
                ins.replace_into = false;
                ins.or = Some(SqliteOnConflict::Replace);
            }
            if let Some(OnInsert::DuplicateKeyUpdate(assignments)) = ins.on.take() {
                let key = schema
                    .unique
                    .get(&table)
                    .and_then(|keys| {
                        // The first unique key whose columns are all inserted (MySQL fires on any; WordPress means the natural one).
                        let cols: Vec<String> = ins.columns.iter().map(object_name).collect();
                        keys.iter()
                            .find(|k| {
                                k.len() == 1
                                    && !k[0].ends_with("_id")
                                    && k.iter().all(|c| cols.contains(c))
                            })
                            .or_else(|| keys.iter().find(|k| k.iter().all(|c| cols.contains(c))))
                    })
                    .cloned()
                    .ok_or_else(|| {
                        TranslateError::Unsupported(format!(
                            "ON DUPLICATE KEY on {table} without a known unique key"
                        ))
                    })?;
                let assignments = assignments.into_iter().map(values_to_excluded).collect();
                ins.on = Some(OnInsert::OnConflict(OnConflict {
                    conflict_target: Some(ConflictTarget::Columns(
                        key.into_iter().map(Ident::new).collect(),
                    )),
                    action: OnConflictAction::DoUpdate(DoUpdate {
                        assignments,
                        selection: None,
                    }),
                }));
            }
            Ok(Some(table))
        }
        Statement::Update(u) if !u.table.joins.is_empty() => {
            // MySQL's multi-table UPDATE t1 JOIN (…) … SET t1.c = v: the joined row set becomes a
            // rowid subquery; the assignments may name only the updated table.
            let (table, alias) = match &u.table.relation {
                sqlparser::ast::TableFactor::Table { name, alias, .. } => {
                    let t = object_name(name);
                    (
                        t.clone(),
                        alias.as_ref().map(|a| a.name.value.clone()).unwrap_or(t),
                    )
                }
                other => return Err(TranslateError::Unsupported(format!("UPDATE of {other}"))),
            };
            let from = u.table.to_string();
            let mut sub = format!("SELECT {alias}.rowid FROM {from}");
            if let Some(w) = u.selection.take() {
                sub.push_str(&format!(" WHERE {w}"));
            }
            let prefix = format!("{alias}.");
            let mut assignments = Vec::new();
            for a in std::mem::take(&mut u.assignments) {
                let target = a.target.to_string();
                let value = a.value.to_string();
                let col = target.strip_prefix(&prefix).unwrap_or(&target).to_string();
                let value = value.replace(&prefix, "");
                if value.contains('.') && !value.starts_with('\'') {
                    return Err(TranslateError::Unsupported(
                        "UPDATE … JOIN assigning from a joined table".into(),
                    ));
                }
                assignments.push(format!("{col} = {value}"));
            }
            let sql = format!(
                "UPDATE `{table}` SET {} WHERE rowid IN ({sub})",
                assignments.join(", ")
            );
            let mut parsed = Parser::parse_sql(&sqlparser::dialect::SQLiteDialect {}, &sql)
                .map_err(|e| TranslateError::Parse(e.to_string()))?;
            *stmt = parsed.remove(0);
            Ok(Some(table))
        }
        Statement::Update(u) => {
            let table = unquote(&u.table.relation.to_string());
            // MySQL's single-table UPDATE … ORDER BY … LIMIT n: SQLite (without its optional
            // compile flag) needs the row set as a subquery.
            if u.limit.is_some() || !u.order_by.is_empty() {
                let mut sub = format!("SELECT rowid FROM `{table}`");
                if let Some(w) = u.selection.take() {
                    sub.push_str(&format!(" WHERE {w}"));
                }
                if !u.order_by.is_empty() {
                    sub.push_str(&format!(
                        " ORDER BY {}",
                        u.order_by
                            .iter()
                            .map(|o| o.to_string())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ));
                }
                if let Some(l) = u.limit.take() {
                    sub.push_str(&format!(" LIMIT {l}"));
                }
                u.order_by.clear();
                u.selection = Some(
                    parse_expr(&format!("rowid IN ({sub})"))
                        .ok_or_else(|| TranslateError::Unsupported("UPDATE … LIMIT".into()))?,
                );
            }
            Ok(Some(table))
        }
        Statement::Delete(d) => {
            let from = match &d.from {
                sqlparser::ast::FromTable::WithFromKeyword(t)
                | sqlparser::ast::FromTable::WithoutKeyword(t) => {
                    t.first().map(|t| unquote(&t.relation.to_string()))
                }
            };
            if let (Some(table), true) = (&from, d.limit.is_some() || !d.order_by.is_empty()) {
                let mut sub = format!("SELECT rowid FROM `{table}`");
                if let Some(w) = d.selection.take() {
                    sub.push_str(&format!(" WHERE {w}"));
                }
                if !d.order_by.is_empty() {
                    sub.push_str(&format!(
                        " ORDER BY {}",
                        d.order_by
                            .iter()
                            .map(|o| o.to_string())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ));
                }
                if let Some(l) = d.limit.take() {
                    sub.push_str(&format!(" LIMIT {l}"));
                }
                d.order_by.clear();
                d.selection = Some(
                    parse_expr(&format!("rowid IN ({sub})"))
                        .ok_or_else(|| TranslateError::Unsupported("DELETE … LIMIT".into()))?,
                );
            }
            Ok(from)
        }
        Statement::Query(_) => Ok(None),
        Statement::CreateTable(_)
        | Statement::AlterTable { .. }
        | Statement::Drop { .. }
        | Statement::CreateIndex(_) => Err(TranslateError::Unsupported(
            "DDL: the projection's schema is the governed layer's, not WordPress's".into(),
        )),
        other => Err(TranslateError::Unsupported(format!(
            "statement {}",
            verb(&other.to_string())
        ))),
    }
}

/// `col = VALUES(col)` becomes `col = excluded.col`.
fn values_to_excluded(mut a: Assignment) -> Assignment {
    if let Expr::Function(f) = &a.value {
        if object_name(&f.name).eq_ignore_ascii_case("VALUES") {
            if let FunctionArguments::List(list) = &f.args {
                if let Some(FunctionArg::Unnamed(FunctionArgExpr::Expr(Expr::Identifier(id)))) =
                    list.args.first()
                {
                    a.value = Expr::CompoundIdentifier(vec![Ident::new("excluded"), id.clone()]);
                }
            }
        }
    }
    if let AssignmentTarget::ColumnName(_) = &a.target {}
    a
}

/// MySQL functions WordPress uses, as SQLite expressions.
fn rewrite_functions(stmt: &mut Statement) {
    let parse = |sql: &str| {
        Parser::new(&sqlparser::dialect::SQLiteDialect {})
            .try_with_sql(sql)
            .and_then(|mut p| p.parse_expr())
            .ok()
    };
    let _ = visit_expressions_mut(stmt, |e| {
        // MySQL's `\0` escape arrives as a raw NUL, which ends a statement for SQLite.
        if let Expr::Value(v) = e {
            if let sqlparser::ast::Value::SingleQuotedString(s) = &v.value {
                if s.contains('\0') {
                    let parts: Vec<String> = s
                        .split('\0')
                        .map(|p| format!("'{}'", p.replace('\'', "''")))
                        .collect();
                    if let Some(expr) = parse(&parts.join(" || char(0) || ")) {
                        *e = expr;
                    }
                    return ControlFlow::<()>::Continue(());
                }
            }
        }
        // MySQL's LIKE escapes with a backslash by default (WordPress's esc_like relies on it); SQLite needs it said.
        if let Expr::Like {
            pattern,
            escape_char,
            ..
        } = e
        {
            if escape_char.is_none() && pattern.to_string().contains('\\') {
                *escape_char = parse("'\\'").map(Box::new);
            }
        }
        if let Expr::Function(f) = e {
            let name = object_name(&f.name).to_ascii_uppercase();
            let one_arg = match &f.args {
                FunctionArguments::List(l) if l.args.len() == 1 => Some(l.args[0].to_string()),
                _ => None,
            };
            let part = match name.as_str() {
                "YEAR" => Some("%Y"),
                "MONTH" => Some("%m"),
                "DAY" | "DAYOFMONTH" => Some("%d"),
                "HOUR" => Some("%H"),
                "MINUTE" => Some("%M"),
                "SECOND" => Some("%S"),
                _ => None,
            };
            // DATE_ADD(x, INTERVAL n UNIT) / DATE_SUB(…) → datetime(x, '±n units')
            if name == "DATE_ADD" || name == "DATE_SUB" {
                if let FunctionArguments::List(l) = &f.args {
                    if l.args.len() == 2 {
                        let base = l.args[0].to_string();
                        let iv = l.args[1].to_string();
                        let words: Vec<&str> = iv.split_whitespace().collect();
                        if words.len() == 3 && words[0].eq_ignore_ascii_case("INTERVAL") {
                            let n = words[1].trim_matches('\'');
                            let unit = words[2].to_ascii_lowercase();
                            let unit = match unit.as_str() {
                                "second" | "minute" | "hour" | "day" | "month" | "year" => {
                                    format!("{unit}s")
                                }
                                "week" => "days".to_string(),
                                other => other.to_string(),
                            };
                            let n = if words[2].eq_ignore_ascii_case("WEEK") {
                                n.parse::<i64>()
                                    .map(|w| (w * 7).to_string())
                                    .unwrap_or_else(|_| n.to_string())
                            } else {
                                n.to_string()
                            };
                            let sign = if name == "DATE_ADD" { "+" } else { "-" };
                            if let Some(expr) =
                                parse(&format!("datetime({base}, '{sign}{n} {unit}')"))
                            {
                                *e = expr;
                                return ControlFlow::<()>::Continue(());
                            }
                        }
                    }
                }
            }
            if let (Some(p), Some(arg)) = (part, &one_arg) {
                if let Some(expr) = parse(&format!("CAST(strftime('{p}', {arg}) AS INTEGER)")) {
                    *e = expr;
                    return ControlFlow::<()>::Continue(());
                }
            }
        }
        if let Expr::Function(f) = e {
            let name = object_name(&f.name).to_ascii_uppercase();
            let one_arg = match &f.args {
                FunctionArguments::List(l) if l.args.len() == 1 => Some(l.args[0].to_string()),
                _ => None,
            };
            // Same arguments, a different name.
            let renamed = match name.as_str() {
                "IF" => Some("iif"),
                "GREATEST" => Some("max"),
                "LEAST" => Some("min"),
                _ => None,
            };
            if let Some(n) = renamed {
                f.name = ObjectName::from(vec![Ident::new(n)]);
                return ControlFlow::<()>::Continue(());
            }
            let replacement = match name.as_str() {
                "NOW" | "CURRENT_TIMESTAMP" | "SYSDATE" => Some("datetime('now')".to_string()),
                "UTC_TIMESTAMP" => Some("datetime('now')".to_string()),
                "CURDATE" | "UTC_DATE" => Some("date('now')".to_string()),
                "UNIX_TIMESTAMP"
                    if matches!(&f.args, FunctionArguments::List(l) if l.args.is_empty())
                        || matches!(&f.args, FunctionArguments::None) =>
                {
                    Some("CAST(strftime('%s','now') AS INTEGER)".to_string())
                }
                "UNIX_TIMESTAMP" => one_arg
                    .as_ref()
                    .map(|a| format!("CAST(strftime('%s', {a}) AS INTEGER)")),
                "FROM_UNIXTIME" => one_arg
                    .as_ref()
                    .map(|a| format!("datetime({a}, 'unixepoch')")),
                "CHAR_LENGTH" | "CHARACTER_LENGTH" => {
                    one_arg.as_ref().map(|a| format!("length({a})"))
                }
                "UCASE" => one_arg.as_ref().map(|a| format!("upper({a})")),
                "LCASE" => one_arg.as_ref().map(|a| format!("lower({a})")),
                "RAND" => Some("random()".to_string()),
                _ => None,
            };
            if let Some(r) = replacement {
                if let Ok(expr) = Parser::new(&sqlparser::dialect::SQLiteDialect {})
                    .try_with_sql(&r)
                    .and_then(|mut p| p.parse_expr())
                {
                    *e = expr;
                }
            }
        }
        ControlFlow::<()>::Continue(())
    });
}
