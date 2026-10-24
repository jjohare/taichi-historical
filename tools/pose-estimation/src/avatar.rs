//! Avatar rest data read straight from the GLB's JSON chunk, and forward kinematics under design §5.3.
use crate::maths::{IDENTITY, Q, V3, add, conj, mul, normalise, rotate};
use serde_json::Value;
use std::{collections::HashMap, fs};

/// Rest skeleton of the avatar's single skin, in skin order (parents before children).
pub struct Avatar {
    pub names: Vec<String>,
    /// Parent joint index within the skin; `None` for the pelvis.
    pub parent: Vec<Option<usize>>,
    /// Rest local quaternion `L_r` and local translation.
    pub local: Vec<Q>,
    pub offset: Vec<V3>,
    /// Rest world quaternion `W_r`.
    pub world: Vec<Q>,
    /// World transform of the pelvis's (non-joint) parent node: the scene root.
    base: (Q, V3),
}

impl Avatar {
    pub fn load(path: &str) -> Avatar {
        let glb = fs::read(path).expect(path);
        assert_eq!(&glb[0..4], b"glTF", "{path}: not a GLB");
        let len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        assert_eq!(&glb[16..20], b"JSON", "{path}: first chunk is not JSON");
        let json: Value = serde_json::from_slice(&glb[20..20 + len]).expect("GLB JSON chunk");
        Avatar::from_gltf(&json)
    }

    fn from_gltf(json: &Value) -> Avatar {
        let nodes = json["nodes"].as_array().expect("nodes");
        let mut node_parent = HashMap::new();
        for (i, n) in nodes.iter().enumerate() {
            for c in n["children"].as_array().into_iter().flatten() {
                node_parent.insert(c.as_u64().unwrap() as usize, i);
            }
        }
        let nums = |v: &Value, default: &[f64]| -> Vec<f64> {
            v.as_array().map_or(default.to_vec(), |a| {
                a.iter().map(|x| x.as_f64().unwrap()).collect()
            })
        };
        let trs = |i: usize| -> (Q, V3) {
            let n = &nodes[i];
            // Exported scales are unit to float precision (1.0000002); anything else would need scaled FK.
            let unit_scale = nums(&n["scale"], &[1.0; 3])
                .iter()
                .all(|s| (s - 1.0).abs() < 1e-5);
            assert!(
                n.get("matrix").is_none() && unit_scale,
                "node {i}: only rotation/translation supported"
            );
            let r = nums(&n["rotation"], &IDENTITY);
            let t = nums(&n["translation"], &[0.0; 3]);
            // float32 quaternions are unit only to ~1e-7; renormalise so conj() is the inverse.
            (normalise([r[0], r[1], r[2], r[3]]), [t[0], t[1], t[2]])
        };
        let skin: Vec<usize> = json["skins"][0]["joints"]
            .as_array()
            .expect("one skin")
            .iter()
            .map(|j| j.as_u64().unwrap() as usize)
            .collect();
        let slot: HashMap<usize, usize> = skin.iter().enumerate().map(|(s, &n)| (n, s)).collect();
        let mut av = Avatar {
            names: vec![],
            parent: vec![],
            local: vec![],
            offset: vec![],
            world: vec![],
            base: (IDENTITY, [0.0; 3]),
        };
        for (s, &n) in skin.iter().enumerate() {
            let (r, t) = trs(n);
            let p = node_parent.get(&n).and_then(|p| slot.get(p).copied());
            if let Some(p) = p {
                assert!(p < s, "skin order must list parents first");
                av.world.push(mul(av.world[p], r));
            } else {
                assert!(s == 0, "exactly one root joint");
                // Fold every non-joint ancestor (the scene root) into a base transform.
                let (mut q, mut pos, mut up) = (IDENTITY, [0.0; 3], node_parent.get(&n).copied());
                while let Some(a) = up {
                    let (ar, at) = trs(a);
                    pos = add(at, rotate(ar, pos));
                    q = mul(ar, q);
                    up = node_parent.get(&a).copied();
                }
                av.base = (q, pos);
                av.world.push(mul(q, r));
            }
            av.names
                .push(nodes[n]["name"].as_str().expect("joint name").to_owned());
            av.parent.push(p);
            av.local.push(r);
            av.offset.push(t);
        }
        av
    }

    pub fn index(&self, name: &str) -> usize {
        self.names
            .iter()
            .position(|n| n == name)
            .unwrap_or_else(|| panic!("avatar has no joint {name}"))
    }

    /// Posed world quaternions and positions for per-joint deltas `Q_j` (rest-world axes, parent-relative),
    /// with `L_j = L_r · (W_r⁻¹ · Q_j · W_r)` and the root translation added to the pelvis (design §5.3).
    pub fn fk(&self, deltas: &[Q], translation: V3) -> (Vec<Q>, Vec<V3>) {
        assert_eq!(deltas.len(), self.names.len());
        let (mut g, mut p) = (Vec::<Q>::new(), Vec::<V3>::new());
        for (j, &q) in deltas.iter().enumerate() {
            let (lr, wr) = (self.local[j], self.world[j]);
            let l = mul(lr, mul(conj(wr), mul(q, wr)));
            let (gp, pp) = match self.parent[j] {
                Some(k) => (g[k], p[k]),
                None => (self.base.0, add(self.base.1, translation)),
            };
            g.push(mul(gp, l));
            p.push(add(pp, rotate(gp, self.offset[j])));
        }
        (g, p)
    }

    pub fn rest_positions(&self) -> Vec<V3> {
        self.fk(&vec![IDENTITY; self.names.len()], [0.0; 3]).1
    }
}

#[cfg(test)]
pub(crate) fn load_repo_avatar() -> Avatar {
    Avatar::load(&format!("{}/assets/model/archive-avatar.glb", crate::REPO))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maths::{axis_angle, norm, sub};

    #[test]
    fn rest_matches_design_facts() {
        let av = load_repo_avatar();
        assert_eq!(av.names.len(), 24);
        let rest = av.rest_positions();
        let at = |n: &str| rest[av.index(n)];
        assert!(norm(sub(at("pelvis"), [0.0, 0.94, 0.0])) < 1e-3);
        assert!((at("head")[1] - 1.67).abs() < 1e-3);
        assert!(
            at("left_hip")[0] > 0.1 && at("left_hand")[0] > 0.5,
            "character's left is +X"
        );
        assert!(at("left_foot")[2] > at("left_ankle")[2], "facing +Z");
    }

    #[test]
    fn world_deltas_survive_the_parent_relative_rule() {
        // With Q_j = D_p⁻¹ · D_j, §5.3 FK must give G_j = D_j · W_r,j for every joint.
        let av = load_repo_avatar();
        let d: Vec<Q> = (0..av.names.len())
            .map(|j| {
                axis_angle(
                    [1.0, (j as f64).sin(), (j as f64 * 0.7).cos()],
                    11.0 * j as f64 - 90.0,
                )
            })
            .collect();
        let q: Vec<Q> = (0..d.len())
            .map(|j| av.parent[j].map_or(d[j], |p| normalise(mul(conj(d[p]), d[j]))))
            .collect();
        let (g, _) = av.fk(&q, [0.0; 3]);
        for j in 0..d.len() {
            let want = mul(d[j], av.world[j]);
            let dotp: f64 = (0..4).map(|k| want[k] * g[j][k]).sum();
            assert!(dotp.abs() > 1.0 - 1e-10, "{}", av.names[j]);
        }
    }
}
