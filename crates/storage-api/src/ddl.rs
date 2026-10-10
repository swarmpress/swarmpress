//! MySQL DDL as plugins send it (through `dbDelta` and their own migrations), translated to SQLite
//! for the scratch store (ADR-0084 §3: a plugin's own tables are scratch, never committed).
//!
//! Text-level on purpose: `dbDelta` writes one definition per line and MySQL's table options
//! (`ENGINE`, `CHARSET`, `COLLATE`, prefix lengths on keys) have no SQLite meaning. Core tables
//! belong to the governed layer: DDL on them is accepted only when it changes nothing SQLite
//! keeps (a type change, a charset conversion), and refused otherwise.

/// What one DDL statement became.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Ddl {
    /// The table it is about.
    pub table: String,
    /// SQLite statements, in order.
    pub stmts: Vec<String>,
    /// Unique keys it declares (for `ON DUPLICATE KEY`).
    pub unique: Vec<Vec<String>>,
}

/// The core tables (without prefix): their schema is the governed layer's.
pub const CORE_TABLES: &[&str] = &[
    "posts",
    "postmeta",
    "terms",
    "termmeta",
    "term_taxonomy",
    "term_relationships",
    "comments",
    "commentmeta",
    "users",
    "usermeta",
    "links",
    "options",
];

pub fn is_core(table: &str) -> bool {
    match table.find('_') {
        Some(i) => CORE_TABLES.contains(&&table[i + 1..]),
        None => false,
    }
}

fn unq(s: &str) -> String {
    s.trim().trim_matches(|c| c == '`' || c == '"').to_string()
}

/// Splits at top-level commas (outside parentheses and quotes).
fn split_top(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    let mut cur = String::new();
    for c in s.chars() {
        match quote {
            Some(q) => {
                cur.push(c);
                if c == q {
                    quote = None;
                }
            }
            None => match c {
                '\'' | '"' | '`' => {
                    quote = Some(c);
                    cur.push(c);
                }
                '(' => {
                    depth += 1;
                    cur.push(c);
                }
                ')' => {
                    depth -= 1;
                    cur.push(c);
                }
                ',' if depth == 0 => {
                    out.push(cur.trim().to_string());
                    cur.clear();
                }
                _ => cur.push(c),
            },
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// The first `n` words, upper-cased and split before a parenthesis (`KEY(a)` → `KEY`).
fn first_words(s: &str, n: usize) -> String {
    s.split(|c: char| c.is_whitespace() || c == '(')
        .filter(|w| !w.is_empty())
        .take(n)
        .map(|w| w.to_ascii_uppercase())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `(a(191), `b`)` → ["a", "b"]
fn key_cols(s: &str) -> Vec<String> {
    let open = s.find('(').map(|i| i + 1).unwrap_or(0);
    let close = s.rfind(')').unwrap_or(s.len());
    split_top(&s[open..close])
        .iter()
        .map(|c| {
            let c = c.split_whitespace().next().unwrap_or("");
            let c = c.split('(').next().unwrap_or(c);
            unq(c)
        })
        .collect()
}

/// The index name SQLite will use (index names are per database there, per table in MySQL).
fn index_name(table: &str, name: &str) -> String {
    format!("{table}__{}", unq(name))
}

fn sqlite_type(mysql: &str) -> &'static str {
    let t = mysql.to_ascii_lowercase();
    let base = t
        .split(|c: char| c == '(' || c.is_whitespace())
        .next()
        .unwrap_or("");
    match base {
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "bit" | "bool"
        | "boolean" | "year" => "INTEGER",
        "float" | "double" | "real" => "REAL",
        "decimal" | "numeric" => "NUMERIC",
        "blob" | "tinyblob" | "mediumblob" | "longblob" | "binary" | "varbinary" => "BLOB",
        _ => "TEXT",
    }
}

/// A column definition: `name type [unsigned] [NOT NULL] [DEFAULT x] [auto_increment] …`.
fn column(def: &str, table_pk: &[String]) -> (String, bool) {
    let mut words = def.split_whitespace();
    let name = unq(words.next().unwrap_or(""));
    let rest: String = def[def.find(char::is_whitespace).unwrap_or(def.len())..].to_string();
    let lower = rest.to_ascii_lowercase();
    let ty_text = rest.trim();
    // The type runs to the end of its parenthesis, if it has one.
    let ty = sqlite_type(ty_text);
    let auto = lower.contains("auto_increment");
    let mut out = format!("`{name}` {ty}");
    let inline_pk = lower.contains("primary key") || (auto && table_pk == [name.clone()]);
    if auto && inline_pk {
        out = format!("`{name}` INTEGER PRIMARY KEY AUTOINCREMENT");
        return (out, true);
    }
    if lower.contains("not null") {
        out.push_str(" NOT NULL");
    }
    if let Some(i) = lower.find(" default ") {
        let after = rest[i + 9..].trim_start();
        let value = if let Some(stripped) = after.strip_prefix('\'') {
            match stripped.find('\'') {
                Some(j) => format!("'{}'", &stripped[..j]),
                None => "''".into(),
            }
        } else {
            after
                .split_whitespace()
                .next()
                .unwrap_or("NULL")
                .to_string()
        };
        let value = match value.to_ascii_uppercase().as_str() {
            "CURRENT_TIMESTAMP" | "CURRENT_TIMESTAMP()" | "NOW()" => {
                "CURRENT_TIMESTAMP".to_string()
            }
            _ => value,
        };
        out.push_str(&format!(" DEFAULT {value}"));
    }
    if lower.contains("primary key") {
        out.push_str(" PRIMARY KEY");
    }
    (out, inline_pk)
}

/// `CREATE TABLE [IF NOT EXISTS] t ( … ) options`
pub fn create_table(sql: &str) -> Result<Ddl, String> {
    let open = sql.find('(').ok_or("CREATE TABLE without columns")?;
    let close = sql.rfind(')').ok_or("CREATE TABLE without columns")?;
    let head = &sql[..open];
    let table = unq(head.split_whitespace().last().unwrap_or(""));
    let parts = split_top(&sql[open + 1..close]);
    let mut pk: Vec<String> = Vec::new();
    for p in &parts {
        if first_words(p, 2) == "PRIMARY KEY" {
            pk = key_cols(p);
        }
    }
    let mut cols = Vec::new();
    let mut extra = Vec::new();
    let mut unique = Vec::new();
    let mut pk_inline = false;
    for p in &parts {
        // By whole words: a column named `key_id` is not a KEY.
        let u = first_words(p, 2);
        if u.starts_with("PRIMARY KEY") {
            continue;
        } else if u.starts_with("UNIQUE ") || u == "UNIQUE" {
            let cols_k = key_cols(p);
            let name = p
                .split_whitespace()
                .nth(2)
                .filter(|w| !w.starts_with('('))
                .map(|w| w.split('(').next().unwrap_or(w).to_string())
                .unwrap_or_else(|| cols_k.join("_"));
            extra.push(format!(
                "CREATE UNIQUE INDEX IF NOT EXISTS `{}` ON `{table}` ({})",
                index_name(&table, &name),
                cols_k
                    .iter()
                    .map(|c| format!("`{c}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
            unique.push(cols_k);
        } else if u == "KEY"
            || u.starts_with("KEY ")
            || u == "INDEX"
            || u.starts_with("INDEX ")
            || u.starts_with("FULLTEXT")
            || u.starts_with("SPATIAL")
        {
            let words: Vec<&str> = p.split_whitespace().collect();
            let skip = if u.starts_with("FULLTEXT") || u.starts_with("SPATIAL") {
                2
            } else {
                1
            };
            let name = words
                .get(skip)
                .map(|w| w.split('(').next().unwrap_or(w))
                .unwrap_or("k");
            let cols_k = key_cols(p);
            extra.push(format!(
                "CREATE INDEX IF NOT EXISTS `{}` ON `{table}` ({})",
                index_name(&table, name),
                cols_k
                    .iter()
                    .map(|c| format!("`{c}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        } else if u.starts_with("CONSTRAINT ")
            || u.starts_with("FOREIGN KEY")
            || u.starts_with("CHECK ")
        {
            continue;
        } else {
            let (c, inline) = column(p, &pk);
            pk_inline |= inline;
            cols.push(c);
        }
    }
    if !pk.is_empty() && !pk_inline {
        cols.push(format!(
            "PRIMARY KEY ({})",
            pk.iter()
                .map(|c| format!("`{c}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if !pk.is_empty() {
        unique.insert(0, pk);
    }
    let mut stmts = vec![format!(
        "CREATE TABLE IF NOT EXISTS `{table}` ({})",
        cols.join(", ")
    )];
    stmts.extend(extra);
    Ok(Ddl {
        table,
        stmts,
        unique,
    })
}

/// `CREATE [UNIQUE] INDEX name ON t (cols)`
pub fn create_index(sql: &str) -> Result<Ddl, String> {
    let words: Vec<&str> = sql.split_whitespace().collect();
    let unique = words
        .get(1)
        .is_some_and(|w| w.eq_ignore_ascii_case("UNIQUE"));
    let on = words
        .iter()
        .position(|w| w.eq_ignore_ascii_case("ON"))
        .ok_or("CREATE INDEX without ON")?;
    let name = words[on - 1];
    let table = unq(words
        .get(on + 1)
        .ok_or("CREATE INDEX without a table")?
        .split('(')
        .next()
        .unwrap_or(""));
    let cols = key_cols(&sql[sql.find('(').ok_or("CREATE INDEX without columns")?..]);
    let kw = if unique { "UNIQUE INDEX" } else { "INDEX" };
    Ok(Ddl {
        stmts: vec![format!(
            "CREATE {kw} IF NOT EXISTS `{}` ON `{table}` ({})",
            index_name(&table, name),
            cols.iter()
                .map(|c| format!("`{c}`"))
                .collect::<Vec<_>>()
                .join(", ")
        )],
        unique: if unique { vec![cols] } else { vec![] },
        table,
    })
}

/// `ALTER TABLE t op, op, …`; `existing` lists the table's columns.
pub fn alter_table(sql: &str, existing: &[String]) -> Result<Ddl, String> {
    let words: Vec<&str> = sql.split_whitespace().collect();
    let table = unq(words.get(2).ok_or("ALTER TABLE without a table")?);
    let body_start = sql
        .find(words[2])
        .map(|i| i + words[2].len())
        .unwrap_or(sql.len());
    let mut d = Ddl {
        table: table.clone(),
        ..Ddl::default()
    };
    for op in split_top(&sql[body_start..]) {
        let u = op.to_ascii_uppercase();
        let w: Vec<&str> = op.split_whitespace().collect();
        if u.starts_with("ADD PRIMARY KEY")
            || u.starts_with("DROP PRIMARY KEY")
            || u.starts_with("CONVERT TO")
            || u.starts_with("ENGINE")
            || u.starts_with("DEFAULT CHARSET")
            || u.starts_with("CHARACTER SET")
            || u.starts_with("COLLATE")
            || u.starts_with("AUTO_INCREMENT")
            || u.starts_with("ALTER COLUMN")
            || u.starts_with("ADD CONSTRAINT")
            || u.starts_with("ADD FOREIGN")
            || u.starts_with("DROP FOREIGN")
        {
            continue;
        }
        if u.starts_with("ADD UNIQUE") {
            let mysql = format!(
                "CREATE UNIQUE INDEX {} ON `{table}` {}",
                w.get(3)
                    .filter(|x| !x.starts_with('('))
                    .map(|x| x.split('(').next().unwrap_or(x))
                    .unwrap_or("u"),
                &op[op.find('(').ok_or("ADD UNIQUE without columns")?..]
            );
            let i = create_index(&mysql)?;
            d.stmts.extend(i.stmts);
            d.unique.extend(i.unique);
        } else if u.starts_with("ADD INDEX")
            || u.starts_with("ADD KEY")
            || u.starts_with("ADD FULLTEXT")
        {
            let skip = if u.starts_with("ADD FULLTEXT") { 3 } else { 2 };
            let name = w
                .get(skip)
                .map(|x| x.split('(').next().unwrap_or(x))
                .unwrap_or("k");
            let i = create_index(&format!(
                "CREATE INDEX {name} ON `{table}` {}",
                &op[op.find('(').ok_or("ADD INDEX without columns")?..]
            ))?;
            d.stmts.extend(i.stmts);
        } else if u.starts_with("DROP INDEX") || u.starts_with("DROP KEY") {
            d.stmts.push(format!(
                "DROP INDEX IF EXISTS `{}`",
                index_name(&table, w.get(2).unwrap_or(&""))
            ));
        } else if u.starts_with("DROP COLUMN") || (u.starts_with("DROP ") && w.len() == 2) {
            let col = unq(w.last().unwrap_or(&""));
            if existing.contains(&col) {
                d.stmts
                    .push(format!("ALTER TABLE `{table}` DROP COLUMN `{col}`"));
            }
        } else if u.starts_with("ADD") {
            let def = if u.starts_with("ADD COLUMN") {
                op[10..].trim()
            } else {
                op[3..].trim()
            };
            let col = unq(def.split_whitespace().next().unwrap_or(""));
            if !existing.contains(&col) {
                let (c, _) = column(def, &[]);
                // SQLite cannot add a NOT NULL column without a default.
                let c = if c.contains("NOT NULL") && !c.contains("DEFAULT") {
                    c.replace(" NOT NULL", "")
                } else {
                    c
                };
                d.stmts
                    .push(format!("ALTER TABLE `{table}` ADD COLUMN {c}"));
            }
        } else if u.starts_with("CHANGE") {
            // CHANGE [COLUMN] old new type…: a rename is kept, a type change has no SQLite meaning.
            let rest: Vec<&str> = w
                .iter()
                .skip(if u.starts_with("CHANGE COLUMN") { 2 } else { 1 })
                .copied()
                .collect();
            let (old, new) = (
                unq(rest.first().unwrap_or(&"")),
                unq(rest.get(1).unwrap_or(&"")),
            );
            if old != new && existing.contains(&old) {
                d.stmts.push(format!(
                    "ALTER TABLE `{table}` RENAME COLUMN `{old}` TO `{new}`"
                ));
            }
        } else if u.starts_with("MODIFY") {
            continue;
        } else if u.starts_with("RENAME TO") || u.starts_with("RENAME AS") {
            d.stmts.push(format!(
                "ALTER TABLE `{table}` RENAME TO `{}`",
                unq(w.get(2).unwrap_or(&""))
            ));
        } else {
            return Err(format!(
                "ALTER TABLE operation {}",
                w.first().unwrap_or(&"")
            ));
        }
    }
    Ok(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dbdelta_table_becomes_sqlite_with_its_keys() {
        let d = create_table(
            "CREATE TABLE wp_wc_tax_rate_classes (\n tax_rate_class_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,\n name varchar(200) NOT NULL DEFAULT '',\n slug varchar(200) NOT NULL DEFAULT '',\n PRIMARY KEY  (tax_rate_class_id),\n UNIQUE KEY slug (slug(191))\n) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci",
        )
        .unwrap();
        assert_eq!(d.table, "wp_wc_tax_rate_classes");
        assert_eq!(
            d.stmts[0],
            "CREATE TABLE IF NOT EXISTS `wp_wc_tax_rate_classes` (`tax_rate_class_id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT NOT NULL DEFAULT '', `slug` TEXT NOT NULL DEFAULT '')"
        );
        assert_eq!(d.stmts[1], "CREATE UNIQUE INDEX IF NOT EXISTS `wp_wc_tax_rate_classes__slug` ON `wp_wc_tax_rate_classes` (`slug`)");
        assert_eq!(
            d.unique,
            vec![
                vec!["tax_rate_class_id".to_string()],
                vec!["slug".to_string()]
            ]
        );
    }

    #[test]
    fn a_column_named_like_a_keyword_is_a_column() {
        let d = create_table("CREATE TABLE wp_k (\n key_id bigint(20) unsigned NOT NULL auto_increment,\n index_no int NOT NULL,\n PRIMARY KEY  (key_id),\n KEY index_no (index_no)\n)").unwrap();
        assert_eq!(d.stmts[0], "CREATE TABLE IF NOT EXISTS `wp_k` (`key_id` INTEGER PRIMARY KEY AUTOINCREMENT, `index_no` INTEGER NOT NULL)");
    }

    #[test]
    fn alter_keeps_what_sqlite_can_mean_and_skips_the_rest() {
        let existing = vec!["id".to_string(), "a".to_string()];
        let d = alter_table("ALTER TABLE wp_x ADD COLUMN b int NOT NULL, CHANGE a a bigint, ADD INDEX b (b), CONVERT TO CHARACTER SET utf8mb4", &existing).unwrap();
        assert_eq!(
            d.stmts,
            vec![
                "ALTER TABLE `wp_x` ADD COLUMN `b` INTEGER",
                "CREATE INDEX IF NOT EXISTS `wp_x__b` ON `wp_x` (`b`)"
            ]
        );
    }
}
