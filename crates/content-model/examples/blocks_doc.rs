//! Prints the writer-facing block reference.
//!
//! ```text
//! cargo run -p content-model --example blocks_doc -- [path/to/site/theme/blocks]
//! ```

use content_model::{blocks_doc, SchemaRegistry};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut registry = SchemaRegistry::core();
    if let Some(dir) = std::env::args().nth(1) {
        registry.load_custom_dir(std::path::Path::new(&dir))?;
    }
    print!("{}", blocks_doc(&registry));
    Ok(())
}
