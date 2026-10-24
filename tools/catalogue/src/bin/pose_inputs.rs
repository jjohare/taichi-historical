//! Emit a deduplicated, provenance-bearing input manifest for offline pose estimation.
//! This prepares inputs only; it never emits invented pose estimates.
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs};

fn main() {
    let catalogue: Vec<Value> =
        serde_json::from_str(&fs::read_to_string("assets/catalogue.json").unwrap()).unwrap();
    let mut records: BTreeMap<String, Value> = BTreeMap::new();
    for item in &catalogue {
        for image in item["images"].as_array().unwrap() {
            let source = image["source"].as_str().unwrap();
            if source == "montage" {
                continue;
            }
            let number = image["number"].as_u64().unwrap();
            let key = format!("{source}-{number:03}");
            let record = records.entry(key.clone()).or_insert_with(|| {
                json!({
                    "id":key, "image":format!("extracted/historical/{key}.png"),
                    "source_page":image["url"], "original_image":image["original"],
                    "source_label":image["label"], "occurrences":[],
                    "estimate_status":"not_run", "review_status":"not_estimated"
                })
            });
            record["occurrences"].as_array_mut().unwrap().push(json!({
                "local_id":item["id"], "name":item["name"], "mapping_status":item["status"],
                "mapping_note":item["mappingNote"]
            }));
        }
    }
    let count = records.len();
    let output = json!({"schema_version":1,"purpose":"DPMesh input preparation; no estimates or pose binding", "images":records.into_values().collect::<Vec<_>>()});
    fs::create_dir_all("research/dpmesh").unwrap();
    fs::write(
        "research/dpmesh/inputs.json",
        serde_json::to_string_pretty(&output).unwrap() + "\n",
    )
    .unwrap();
    println!("Prepared {count} unique photographic inputs; no inferred poses written.");
}
