//! The MHR source side: rest skeleton (reference file), one SAM 3D Body output, and the joint map.
use crate::maths::{Q, V3, from_matrix};
use serde_json::Value;
use std::{collections::HashMap, fs};

/// MHR zero-pose skeleton state (zero shape) in its body axes (+Y up, +Z forward, +X left), metres.
pub struct Rest {
    pub pos: Vec<V3>,
    pub rot: Vec<Q>,
    by_name: HashMap<String, usize>,
}

impl Rest {
    pub fn parse(text: &str) -> Rest {
        let v: Value = serde_json::from_str(text).expect("MHR rest skeleton JSON");
        let names: Vec<String> = v["names"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n.as_str().unwrap().to_owned())
            .collect();
        let state = v["rest_state"].as_array().unwrap();
        assert_eq!((names.len(), state.len()), (127, 127), "MHR has 127 joints");
        let f = |s: &Value, i: usize| s[i].as_f64().unwrap();
        let pos = state
            .iter()
            .map(|s| [f(s, 0) / 100.0, f(s, 1) / 100.0, f(s, 2) / 100.0])
            .collect();
        let rot = state
            .iter()
            .map(|s| [f(s, 3), f(s, 4), f(s, 5), f(s, 6)])
            .collect();
        let by_name = names
            .iter()
            .enumerate()
            .map(|(i, n)| (n.clone(), i))
            .collect();
        Rest { pos, rot, by_name }
    }
    pub fn index(&self, name: &str) -> usize {
        *self
            .by_name
            .get(name)
            .unwrap_or_else(|| panic!("MHR has no joint {name}"))
    }
}

/// One joint-map entry: avatar joint, its MHR counterpart, and the bone used for rest alignment.
pub struct MapEntry {
    pub avatar: String,
    pub mhr: Option<String>,
    pub align: Option<(String, String)>,
    /// Frame alignment's across bone: `[avatar right, avatar left, MHR right, MHR left]` (pelvis only).
    pub across: Option<[String; 4]>,
}

/// The joint map (`mhr-to-yang24.json`).
pub struct JointMap {
    pub tag: String,
    pub joints: Vec<MapEntry>,
}

impl JointMap {
    pub fn parse(text: &str) -> JointMap {
        let v: Value = serde_json::from_str(text).expect("joint map JSON");
        let s = |x: &Value| x.as_str().map(str::to_owned);
        let joints = v["joints"]
            .as_array()
            .unwrap()
            .iter()
            .map(|j| MapEntry {
                avatar: s(&j["avatar"]).unwrap(),
                mhr: s(&j["mhr"]),
                align: j["align"]
                    .as_array()
                    .map(|a| (s(&a[0]).unwrap(), s(&a[1]).unwrap())),
                across: j["across"]
                    .as_array()
                    .map(|a| [0, 1, 2, 3].map(|i| s(&a[i]).unwrap())),
            })
            .collect();
        JointMap {
            tag: s(&v["tag"]).unwrap(),
            joints,
        }
    }
    pub fn get(&self, avatar: &str) -> &MapEntry {
        self.joints
            .iter()
            .find(|e| e.avatar == avatar)
            .unwrap_or_else(|| panic!("joint map lacks {avatar}"))
    }
}

/// The fields the converter reads from one SAM 3D Body output file (one person).
pub struct Sam {
    pub id: String,
    /// World rotations in MHR body axes (global_rot applied, camera flip not applied).
    pub global_rots: Vec<Q>,
    /// Joint positions and the 70 MHR70 keypoints, camera frame (+X right, +Y down, +Z into the scene), metres.
    pub joints: Vec<V3>,
    pub keypoints: Vec<V3>,
    pub provenance: Value,
    /// People in the file; the largest bounding box was taken when there is more than one.
    pub n_people: usize,
}

fn vecs(v: &Value) -> Vec<V3> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let p = p.as_array().unwrap();
            [
                p[0].as_f64().unwrap(),
                p[1].as_f64().unwrap(),
                p[2].as_f64().unwrap(),
            ]
        })
        .collect()
}

impl Sam {
    pub fn load(path: &str) -> Sam {
        let v: Value = serde_json::from_slice(&fs::read(path).expect(path)).expect(path);
        let people = v["people"].as_array().expect("people");
        let area = |p: &Value| {
            let b: Vec<f64> = p["bbox"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_f64().unwrap())
                .collect();
            (b[2] - b[0]) * (b[3] - b[1])
        };
        let person = people
            .iter()
            .max_by(|a, b| area(a).total_cmp(&area(b)))
            .unwrap_or_else(|| panic!("{path}: no person detected"));
        let global_rots = person["pred_global_rots"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                let r = vecs(m);
                from_matrix([r[0], r[1], r[2]])
            })
            .collect::<Vec<_>>();
        let sam = Sam {
            id: v["id"].as_str().expect("id").to_owned(),
            global_rots,
            joints: vecs(&person["pred_joint_coords"]),
            keypoints: vecs(&person["pred_keypoints_3d"]),
            provenance: v["provenance"].clone(),
            n_people: people.len(),
        };
        assert_eq!(
            (sam.global_rots.len(), sam.joints.len(), sam.keypoints.len()),
            (127, 127, 70),
            "{path}: unexpected shapes"
        );
        sam
    }
}

/// MHR70 keypoint indices (sam_3d_body/metadata/mhr70.py) of the four landmarks.
pub const KP_LEFT_ANKLE: usize = 13;
pub const KP_RIGHT_ANKLE: usize = 14;
pub const KP_RIGHT_WRIST: usize = 41;
pub const KP_LEFT_WRIST: usize = 62;
#[cfg(test)]
pub const KP_NOSE: usize = 0;
#[cfg(test)]
pub const KP_LEFT_HIP: usize = 9;
#[cfg(test)]
pub const KP_RIGHT_HIP: usize = 10;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{JOINT_MAP, MHR_REST, avatar::load_repo_avatar};

    #[test]
    fn joint_map_covers_the_avatar_with_valid_parents() {
        let (av, map, rest) = (
            load_repo_avatar(),
            JointMap::parse(JOINT_MAP),
            Rest::parse(MHR_REST),
        );
        assert_eq!(map.tag, "mhr-to-yang24@1");
        let names: Vec<&str> = map.joints.iter().map(|e| e.avatar.as_str()).collect();
        assert_eq!(
            names,
            av.names.iter().map(String::as_str).collect::<Vec<_>>(),
            "all 24 avatar joints, skin order"
        );
        let mapped: Vec<&MapEntry> = map.joints.iter().filter(|e| e.mhr.is_some()).collect();
        // 22 mapped (pelvis via root + 21 joints in the file); the two hands stay at rest. Of the 23 POSE_JOINTS, 21 are written.
        assert_eq!(mapped.len(), 22);
        let mut seen = std::collections::HashSet::new();
        for e in &map.joints {
            let j = av.index(&e.avatar);
            let parent = av.parent[j].map(|p| av.names[p].as_str());
            match &e.mhr {
                Some(m) => {
                    rest.index(m);
                    assert!(seen.insert(m.clone()), "{m} mapped twice");
                    assert_eq!(
                        e.avatar.starts_with("left_"),
                        m.starts_with("l_"),
                        "{} <- {m}: side",
                        e.avatar
                    );
                    assert_eq!(
                        e.avatar.starts_with("right_"),
                        m.starts_with("r_"),
                        "{} <- {m}: side",
                        e.avatar
                    );
                    // The nearest avatar ancestor is the direct parent, and it is mapped: no chain sharing needed.
                    if let Some(p) = parent {
                        assert!(
                            map.get(p).mhr.is_some(),
                            "{} has an unmapped parent",
                            e.avatar
                        );
                    }
                }
                None => assert!(
                    !av.parent.contains(&Some(j)),
                    "unmapped {} must be a leaf",
                    e.avatar
                ),
            }
            if let Some((child, mhr_child)) = &e.align {
                assert_eq!(
                    av.parent[av.index(child)],
                    Some(j),
                    "{child} is not a child of {}",
                    e.avatar
                );
                rest.index(mhr_child);
                // The MHR child is the child's mapped joint, except where the map names another point on the
                // bone: the true ankle (l_foot) above the remapped ankle (l_subtalar), and the hand proxies.
                let expected = map
                    .get(child)
                    .mhr
                    .as_deref()
                    .map(|m| m.replace("subtalar", "foot"));
                assert!(
                    expected.is_none_or(|m| &m == mhr_child),
                    "{}: align bone strays from the map",
                    e.avatar
                );
            }
        }
        assert_eq!(map.get("pelvis").mhr.as_deref(), Some("root"));
        assert!(map.get("left_hand").mhr.is_none() && map.get("right_hand").mhr.is_none());
    }

    #[test]
    fn rest_skeleton_is_in_avatar_axes() {
        let rest = Rest::parse(MHR_REST);
        let at = |n: &str| rest.pos[rest.index(n)];
        assert!(
            (at("root")[1] - 0.924).abs() < 1e-3,
            "+Y up, pelvis at 0.924 m"
        );
        assert!(
            at("l_upleg")[0] > 0.0 && at("r_upleg")[0] < 0.0,
            "+X is the body's left"
        );
        assert!(at("l_ball")[2] > at("l_foot")[2], "+Z forward");
    }
}
