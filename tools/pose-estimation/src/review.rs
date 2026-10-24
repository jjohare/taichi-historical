//! The first-pass review table: `| id | dinov3 | vith | preferred | note |`, one row per photograph.
use std::{collections::BTreeMap, fs};

/// Review row for one photograph.
pub struct Row {
    pub dinov3: String,
    pub vith: String,
    pub preferred: String,
    pub note: String,
}

impl Row {
    /// The batch to convert: vith only where the reviewer preferred it, otherwise dinov3 (ties and `?` included).
    pub fn use_vith(&self) -> bool {
        self.preferred == "vith"
    }
    /// The grade of the chosen checkpoint, e.g. `A`, `A?`, `B`, `C`, `?`.
    pub fn grade(&self) -> &str {
        if self.use_vith() {
            &self.vith
        } else {
            &self.dinov3
        }
    }
}

/// What a grade means for publication: `Some(overall confidence)` if publishable, `None` for a draft.
/// A bare `?` (ungradeable) or any C is a draft. A trailing `?` marks a tentative grade: it publishes unless
/// `tentative_is_draft` (the `--tentative-draft` switch) is set.
pub fn grade_confidence(grade: &str, tentative_is_draft: bool) -> Option<f64> {
    if tentative_is_draft && grade.ends_with('?') {
        return None;
    }
    match grade.trim_end_matches('?') {
        "A" => Some(0.9),
        "B" => Some(0.7),
        "C" | "" => None,
        g => panic!("unknown review grade {g:?}"),
    }
}

pub fn load(path: &str) -> BTreeMap<String, Row> {
    let text = fs::read_to_string(path).expect(path);
    let rows: BTreeMap<String, Row> = text
        .lines()
        .filter_map(|l| {
            let c: Vec<&str> = l
                .trim()
                .strip_prefix('|')?
                .strip_suffix('|')?
                .split('|')
                .map(str::trim)
                .collect();
            let id = *c.first()?;
            let ok = c.len() == 5
                && id.len() == 8
                && (id.starts_with("yang-") || id.starts_with("chen-"))
                && id[5..].bytes().all(|b| b.is_ascii_digit());
            ok.then(|| {
                let row = Row {
                    dinov3: c[1].into(),
                    vith: c[2].into(),
                    preferred: c[3].into(),
                    note: c[4].into(),
                };
                assert!(
                    ["dinov3", "vith", "=", "?"].contains(&row.preferred.as_str()),
                    "{id}: preferred {:?}",
                    row.preferred
                );
                (id.to_owned(), row)
            })
        })
        .collect();
    assert_eq!(rows.len(), 240, "{path}: expected 240 review rows");
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grades() {
        assert_eq!(grade_confidence("A", false), Some(0.9));
        assert_eq!(grade_confidence("A?", false), Some(0.9));
        assert_eq!(grade_confidence("A?", true), None);
        assert_eq!(grade_confidence("B?", false), Some(0.7));
        assert_eq!(grade_confidence("C", false), None);
        assert_eq!(grade_confidence("?", false), None);
        let row = Row {
            dinov3: "B?".into(),
            vith: "A".into(),
            preferred: "vith".into(),
            note: String::new(),
        };
        assert_eq!(row.grade(), "A");
    }
}
