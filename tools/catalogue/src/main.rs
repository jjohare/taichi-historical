//! Rebuild the image catalogue from the reviewed source tables.
//! Run from the repository root with `cargo run --manifest-path tools/catalogue/Cargo.toml`.
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    process::Command,
};

const YANG: &str = "https://brennantranslation.wordpress.com/2011/11/24/methods-of-applying-taiji-boxing-taiji-quan-shiyong-fa/";
const CHEN: &str =
    "https://brennantranslation.wordpress.com/2020/06/05/chen-weimings-additional-taiji-photos/";
const MONTAGE: &str = "https://commons.wikimedia.org/wiki/File:Yang_Chengfu_Form.jpg";
const BREATH: &str = "Breathing and attention are editorial practice suggestions, not recovered instructions for this particular photograph. Allow an easy, unforced breath; do not impose a fixed inhalation or exhalation on each numbered movement.";

fn rows(path: &str) -> Vec<Vec<String>> {
    fs::read_to_string(path)
        .expect(path)
        .lines()
        .skip(1)
        .map(|l| l.split('\t').map(str::to_owned).collect())
        .collect()
}
fn ids(s: &str) -> Vec<usize> {
    if s == "-" {
        vec![]
    } else {
        s.split(',')
            .map(|s| s.parse().expect("photo number"))
            .collect()
    }
}
fn magick(args: &[&str]) {
    assert!(
        Command::new("magick")
            .args(args)
            .status()
            .expect("ImageMagick installed")
            .success(),
        "Image conversion failed: {args:?}"
    );
}
fn main() {
    let names: Vec<(usize, String)> = fs::read_to_string("moves.md")
        .unwrap()
        .lines()
        .filter_map(|l| {
            l.split_once(". ")
                .map(|(n, s)| (n.parse().unwrap(), s.to_owned()))
        })
        .collect();
    let mapping = rows("research/move-map.tsv");
    let notes: BTreeMap<_, _> = rows("research/position-notes.tsv")
        .into_iter()
        .map(|r| (r[0].clone(), r))
        .collect();
    assert_eq!(names.len(), 103);
    assert_eq!(mapping.len(), names.len());
    fs::create_dir_all("assets").unwrap();
    fs::create_dir_all("extracted/historical").unwrap();
    let bounds = fs::read_to_string("research/panel-bounds.txt").unwrap();
    assert_eq!(bounds.lines().count(), 104);
    for (i, line) in bounds.lines().enumerate() {
        let bbox = line.split_whitespace().nth(2).unwrap();
        let output = format!("extracted/panel-{:03}.png", i + 1);
        if !Path::new(&output).exists() {
            magick(&[
                "Yang_Chengfu_Form.jpg",
                "-colorspace",
                "sRGB",
                "-crop",
                bbox,
                "+repage",
                &output,
            ]);
        }
    }
    let mut photos = BTreeMap::new();
    let mut conversions = vec![];
    for (source, table, page) in [
        ("yang", "research/yang-1931.tsv", YANG),
        ("chen", "research/chen-1933.tsv", CHEN),
    ] {
        for row in rows(table) {
            let n: usize = row[0].parse().unwrap();
            let url = row.last().unwrap();
            let input = if source == "yang" {
                format!("sources/yang-1931/{}", url.rsplit('/').next().unwrap())
            } else {
                format!("sources/chen-1933/photo-{n}.jpg")
            };
            assert!(Path::new(&input).exists(), "Missing {input}");
            let output = format!("extracted/historical/{source}-{n:03}.png");
            if !Path::new(&output).exists() {
                conversions.push((input, output.clone()));
            }
            photos.insert((source,n),json!({"path":output,"url":url,"page":page,"section":if source=="yang" {Some(row[1].clone())} else {None}}));
        }
    }
    // ImageMagick handles all raster conversion. Bounded workers avoid excessive processes.
    std::thread::scope(|scope| {
        for chunk in conversions.chunks(conversions.len().div_ceil(4).max(1)) {
            scope.spawn(move || {
                for (input, output) in chunk {
                    magick(&[input, "-colorspace", "sRGB", output]);
                }
            });
        }
    });
    let mut catalogue = vec![];
    let mut used_panels = BTreeSet::new();
    for (i, ((id, name), map)) in names.iter().zip(&mapping).enumerate() {
        assert_eq!(*id, map[0].parse::<usize>().unwrap());
        assert_eq!(map.len(), 7);
        let family = &map[1];
        let n = notes.get(family).expect("Every family has notes");
        assert_eq!(n.len(), 6);
        let slug = name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        let dir = format!("poses/{id:03}-{slug}");
        fs::create_dir_all(&dir).unwrap();
        let mut images = vec![];
        for panel in ids(&map[2]) {
            used_panels.insert(panel);
            let file = format!("montage-{panel:03}.png");
            fs::copy(
                format!("extracted/panel-{panel:03}.png"),
                format!("{dir}/{file}"),
            )
            .unwrap();
            images.push(json!({"src":format!("{dir}/{file}"),"file":file,"source":"montage","number":panel,"label":format!("Matthias Wagner · drawing {panel} · 2010"),"url":MONTAGE,"original":"Yang_Chengfu_Form.jpg"}));
        }
        for (source, column, date) in [
            ("yang", 3, "published 1931"),
            ("chen", 4, "taken 1932 · published 1933"),
        ] {
            for number in ids(&map[column]) {
                let photo = photos.get(&(source, number)).expect("Mapped photo exists");
                let file = format!("{source}-{number:03}.png");
                fs::copy(photo["path"].as_str().unwrap(), format!("{dir}/{file}")).unwrap();
                images.push(json!({"src":format!("{dir}/{file}"),"file":file,"source":source,"number":number,"label":format!("{} · photo {number} · {date}",if source=="yang"{"Yang Chengfu"}else{"Chen Weiming"}),"url":photo["page"],"original":photo["url"],"section":photo["section"]}));
            }
        }
        assert!(!images.is_empty());
        let previous = i
            .checked_sub(1)
            .map(|j| json!({"id":names[j].0,"name":names[j].1}));
        let next = names
            .get(i + 1)
            .map(|(id, name)| json!({"id":id,"name":name}));
        let item = json!({"id":id,"ordinal":i+1,"name":name,"family":family,"section":if *id<=15 {1}else if *id<=53 {2}else{3},"directory":dir,"status":map[5],"mappingNote":map[6],"position":n[1],"transition":n[2],"application":n[3],"attention":n[4],"nameContext":n[5],"breathing":BREATH,"previous":previous,"next":next,"images":images});
        let mut md = format!(
            "# {id}. {name}\n\nHistorical image study. Modern teaching may differ as the art evolves. Names and numbers are preserved from [moves.md](../../moves.md); notes are editorial observations and interpretations, not a reconstruction of every historical instruction.\n\n## Identification\n\n**{}** — {}\n\n## Position\n\n{}\n\n## Transition\n\n{}\n\nPreceded by: {}. Followed by: {}.\n\n## Application study — interpretation\n\n{}\n\n## Breathing and attention — editorial suggestions\n\n{}\n\n{}\n\n## Name and context\n\n{}\n\n## Images and sources\n\n",
            map[5],
            map[6],
            n[1],
            n[2],
            previous
                .as_ref()
                .map_or("Start of form", |x| x["name"].as_str().unwrap()),
            next.as_ref()
                .map_or("End of form", |x| x["name"].as_str().unwrap()),
            n[3],
            BREATH,
            n[4],
            n[5]
        );
        for im in &images {
            md.push_str(&format!(
                "- [{}]({}) · [source page]({}) · [original image]({})\n",
                im["label"].as_str().unwrap(),
                im["file"].as_str().unwrap(),
                im["url"].as_str().unwrap(),
                if im["source"] == "montage" {
                    "../../Yang_Chengfu_Form.jpg"
                } else {
                    im["original"].as_str().unwrap()
                }
            ));
        }
        md.push_str("\nDrawings: Matthias Wagner, 2010, CC BY 3.0; cropped and converted to sRGB PNG without changing proportions. Historical photographs are scans of the cited manuals via Paul Brennan; no licence is asserted for the modern translations, which are not reproduced. See [research and provenance](../../research/README.md) for numbering, source differences and teaching context.\n");
        fs::write(format!("{dir}/README.md"), md).unwrap();
        catalogue.push(item);
    }
    assert_eq!(used_panels, (1..=104).collect());
    fs::write(
        "assets/catalogue.json",
        serde_json::to_string_pretty(&Value::Array(catalogue)).unwrap() + "\n",
    )
    .unwrap();
    println!(
        "Verified 103 entries, 104 accounted-for montage panels, {} historical photo records.",
        photos.len()
    );
}
