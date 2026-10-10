//! A branch's relational projection: WordPress's tables in SQLite, built from the repository
//! (`crate::objects`), plus the scratch state WordPress keeps for itself. It runs translated
//! statements and answers introspection the way MySQL would.
//!
//! The SQLite underneath is an [`Exec`]: rusqlite natively (`Native`, feature `native`), the
//! game's sqlite-wasm in the browser (through `storage-api-wasm`).

use serde_json::Value;

use crate::translate::{translate, Schema, TranslateError, Translated};

/// WordPress's core schema, as the governed layer keeps it (read from the database WordPress
/// created; tables only, no WordPress code).
pub const WORDPRESS_SCHEMA: &str = include_str!("../schema/wordpress.sql");

/// Rows as SQLite returned them: integers as JSON numbers, text as strings.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rows {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

/// A SQLite connection, synchronous.
pub trait Exec {
    fn query(&mut self, sql: &str) -> Result<Rows, String>;
    /// Runs one write; returns the rows changed and the last insert rowid.
    fn execute(&mut self, sql: &str) -> Result<(u64, i64), String>;
    /// Runs several statements.
    fn batch(&mut self, sql: &str) -> Result<(), String>;
}

/// What a statement returned to WordPress: the columns in the order the query named them
/// (wpdb's numeric results depend on it) and every value as text, as MySQL's wire sends it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Outcome {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: u64,
    pub insert_id: i64,
}

#[derive(Debug)]
pub enum ProjectionError {
    Translate(TranslateError),
    Sqlite(String),
    /// A governed write on `live`: work happens on branches (ADR-0080).
    LiveIsReadOnly(String),
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectionError::Translate(e) => write!(f, "{e}"),
            ProjectionError::Sqlite(e) => write!(f, "sqlite: {e}"),
            ProjectionError::LiveIsReadOnly(t) => {
                write!(f, "live is read-only: a write to {t} needs a branch")
            }
        }
    }
}

impl From<String> for ProjectionError {
    fn from(e: String) -> Self {
        ProjectionError::Sqlite(e)
    }
}

pub struct Projection<E: Exec> {
    pub(crate) db: E,
    schema: Schema,
    found_rows: i64,
}

fn as_text(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::String(n.to_string()),
        other => other,
    }
}

impl<E: Exec> Projection<E> {
    /// A projection over `db` with `ddl` (SQLite) as its schema; `db` is empty.
    pub fn with(mut db: E, ddl: &str) -> Result<Projection<E>, ProjectionError> {
        db.batch(ddl)?;
        // MySQL's information_schema.TABLES, as WordPress asks it whether its tables exist.
        db.batch(
            "ATTACH DATABASE ':memory:' AS information_schema;
             CREATE TABLE information_schema.TABLES (TABLE_SCHEMA TEXT, TABLE_NAME TEXT, TABLE_TYPE TEXT, ENGINE TEXT);",
        )?;
        let mut p = Projection {
            db,
            schema: Schema::from_sqlite_ddl(ddl),
            found_rows: 0,
        };
        p.refresh_schema()?;
        Ok(p)
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    pub fn exec(&mut self) -> &mut E {
        &mut self.db
    }

    /// Re-reads every table's columns into the schema and information_schema (after DDL).
    fn refresh_schema(&mut self) -> Result<(), ProjectionError> {
        let tables = self.db.query(
            "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )?;
        self.schema.columns.clear();
        for row in tables.rows {
            let Some(t) = row[0].as_str() else { continue };
            let cols = self.db.query(&format!(
                "SELECT name FROM pragma_table_info('{}')",
                t.replace('\'', "''")
            ))?;
            self.schema.columns.insert(
                t.to_string(),
                cols.rows
                    .into_iter()
                    .filter_map(|r| r[0].as_str().map(str::to_string))
                    .collect(),
            );
        }
        self.db.batch(
            "DELETE FROM information_schema.TABLES;
             INSERT INTO information_schema.TABLES SELECT 'wordpress', name, 'BASE TABLE', 'InnoDB' FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';",
        )?;
        Ok(())
    }

    fn select(&mut self, sql: &str) -> Result<Outcome, ProjectionError> {
        let r = self.db.query(sql)?;
        Ok(Outcome {
            columns: r.columns,
            rows: r
                .rows
                .into_iter()
                .map(|row| row.into_iter().map(as_text).collect())
                .collect(),
            ..Outcome::default()
        })
    }

    /// Translates and runs one MySQL statement.
    pub fn query(&mut self, mysql: &str) -> Result<(Translated, Outcome), ProjectionError> {
        let t = translate(mysql, &self.schema).map_err(ProjectionError::Translate)?;
        let out = self.run(&t)?;
        Ok((t, out))
    }

    pub fn run(&mut self, t: &Translated) -> Result<Outcome, ProjectionError> {
        match t {
            Translated::Session | Translated::ShowVariables => Ok(Outcome::default()),
            Translated::Ddl(d) => {
                for stmt in &d.stmts {
                    self.db.batch(stmt)?;
                }
                let keys = self.schema.unique.entry(d.table.clone()).or_default();
                for k in &d.unique {
                    if !keys.contains(k) {
                        keys.push(k.clone());
                    }
                }
                self.refresh_schema()?;
                Ok(Outcome::default())
            }
            Translated::FoundRows => Ok(Outcome {
                columns: vec!["FOUND_ROWS()".into()],
                rows: vec![vec![Value::String(self.found_rows.to_string())]],
                ..Outcome::default()
            }),
            Translated::ShowTables(like) => {
                let pattern = like.clone().unwrap_or_else(|| "%".into());
                self.select(&format!(
                    "SELECT name AS \"Tables_in_wordpress\" FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name LIKE '{}' ORDER BY name",
                    pattern.replace('\'', "''")
                ))
            }
            Translated::Describe(table) => self.select(&format!(
                "SELECT name AS \"Field\", type AS \"Type\", CASE WHEN \"notnull\" = 1 THEN 'NO' ELSE 'YES' END AS \"Null\", CASE WHEN pk > 0 THEN 'PRI' ELSE '' END AS \"Key\", dflt_value AS \"Default\", '' AS \"Extra\" FROM pragma_table_info('{}')",
                table.replace('\'', "''")
            )),
            Translated::ShowIndex(table) => self.select(&format!(
                "SELECT '{t}' AS \"Table\", CASE WHEN \"unique\" = 1 THEN 0 ELSE 1 END AS \"Non_unique\", name AS \"Key_name\" FROM pragma_index_list('{t}')",
                t = table.replace('\'', "''")
            )),
            Translated::MultiDelete { select, tables } => {
                // The row sets first (a later target's rows may depend on an earlier one's), then the deletes.
                let found = self.db.query(select)?;
                let mut n = 0;
                for (i, table) in tables.iter().enumerate() {
                    let ids: Vec<String> = found
                        .rows
                        .iter()
                        .filter_map(|r| r.get(i).and_then(Value::as_i64))
                        .map(|i| i.to_string())
                        .collect();
                    if ids.is_empty() {
                        continue;
                    }
                    n += self
                        .db
                        .execute(&format!("DELETE FROM `{table}` WHERE rowid IN ({})", ids.join(",")))?
                        .0;
                }
                Ok(Outcome { rows_affected: n, ..Outcome::default() })
            }
            Translated::Sql { sql, write, calc_found_rows } => {
                if write.is_none() {
                    let out = self.select(sql)?;
                    if *calc_found_rows {
                        // The count without the LIMIT, as FOUND_ROWS() reports it.
                        let base = strip_limit(sql);
                        let n = self
                            .db
                            .query(&format!("SELECT COUNT(*) FROM ({base})"))
                            .ok()
                            .and_then(|r| r.rows.first().and_then(|row| row[0].as_i64()));
                        self.found_rows = n.unwrap_or(out.rows.len() as i64);
                    } else {
                        self.found_rows = out.rows.len() as i64;
                    }
                    Ok(out)
                } else {
                    let (n, id) = self.db.execute(sql)?;
                    Ok(Outcome { rows_affected: n, insert_id: id, ..Outcome::default() })
                }
            }
        }
    }
}

/// The query without its trailing `LIMIT …` (the printed form puts LIMIT last).
fn strip_limit(sql: &str) -> String {
    let upper = sql.to_ascii_uppercase();
    match upper.rfind(" LIMIT ") {
        Some(i) => sql[..i].to_string(),
        None => sql.to_string(),
    }
}

#[cfg(feature = "native")]
pub use native::Native;

#[cfg(feature = "native")]
mod native {
    use super::*;
    use rusqlite::{functions::FunctionFlags, types::ValueRef, Connection};

    /// rusqlite, in memory.
    pub struct Native(pub Connection);

    impl Native {
        pub fn memory() -> Result<Native, String> {
            let db = Connection::open_in_memory().map_err(|e| e.to_string())?;
            db.create_scalar_function(
                "regexp",
                2,
                FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
                |ctx| {
                    // MySQL's REGEXP as a literal-substring match (anchors trimmed) until a regex engine is needed.
                    let pattern: String = ctx.get(0)?;
                    let text: Option<String> = ctx.get(1)?;
                    Ok(text
                        .map(|t| t.contains(pattern.trim_matches('^').trim_matches('$')))
                        .unwrap_or(false))
                },
            )
            .map_err(|e| e.to_string())?;
            Ok(Native(db))
        }
    }

    fn value_of(v: ValueRef<'_>) -> Value {
        match v {
            ValueRef::Null => Value::Null,
            ValueRef::Integer(i) => Value::from(i),
            ValueRef::Real(f) => Value::String(f.to_string()),
            ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
            ValueRef::Blob(b) => Value::String(String::from_utf8_lossy(b).into_owned()),
        }
    }

    impl Exec for Native {
        fn query(&mut self, sql: &str) -> Result<Rows, String> {
            let mut stmt = self.0.prepare(sql).map_err(|e| e.to_string())?;
            let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let n = columns.len();
            let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            while let Some(r) = rows.next().map_err(|e| e.to_string())? {
                let mut row = Vec::with_capacity(n);
                for i in 0..n {
                    row.push(value_of(r.get_ref(i).map_err(|e| e.to_string())?));
                }
                out.push(row);
            }
            Ok(Rows { columns, rows: out })
        }

        fn execute(&mut self, sql: &str) -> Result<(u64, i64), String> {
            let n = self.0.execute(sql, []).map_err(|e| e.to_string())?;
            Ok((n as u64, self.0.last_insert_rowid()))
        }

        fn batch(&mut self, sql: &str) -> Result<(), String> {
            self.0.execute_batch(sql).map_err(|e| e.to_string())
        }
    }

    impl Projection<Native> {
        /// An empty in-memory projection with `ddl` as its schema.
        pub fn open(ddl: &str) -> Result<Projection<Native>, ProjectionError> {
            Projection::with(Native::memory()?, ddl)
        }
    }
}
