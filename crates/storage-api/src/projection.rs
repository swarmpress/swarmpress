//! A branch's relational projection: WordPress's tables in SQLite, rebuilt
//! from the repository (later; the spike starts empty). It runs translated
//! statements and answers introspection the way MySQL would.

use rusqlite::{functions::FunctionFlags, types::ValueRef, Connection};
use serde_json::Value;

use crate::translate::{translate, Schema, TranslateError, Translated};

/// What a statement returned: the columns in the order the query named them (wpdb's numeric
/// results depend on it), and each row's values in that order.
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
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProjectionError::Translate(e) => write!(f, "{e}"),
            ProjectionError::Sqlite(e) => write!(f, "sqlite: {e}"),
        }
    }
}

impl From<rusqlite::Error> for ProjectionError {
    fn from(e: rusqlite::Error) -> Self {
        ProjectionError::Sqlite(e.to_string())
    }
}

pub struct Projection {
    db: Connection,
    schema: Schema,
    found_rows: i64,
}

fn value_of(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        // MySQL's wire hands every value as text; wpdb works with strings.
        ValueRef::Integer(i) => Value::String(i.to_string()),
        ValueRef::Real(f) => Value::String(f.to_string()),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Value::String(String::from_utf8_lossy(b).into_owned()),
    }
}

impl Projection {
    /// An empty projection with `ddl` (SQLite) as its schema.
    pub fn open(ddl: &str) -> Result<Projection, ProjectionError> {
        let db = Connection::open_in_memory()?;
        db.execute_batch(ddl)?;
        db.create_scalar_function(
            "regexp",
            2,
            FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                // MySQL's REGEXP as a literal-substring approximation in the spike (no regex crate yet).
                let pattern: String = ctx.get(0)?;
                let text: Option<String> = ctx.get(1)?;
                Ok(text
                    .map(|t| t.contains(pattern.trim_matches('^').trim_matches('$')))
                    .unwrap_or(false))
            },
        )?;
        // MySQL's information_schema.TABLES, as WordPress asks it whether its tables exist.
        db.execute_batch(
            "ATTACH DATABASE ':memory:' AS information_schema;
             CREATE TABLE information_schema.TABLES (TABLE_SCHEMA TEXT, TABLE_NAME TEXT, TABLE_TYPE TEXT, ENGINE TEXT);
             INSERT INTO information_schema.TABLES SELECT 'wordpress', name, 'BASE TABLE', 'InnoDB' FROM main.sqlite_master WHERE type = 'table';",
        )?;
        let mut p = Projection {
            db,
            schema: Schema::from_sqlite_ddl(ddl),
            found_rows: 0,
        };
        p.refresh_columns()?;
        Ok(p)
    }

    /// Re-reads every table's columns into the schema (after DDL).
    fn refresh_columns(&mut self) -> Result<(), ProjectionError> {
        let tables: Vec<String> = {
            let mut st = self.db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")?;
            let rows = st.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<_, _>>()?
        };
        self.schema.columns.clear();
        for t in tables {
            let mut st = self.db.prepare(&format!(
                "SELECT name FROM pragma_table_info('{}')",
                t.replace('\'', "''")
            ))?;
            let cols = st
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            self.schema.columns.insert(t, cols);
        }
        Ok(())
    }

    pub fn schema(&self) -> &Schema {
        &self.schema
    }

    fn select(&self, sql: &str) -> Result<Outcome, ProjectionError> {
        let mut stmt = self.db.prepare(sql)?;
        let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            let mut row = Vec::with_capacity(columns.len());
            for i in 0..columns.len() {
                row.push(value_of(r.get_ref(i)?));
            }
            out.push(row);
        }
        Ok(Outcome {
            columns,
            rows: out,
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
                    self.db.execute_batch(stmt)?;
                }
                let keys = self.schema.unique.entry(d.table.clone()).or_default();
                for k in &d.unique {
                    if !keys.contains(k) {
                        keys.push(k.clone());
                    }
                }
                self.refresh_columns()?;
                // MySQL's information_schema learns the new table too.
                self.db.execute_batch(
                    "DELETE FROM information_schema.TABLES;
                     INSERT INTO information_schema.TABLES SELECT 'wordpress', name, 'BASE TABLE', 'InnoDB' FROM main.sqlite_master WHERE type = 'table';",
                )?;
                Ok(Outcome::default())
            }
            Translated::FoundRows => {
                Ok(Outcome { columns: vec!["FOUND_ROWS()".into()], rows: vec![vec![Value::String(self.found_rows.to_string())]], ..Outcome::default() })
            }
            Translated::ShowTables(like) => {
                let pattern = like.clone().unwrap_or_else(|| "%".into());
                self.select(&format!("SELECT name AS \"Tables_in_wordpress\" FROM sqlite_master WHERE type = 'table' AND name LIKE '{}' ORDER BY name", pattern.replace('\'', "''")))
            }
            Translated::Describe(table) => {
                self
                    .select(&format!("SELECT name AS \"Field\", type AS \"Type\", CASE WHEN \"notnull\" = 1 THEN 'NO' ELSE 'YES' END AS \"Null\", CASE WHEN pk > 0 THEN 'PRI' ELSE '' END AS \"Key\", dflt_value AS \"Default\", '' AS \"Extra\" FROM pragma_table_info('{}')", table.replace('\'', "''")))
            }
            Translated::ShowIndex(table) => {
                self.select(&format!("SELECT '{t}' AS \"Table\", CASE WHEN \"unique\" = 1 THEN 0 ELSE 1 END AS \"Non_unique\", name AS \"Key_name\" FROM pragma_index_list('{t}')", t = table.replace('\'', "''")))
            }
            Translated::MultiDelete { select, tables } => {
                // The row sets first (a later target's rows may depend on an earlier one's), then the deletes.
                let mut stmt = self.db.prepare(select)?;
                let mut sets: Vec<Vec<i64>> = vec![Vec::new(); tables.len()];
                let mut rows = stmt.query([])?;
                while let Some(r) = rows.next()? {
                    for (i, set) in sets.iter_mut().enumerate() {
                        if let Ok(id) = r.get::<_, i64>(i) {
                            set.push(id);
                        }
                    }
                }
                drop(rows);
                drop(stmt);
                let mut n = 0;
                for (table, set) in tables.iter().zip(sets) {
                    if set.is_empty() {
                        continue;
                    }
                    let ids = set.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
                    n += self.db.execute(&format!("DELETE FROM `{table}` WHERE rowid IN ({ids})"), [])?;
                }
                Ok(Outcome { rows_affected: n as u64, ..Outcome::default() })
            }
            Translated::Sql { sql, write, calc_found_rows } => {
                if write.is_none() {
                    let out = self.select(sql)?;
                    if *calc_found_rows {
                        // The count without the LIMIT, as FOUND_ROWS() reports it.
                        let base = strip_limit(sql);
                        let n: i64 = self.db.query_row(&format!("SELECT COUNT(*) FROM ({base})"), [], |r| r.get(0)).unwrap_or(out.rows.len() as i64);
                        self.found_rows = n;
                    } else {
                        self.found_rows = out.rows.len() as i64;
                    }
                    Ok(out)
                } else {
                    let n = self.db.execute(sql, [])?;
                    Ok(Outcome { rows_affected: n as u64, insert_id: self.db.last_insert_rowid(), ..Outcome::default() })
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
