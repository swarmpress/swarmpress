//! Index a site checkout and print a summary.
//!
//! ```text
//! cargo run -p knowledge --example index_site -- /home/user/cinqueterre.travel [--details]
//! ```

use content_model::{validate_page_v1, validate_page_v2, SchemaRegistry};
use knowledge::{load_custom_blocks, DirSource, KnowledgeBase, SiteSource, SiteSummary};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let root = args
        .next()
        .unwrap_or_else(|| "/home/user/cinqueterre.travel".to_string());
    let details = args.any(|a| a == "--details");
    let src = DirSource::new(&root);
    let kb = KnowledgeBase::build(&src)?;
    let audit = kb.audit(&src)?;
    print!("{}", SiteSummary::new(&kb, Some(&audit)));

    let mut registry = SchemaRegistry::core();
    let custom = load_custom_blocks(&src, &mut registry)?;
    let (mut v1, mut v2) = (0, 0);
    for p in &kb.pages.pages {
        if let Some(v) = src.read_json(&p.path)? {
            v1 += usize::from(validate_page_v1(&v).is_ok());
            v2 += usize::from(validate_page_v2(&v, &registry).is_ok());
        }
    }
    println!(
        "schema: {} pages pass v1, {} pass v2 ({} custom blocks registered)",
        v1,
        v2,
        custom.len()
    );

    if details {
        println!("\nduplicates:");
        for d in &kb.pages.duplicates {
            println!("  {:?}: {}", d.kind, d.paths.join(" <> "));
        }
        println!("\nbroken refs:");
        for (path, b) in &audit.broken {
            println!(
                "  {path}{} [{:?}] {} — {}",
                b.pointer, b.kind, b.value, b.reason
            );
        }
        println!("\nunknown media:");
        for (path, m) in &audit.unknown_media {
            println!("  {path}{} {} — {}", m.pointer, m.value, m.reason);
        }
        println!("\nmanifest notes:");
        for n in &kb.manifest.notes {
            println!("  {n}");
        }
        println!(
            "\nindex issues: media {:?}\n  collections {:?}\n  entities {:?}",
            kb.media.issues, kb.collections.issues, kb.entities.issues
        );
    }
    Ok(())
}
