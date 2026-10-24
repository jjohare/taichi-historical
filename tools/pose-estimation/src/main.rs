//! Convert SAM 3D Body output (MHR skeleton) into `yang-form/pose-estimate` schema v1 files (design §8.3).
//! Run from anywhere:
//! `cargo run --manifest-path tools/pose-estimation/Cargo.toml -- --batch <dir> [--batch-alt <dir>] --review <table.md>
//! --out <dir> --reviewer <name> --date <YYYY-MM-DD> [--only yang-001,yang-043] [--bones] [--tentative-draft]
//! [--publish]`.
//!
//! Published (accepted) files and `index.json` go to `--out`, or to `assets/pose-estimates/` with `--publish`;
//! drafts (grade `?` or C, or any tentative grade under `--tentative-draft`) always go to `<out>/draft/`.
//!
//! # Frames
//!
//! SAM 3D Body reports two frames. `pred_joint_coords` and `pred_keypoints_3d` are in the camera frame
//! (+X image right, +Y down, +Z into the scene); a figure facing the camera has its left at +X and faces −Z.
//! `pred_global_rots` are world rotations in MHR's body axes (+Y up, +Z forward, +X left; `global_rot` applied,
//! the camera flip not): rest-skeleton offsets rotated by them reproduce `diag(1,−1,−1) · pred_joint_coords`
//! with cosine 1.00000. The MHR body axes *are* the avatar axes, so:
//!
//! * positions: `C = diag(1, −1, −1)`, a 180° rotation about X (det +1, handedness kept);
//! * rotations: `C = I`, i.e. design §5.3's `D_avatar = C · D_source · C⁻¹` with the rotations' own frame as source.
//!
//! # Retarget (design §5.3, with rest alignment)
//!
//! For mapped joint `j` with MHR counterpart `m`, the world delta from rest is `D_j = G_posed,m · G_rest,m⁻¹`,
//! `G_rest` being the zero-pose skeleton state (`reference/mhr-rest-skeleton.json`).
//!
//! MHR rests in a relaxed A-pose and the avatar in a different one, so `D_j` applied to the avatar's rest bone
//! would mis-aim it. Let `b_a` be the avatar's rest direction of the bone `j → child` (from the GLB) and `b_m`
//! MHR's rest direction of the corresponding bone (both in avatar axes). The aim is: the avatar bone's posed
//! world direction equals MHR's, `D'_j · b_a = D_j · b_m`, with the twist about the bone taken from `D_j`.
//! Take `A_j` = the shortest-arc rotation with `A_j · b_m = b_a` and set `D'_j = D_j · A_j⁻¹`. Then
//! `D'_j · b_a = D_j · A_j⁻¹ · b_a = D_j · b_m`. `A_j` has no component about the bone, so the bone's twist
//! relative to its rest is exactly `D_j`'s, carried across by the minimal swing. Joints without an `align` bone in
//! the map (pelvis, head, feet) use `A = I`: their world delta is applied unchanged.
//!
//! The avatar's posed world orientation must be `G_j = D'_j · W_r,j`. Writing `Q_j = D'_p⁻¹ · D'_j`, `p` being
//! the nearest mapped avatar ancestor (the pelvis takes `Q = D'_pelvis`), and substituting into
//! `L_j = L_r,j · (W_r,j⁻¹ · Q_j · W_r,j)` and `G_j = G_p · L_j` gives `G_j = D'_j · W_r,j` by induction. The
//! avatar's posed bone direction is then `G_j · W_r,j⁻¹ · b_a = D'_j · b_a = D_j · b_m`, MHR's posed direction.
//! The `--bones` report checks this numerically against `pred_joint_coords`.
//!
//! # Joint map `mhr-to-yang24@1` (`mhr-to-yang24.json`)
//!
//! 22 of the 24 avatar joints are mapped. `c_spine0` sits at pelvis level and folds into the pelvis (pelvis
//! `D` = root's `D`). The hands have no reviewed MHR counterpart and stay at rest relative to the wrists; the wrist
//! bone is aimed with the middle-finger base as its proxy child. Every unmapped joint is a leaf, so §5.3's even
//! share of a chain delta is never needed by this map. The file carries the pelvis in `root.rotation` and the other
//! 21 mapped joints in `joints`.
//!
//! # Root translation and landmarks
//!
//! SAM pins MHR's root at its template height (`(0, −0.924, 0)` m in every image), so the source pelvis measures
//! nothing. `root.translation` is `(0, t, 0)`, with `t` keeping the lowest avatar ankle or foot joint at its rest
//! height after the pose (a crouch lowers the pelvis), clamped to ±1. Landmarks are the MHR70 keypoints (left wrist
//! 62, right wrist 41, left ankle 13, right ankle 14) taken relative to the MHR root, transformed only by `C` and
//! the scale `s = 0.73 m / |head − pelvis|`, and placed at the posed avatar pelvis, which is the frame
//! `checkLeftRight` compares them in. They never pass through the joint map.
mod avatar;
mod convert;
mod maths;
mod mhr;
mod review;

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path, process::Command};

/// Repository root (this crate lives at `tools/pose-estimation`).
pub const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
pub const JOINT_MAP: &str = include_str!("../mhr-to-yang24.json");
pub const MHR_REST: &str = include_str!("../reference/mhr-rest-skeleton.json");

/// MHR revision and model file the rest skeleton was derived from (`reference/mhr-rest-skeleton.json`).
const MHR_REVISION: &str = "877cba5ee61a5f77d1457bf4de93a66695132bd9";
const MHR_MODEL_SHA256: &str = "352e271a6c42729c68554ceaea0c955e866970160c31e35506d782dc0f7377bc";
const OUTPUT_FRAME: &str = "keypoints/joints: camera frame, +X image right, +Y down, +Z into scene, m; C = diag(1,-1,-1). \
pred_global_rots: MHR body axes (+Y up, +Z forward, +X left); C = I";
const CONFIDENCE_METHOD: &str = "overall = first-pass reviewer grade of the chosen checkpoint (A or A? 0.9, B or B? 0.7, \
draft 0); per-joint fixed at 1.0: SAM 3D Body reports no per-joint score";

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn round(x: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    let r = (x * f).round() / f;
    if r == 0.0 { 0.0 } else { r }
}
fn nums(v: &[f64], places: i32) -> Value {
    json!(v.iter().map(|&x| round(x, places)).collect::<Vec<_>>())
}
fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn git(args: &[&str]) -> String {
    let out = Command::new("git")
        .args(args)
        .current_dir(REPO)
        .output()
        .expect("git");
    assert!(out.status.success(), "git {args:?} failed");
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}
/// Width and height from a PNG's IHDR chunk.
fn png_size(bytes: &[u8]) -> (u64, u64) {
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
    let be = |r: std::ops::Range<usize>| u32::from_be_bytes(bytes[r].try_into().unwrap()) as u64;
    (be(16..20), be(20..24))
}

struct Args {
    batch: String,
    batch_alt: Option<String>,
    review: String,
    out: String,
    reviewer: String,
    date: String,
    only: Option<Vec<String>>,
    publish: bool,
    bones: bool,
    tentative_draft: bool,
}

fn args() -> Args {
    let mut it = std::env::args().skip(1);
    let (mut batch, mut batch_alt, mut review, mut out, mut only) = (None, None, None, None, None);
    let (mut reviewer, mut date) = (None, None);
    let (mut publish, mut bones, mut tentative_draft) = (false, false, false);
    while let Some(a) = it.next() {
        let mut val = || it.next().unwrap_or_else(|| panic!("{a} needs a value"));
        match a.as_str() {
            "--batch" => batch = Some(val()),
            "--batch-alt" => batch_alt = Some(val()),
            "--review" => review = Some(val()),
            "--out" => out = Some(val()),
            "--reviewer" => reviewer = Some(val()),
            "--date" => date = Some(val()),
            "--only" => only = Some(val().split(',').map(str::to_owned).collect()),
            "--publish" => publish = true,
            "--bones" => bones = true,
            "--tentative-draft" => tentative_draft = true,
            _ => panic!("unknown argument {a}"),
        }
    }
    Args {
        batch: batch.expect("--batch <dir> is required"),
        batch_alt,
        review: review.expect("--review <table.md> is required"),
        out: out.expect("--out <dir> is required"),
        reviewer: reviewer.expect("--reviewer <name> is required (who reviewed the table)"),
        date: date.expect("--date <YYYY-MM-DD> is required (when the table was reviewed)"),
        only,
        publish,
        bones,
        tentative_draft,
    }
}

/// Everything about one photograph that is not computed from the pose.
struct Context<'a> {
    row: &'a review::Row,
    accepted: bool,
    overall: f64,
    revision: &'a str,
    reviewer: &'a str,
    date: &'a str,
}

fn pose_file(
    sam: &mhr::Sam,
    av: &avatar::Avatar,
    map: &mhr::JointMap,
    pose: &convert::Pose,
    cx: &Context,
) -> Value {
    let p = &sam.provenance;
    let text = |k: &str| {
        p[k].as_str()
            .unwrap_or_else(|| panic!("{}: provenance.{k} missing", sam.id))
    };
    let id = sam.id.as_str();

    let image_rel = format!("extracted/historical/{id}.png");
    let image = fs::read(format!("{REPO}/{image_rel}")).expect(&image_rel);
    let image_sha = sha256_hex(&image);
    assert_eq!(
        image_sha,
        text("source_image_sha256"),
        "{id}: SAM ran on different image bytes"
    );
    let hw = &p["image_size_hw"];
    let (h, w) = (hw[0].as_u64().unwrap(), hw[1].as_u64().unwrap());
    assert_eq!(
        png_size(&image),
        (w, h),
        "{id}: image_size_hw disagrees with the PNG"
    );
    assert_eq!(
        text("bbox_used"),
        "none (whole image)",
        "{id}: only whole-image runs are supported"
    );

    let checkpoint_sha = text("checkpoint_sha256");
    assert!(
        is_hex(checkpoint_sha, 64),
        "{id}: checkpoint_sha256 is not 64 hex (truncated?): {checkpoint_sha}"
    );
    let ckpt_dir = Path::new(text("checkpoint_path"))
        .parent()
        .and_then(Path::file_name)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(
        ckpt_dir.starts_with("sam-3d-body-"),
        "{id}: unexpected checkpoint path"
    );
    let estimator_rev = text("sam_3d_body_git_commit");
    assert!(is_hex(estimator_rev, 40), "{id}: estimator revision");
    assert_eq!(
        text("mhr_model_sha256"),
        MHR_MODEL_SHA256,
        "{id}: MHR model differs from the reference skeleton's"
    );

    let mut joints = Map::new();
    for (j, name) in av.names.iter().enumerate().skip(1) {
        if pose.mapped[j] {
            joints.insert(
                name.clone(),
                json!({"rotation": nums(&pose.deltas[j], 6), "confidence": 1.0}),
            );
        }
    }
    let [lw, rw, la, ra] = pose.landmarks;
    let mut review = json!({
        "status": if cx.accepted { "accepted" } else { "draft" },
        "reviewer": cx.reviewer,
        "date": cx.date,
        "leftRight": "as-photographed",
        "checks": {"projection": cx.accepted, "leftRight": cx.accepted, "standingLeg": cx.accepted,
                   "handsFeet": cx.accepted, "truncation": cx.accepted},
    });
    if !cx.row.note.is_empty() {
        review["notes"] = json!(cx.row.note);
    }
    json!({
        "schema": "yang-form/pose-estimate",
        "schemaVersion": 1,
        "imageId": id,
        "sourceImage": {"path": image_rel, "sha256": image_sha, "crop": [0, 0, w, h], "personPrompt": "none", "mirrored": false},
        "estimator": {
            "name": "SAM 3D Body",
            "repository": "https://github.com/facebookresearch/sam-3d-body",
            "revision": estimator_rev,
            "checkpoint": format!("facebook/{ckpt_dir}"),
            "checkpointSha256": checkpoint_sha,
            "licence": "SAM License",
            "outputFrame": OUTPUT_FRAME,
        },
        "rig": {"name": "MHR", "repository": "https://github.com/facebookresearch/MHR", "revision": MHR_REVISION, "modelSha256": MHR_MODEL_SHA256},
        "converter": {"path": "tools/pose-estimation/src/main.rs", "revision": cx.revision},
        "jointConvention": "yang-form-24/rest-world-delta@1",
        "jointMap": map.tag,
        "frame": {"up": "+Y", "forward": "+Z", "left": "+X", "units": "m"},
        "root": {"translation": nums(&pose.translation, 4), "rotation": nums(&pose.deltas[0], 6)},
        "joints": joints,
        "landmarks": {"left_wrist": nums(&lw, 4), "right_wrist": nums(&rw, 4), "left_ankle": nums(&la, 4), "right_ankle": nums(&ra, 4)},
        "confidence": {"overall": cx.overall, "method": CONFIDENCE_METHOD},
        "review": review,
    })
}

/// `index.json` listing every `<imageId>.json` in `dir`, hashed over the exact file bytes.
fn write_index(dir: &str) {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect(dir)
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|n| {
            n.len() == 13
                && n.ends_with(".json")
                && (n.starts_with("yang-") || n.starts_with("chen-"))
        })
        .collect();
    names.sort();
    let estimates: Vec<Value> = names
        .iter()
        .map(|n| json!({"imageId": &n[..8], "file": n, "sha256": sha256_hex(&fs::read(format!("{dir}/{n}")).unwrap())}))
        .collect();
    let index = json!({"schema": "yang-form/pose-estimate-index", "schemaVersion": 1, "estimates": estimates});
    fs::write(
        format!("{dir}/index.json"),
        serde_json::to_string_pretty(&index).unwrap() + "\n",
    )
    .unwrap();
}

fn main() {
    let a = args();
    let (rest, map) = (mhr::Rest::parse(MHR_REST), mhr::JointMap::parse(JOINT_MAP));
    let av = avatar::Avatar::load(&format!("{REPO}/assets/model/archive-avatar.glb"));
    let rows = review::load(&a.review);
    let d = a.date.as_bytes();
    assert!(
        d.len() == 10
            && d[4] == b'-'
            && d[7] == b'-'
            && a.date.replace('-', "").bytes().all(|b| b.is_ascii_digit()),
        "--date must be YYYY-MM-DD"
    );
    let revision = git(&["rev-parse", "HEAD"]);
    if !git(&["status", "--porcelain", "--", "tools/pose-estimation"]).is_empty() {
        eprintln!(
            "warning: tools/pose-estimation has uncommitted changes; converter.revision {revision} does not describe them"
        );
    }
    let published_dir = if a.publish {
        format!("{REPO}/assets/pose-estimates")
    } else {
        a.out.clone()
    };
    let draft_dir = format!("{}/draft", a.out);
    fs::create_dir_all(&published_dir).unwrap();
    fs::create_dir_all(&draft_dir).unwrap();

    let ids: Vec<&String> = rows
        .keys()
        .filter(|id| a.only.as_ref().is_none_or(|o| o.contains(id)))
        .collect();
    if let Some(o) = &a.only {
        assert_eq!(
            ids.len(),
            o.len(),
            "--only names an id missing from the review table"
        );
    }
    let (mut published, mut drafts, mut tentative) = (vec![], vec![], 0);
    let mut ty = vec![];
    // Per bone: (worst error, id) and (worst template witness, id).
    type Worst = ((f64, String), (f64, String));
    let mut worst: BTreeMap<String, Worst> = BTreeMap::new();
    println!("id        model   grade status    t_y      scale");
    for id in ids {
        let row = &rows[id];
        let dir = if row.use_vith() {
            a.batch_alt
                .as_deref()
                .expect("vith preferred: pass --batch-alt")
        } else {
            &a.batch
        };
        let sam = mhr::Sam::load(&format!("{dir}/{id}.json"));
        assert_eq!(&sam.id, id);
        if sam.n_people != 1 {
            eprintln!(
                "warning: {id}: {} people detected; converted the largest box",
                sam.n_people
            );
        }
        let grade = row.grade();
        let accepted = review::grade_confidence(grade, a.tentative_draft).is_some();
        let cx = Context {
            row,
            accepted,
            overall: review::grade_confidence(grade, false).unwrap_or(0.0),
            revision: &revision,
            reviewer: &a.reviewer,
            date: &a.date,
        };
        let pose = convert::convert(&sam, &rest, &av, &map);
        let file = pose_file(&sam, &av, &map, &pose, &cx);
        let text = serde_json::to_string_pretty(&file).unwrap() + "\n";
        assert!(text.len() <= 65536, "{id}: file exceeds 64 KiB");
        fs::write(
            format!(
                "{}/{id}.json",
                if accepted { &published_dir } else { &draft_dir }
            ),
            &text,
        )
        .unwrap();
        let model = if row.use_vith() { "vith" } else { "dinov3" };
        println!(
            "{id}  {model:<7} {grade:<5} {:<9} {:+.4}  {:.3}",
            if accepted { "accepted" } else { "draft" },
            pose.translation[1],
            pose.scale
        );
        if accepted {
            published.push(id.clone());
            tentative += grade.ends_with('?') as usize;
        } else {
            drafts.push(id.clone());
        }
        ty.push(pose.translation[1]);
        let errors = convert::bone_errors(&sam, &rest, &av, &map, &pose);
        if a.bones {
            println!(
                "  {:<28} {:<26} {:>8} {:>10}  aligned",
                "avatar bone", "MHR bone", "error°", "template°"
            );
            for e in &errors {
                println!(
                    "  {:<28} {:<26} {:>8.3} {:>10.3}  {}",
                    e.avatar,
                    e.mhr,
                    e.degrees,
                    e.template_degrees,
                    if e.aligned { "yes" } else { "no" }
                );
            }
        }
        for e in errors {
            let w = worst.entry(e.avatar).or_default();
            if e.degrees >= w.0.0 {
                w.0 = (e.degrees, id.clone());
            }
            if e.template_degrees >= w.1.0 {
                w.1 = (e.template_degrees, id.clone());
            }
        }
    }
    write_index(&published_dir);

    let n = ty.len() as f64;
    let mean = ty.iter().sum::<f64>() / n;
    let (lo, hi) = ty
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), &t| {
            (l.min(t), h.max(t))
        });
    let mut sorted = ty.clone();
    sorted.sort_by(f64::total_cmp);
    println!(
        "\nroot.translation y over {} files: min {lo:+.4} median {:+.4} mean {mean:+.4} max {hi:+.4} (x = z = 0)",
        ty.len(),
        sorted[ty.len() / 2]
    );
    println!("worst per bone across the run: error° (id), template witness° (id)");
    for (bone, ((deg, id), (tdeg, tid))) in &worst {
        println!("  {bone:<28} {deg:>8.3}  ({id})  {tdeg:>8.3}  ({tid})");
    }
    let undecided: Vec<&String> = rows
        .iter()
        .filter(|(_, r)| r.preferred == "?")
        .map(|(id, _)| id)
        .collect();
    println!("preferred '?' (dinov3 used): {undecided:?}");
    println!(
        "published {} ({} with a tentative grade) -> {published_dir}; draft {} -> {draft_dir}: {}",
        published.len(),
        tentative,
        drafts.len(),
        drafts.join(", ")
    );
}

#[cfg(test)]
mod tests {
    #[test]
    fn sha256_known_vectors() {
        // FIPS 180-2 / NIST test vectors.
        assert_eq!(
            super::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            super::sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
