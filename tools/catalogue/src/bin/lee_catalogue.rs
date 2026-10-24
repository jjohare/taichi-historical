//! Build the separate Lee research catalogue and its readable static entries.
//! Run from the repository root with `cargo run --manifest-path tools/catalogue/Cargo.toml --bin lee_catalogue`.
use serde_json::{Value, json};
use std::{error::Error, fs};

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut entries: Vec<Value> =
        serde_json::from_str(&fs::read_to_string("lee/research/sequence-index.json")?)?;
    let annotations: Vec<Value> =
        serde_json::from_str(&fs::read_to_string("lee/research/annotations.json")?)?;
    let mut sources: Value =
        serde_json::from_str(&fs::read_to_string("lee/research/sources.json")?)?;
    assert_eq!(entries.len(), 42);
    assert_eq!(annotations.len(), 42);
    let mut index = String::from(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Lee main form · complete index</title><link rel=\"stylesheet\" href=\"../assets/site.css\"><link rel=\"stylesheet\" href=\"lee.css\"><main class=\"wrap document\"><a href=\"./\">← Lee form explorer</a><h1>The main form</h1><p>42 named sets. Movement ranges follow West Yorkshire Tai Chi; the closing range is shared because the boundary between sets 41 and 42 has not been verified. These are later teaching references, not authenticated historical pose reconstructions.</p><ol class=\"plain-index\">",
    );
    for (i, entry) in entries.iter_mut().enumerate() {
        let annotation = &annotations[i];
        assert_eq!(entry["ordinal"], annotation["ordinal"]);
        let key = format!("teacher-{:02}", i + 1);
        if let Some(url) = entry["teachingUrl"].as_str() {
            sources[&key] = json!({"title":format!("Angie Wood · set {}", i+1),"author":"Angie Wood","url":url,"kind":"Later teaching","date":"Course page checked 24 October 2026","note":"Brief public course outline. Detailed paid lessons were not accessed; no historical date or complete footwork is inferred from the outline."});
        }
        let source = if annotation["source"] == "teacher" {
            key.as_str()
        } else {
            annotation["source"].as_str().unwrap()
        };
        assert!(sources.get(source).is_some(), "Missing source {source}");
        entry["position"] = json!({"text":annotation["position"],"source":source,"kind":if annotation["gap"] == true {"Evidence gap"} else {"Later teaching"}});
        entry["attention"] =
            json!({"text":annotation["attention"],"kind":"Editorial observation prompt"});
        entry["application"] = json!({"text":annotation["application"].as_str().unwrap_or("No sequence-specific historical application has been verified here. The linked lesson supplies movement context; any partner interpretation needs its own teacher and source."),"source":annotation["applicationSource"],"kind":if annotation["applicationSource"].is_string() {"Later interpretation"} else {"Evidence limit"}});
        entry["comparison"] = annotation["comparison"].clone();
        entry["historicalMatch"] = json!("unverified");
        entry["pdfPage"] = if i < 5 {
            json!(24 + i * 2)
        } else {
            Value::Null
        };
        entry["rangeLabel"] = json!(format!(
            "{}–{}{}",
            entry["start"],
            entry["end"],
            if i >= 40 {
                " · shared closing passage"
            } else {
                ""
            }
        ));
        entry["previous"] = if i > 0 {
            json!(format!("lee-{i:02}"))
        } else {
            Value::Null
        };
        entry["next"] = if i < 41 {
            json!(format!("lee-{:02}", i + 2))
        } else {
            Value::Null
        };
        let name = entry["name"].as_str().unwrap();
        let dir = entry["directory"].as_str().unwrap();
        fs::create_dir_all(format!("lee/{dir}"))?;
        let title = format!("{:02} · {}", i + 1, name);
        let source_record = &sources[source];
        let mut body = format!(
            "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><link rel=\"stylesheet\" href=\"../../../assets/site.css\"><link rel=\"stylesheet\" href=\"../../lee.css\"><main class=\"wrap document\"><a href=\"../../#set={}\">← Open in the Lee explorer</a><p class=\"eyebrow\">LEE MAIN FORM · MOVEMENTS {}</p><h1>{}</h1><p>Historical image match: unverified. Modern teaching may vary.</p><h2>Position and movement</h2><p>{}</p><p><a href=\"{}\">{}</a> · {}</p><h2>Application study</h2><p>{}</p>",
            escape(&title),
            i + 1,
            escape(entry["rangeLabel"].as_str().unwrap()),
            escape(name),
            escape(annotation["position"].as_str().unwrap()),
            source_record["url"].as_str().unwrap(),
            escape(source_record["title"].as_str().unwrap()),
            escape(entry["position"]["kind"].as_str().unwrap()),
            escape(entry["application"]["text"].as_str().unwrap())
        );
        if let Some(app_source) = annotation["applicationSource"].as_str() {
            body.push_str(&format!(
                "<p><a href=\"{}\">Application source: {}</a></p>",
                sources[app_source]["url"].as_str().unwrap(),
                escape(sources[app_source]["title"].as_str().unwrap())
            ));
        }
        body.push_str(&format!("<h2>Attention</h2><p>Editorial observation prompt: {}</p><h2>Breath and transitions</h2><p><a href=\"../../#principles\">Read the attributed form-wide notes</a>. A numbered range alone does not determine breathing or the mechanics of the joins.</p><p><a href=\"https://www.youtube.com/watch?v={}\">West Yorkshire Tai Chi · this passage on video</a></p>",escape(annotation["attention"].as_str().unwrap()),entry["video"].as_str().unwrap()));
        if let Some(page) = entry["pdfPage"].as_u64() {
            body.push_str(&format!("<p><a href=\"../../sources/gibbon-first-five-sets.pdf#page={page}\">Gibbon photograph page {page} · complete unaltered manual</a></p>"));
        }
        body.push_str("<p><a href=\"../../sequence.html\">Complete sequence index</a> · <a href=\"../../research/README.md\">Provenance and unresolved questions</a></p></main></html>\n");
        fs::write(format!("lee/{dir}/index.html"), body)?;
        index.push_str(&format!(
            "<li><a href=\"{dir}/\">{}</a><span>Movements {}</span></li>",
            escape(name),
            escape(entry["rangeLabel"].as_str().unwrap())
        ));
    }
    index.push_str("</ol></main></html>\n");
    fs::write("lee/sequence.html", index)?;
    let catalogue = json!({"schemaVersion":1,"style":"Chee Soo / Lee main hand form","movementCount":140,"sequenceCount":42,"checked":"2026-10-24","sources":sources,"entries":entries});
    fs::write(
        "lee/catalogue.json",
        serde_json::to_string_pretty(&catalogue)? + "\n",
    )?;
    println!("Built Lee catalogue: 42 sets, 140 movements; shared closing boundary retained.");
    Ok(())
}
