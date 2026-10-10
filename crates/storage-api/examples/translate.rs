//! Prints what the translator makes of statements in a corpus file that match a filter.
//!
//! cargo run -p storage-api --example translate -- <corpus.jsonl> <substring> [limit]

use storage_api::{translate, Schema};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let corpus = std::fs::read_to_string(&args[1]).expect("corpus");
    let limit: usize = args.get(3).and_then(|n| n.parse().ok()).unwrap_or(2);
    let schema = Schema::from_sqlite_ddl(include_str!("../schema/wordpress.sql"));
    for line in corpus.lines().filter(|l| l.contains(&args[2])).take(limit) {
        let row: serde_json::Value = serde_json::from_str(line).unwrap();
        let q = row["q"].as_str().unwrap();
        println!("MySQL:  {q}\nSQLite: {:?}\n", translate(q, &schema));
    }
}
