//! The owner's Claude Design export, when it is on this machine (never in CI).
use std::collections::BTreeMap;

use site_design::{interpret, DesignBundle, DesignSource};

const EXPORT: &str = "/Users/drietsch/Downloads/Cinque Terre Dispatch Style Guide.html";

#[test]
fn the_full_style_guide_interprets_when_present() {
    let Ok(html) = std::fs::read(EXPORT) else {
        eprintln!("skipped: {EXPORT} is not here");
        return;
    };
    let files = BTreeMap::from([("style-guide.html".to_string(), html)]);
    let bundle = DesignBundle::from_upload(files, DesignSource::Upload, 0).expect("unpacks");
    let d = interpret(&bundle);
    if let Ok(out) = std::env::var("SITE_DESIGN_DUMP") {
        std::fs::write(&out, serde_json::to_string_pretty(&d).unwrap()).unwrap();
        let m = bundle.manifest();
        std::fs::write(
            format!("{out}.manifest.json"),
            serde_json::to_string_pretty(&m).unwrap(),
        )
        .unwrap();
    }
    assert_eq!(d.pages.len(), 10);
}
