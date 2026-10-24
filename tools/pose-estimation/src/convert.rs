//! The retarget itself: SAM 3D Body / MHR output → avatar deltas, root translation and landmarks.
//! The derivation is in the crate documentation (`main.rs`).
use crate::avatar::Avatar;
use crate::maths::{
    IDENTITY, Q, V3, add, angle_deg, conj, frame_align, mul, normalise, rotate, scale,
    shortest_arc, sub, unit,
};
use crate::mhr::{
    JointMap, KP_LEFT_ANKLE, KP_LEFT_WRIST, KP_RIGHT_ANKLE, KP_RIGHT_WRIST, Rest, Sam,
};

/// Camera frame → avatar frame for positions: 180° about X (+Y down → +Y up, +Z into the scene → +Z towards camera).
pub fn cam_to_avatar(v: V3) -> V3 {
    [v[0], -v[1], -v[2]]
}

/// Source pelvis-to-head distance is scaled to this (design §8.3, landmarks).
pub const PELVIS_TO_HEAD: f64 = 0.73;

/// Converted pose for one photograph.
pub struct Pose {
    /// `Q_j` for every avatar joint in skin order (pelvis first; unmapped joints identity).
    pub deltas: Vec<Q>,
    pub mapped: Vec<bool>,
    pub translation: V3,
    /// Landmarks in avatar world space: left wrist, right wrist, left ankle, right ankle.
    pub landmarks: [V3; 4],
    pub scale: f64,
}

/// Per-joint world delta after rest alignment: `D'_j = D_j · A_j⁻¹`, with `A_j · b_mhr = b_avatar`.
/// `b_mhr = D_j⁻¹ · d_j` is this identity's own rest bone (its posed bone `d_j`, from `pred_joint_coords`
/// through C, carried back by the joint's delta), so per-identity shape offsets are included. The pelvis, which has
/// three child bones, is aligned as a frame: hip line exact, spine second (TRIAD).
fn aligned_world_deltas(sam: &Sam, rest: &Rest, av: &Avatar, map: &JointMap) -> Vec<Option<Q>> {
    let av_rest = av.rest_positions();
    let bone_av = |from: &str, to: &str| sub(av_rest[av.index(to)], av_rest[av.index(from)]);
    let bone_cam = |from: &str, to: &str| {
        cam_to_avatar(sub(
            sam.joints[rest.index(to)],
            sam.joints[rest.index(from)],
        ))
    };
    av.names
        .iter()
        .map(|name| {
            let e = map.get(name);
            let mhr = e.mhr.as_deref()?;
            let m = rest.index(mhr);
            let d = mul(sam.global_rots[m], conj(rest.rot[m]));
            let back = |v: V3| rotate(conj(d), v);
            let a = match (&e.align, &e.across) {
                (None, _) => return Some(d),
                (Some((child, mhr_child)), None) => {
                    shortest_arc(back(bone_cam(mhr, mhr_child)), bone_av(name, child))
                }
                (Some((child, mhr_child)), Some([right, left, mhr_right, mhr_left])) => {
                    frame_align(
                        back(bone_cam(mhr_right, mhr_left)),
                        back(bone_cam(mhr, mhr_child)),
                        bone_av(right, left),
                        bone_av(name, child),
                    )
                }
            };
            Some(mul(d, conj(a)))
        })
        .collect()
}

pub fn convert(sam: &Sam, rest: &Rest, av: &Avatar, map: &JointMap) -> Pose {
    let world = aligned_world_deltas(sam, rest, av, map);
    // Q_j = D'_parent⁻¹ · D'_j, the parent being the nearest mapped avatar ancestor. mhr-to-yang24@1 maps every
    // non-leaf joint (checked by the joint-map test), so that is the direct parent; unmapped leaves hold rest.
    let deltas: Vec<Q> = (0..av.names.len())
        .map(|j| match (world[j], av.parent[j]) {
            (None, _) => IDENTITY,
            (Some(d), None) => normalise(d),
            (Some(d), Some(p)) => normalise(mul(conj(world[p].expect("mapped parent")), d)),
        })
        .collect();

    // Root translation. SAM pins MHR's root at its template height (pred_joint_coords[root] = (0, −0.924, 0) for
    // every image), so the source pelvis carries no height measurement. Keep the lower ankle at its rest height
    // instead: a crouch lowers the pelvis, a straight-legged stance leaves it at rest. Ankles, not foot joints: the
    // two rigs rest their feet at different pitches, so the foot joint's height also moves with the alignment.
    let feet = ["left_ankle", "right_ankle"].map(|n| av.index(n));
    let lowest = |p: &[V3]| feet.iter().map(|&i| p[i][1]).fold(f64::INFINITY, f64::min);
    let (_, posed) = av.fk(&deltas, [0.0; 3]);
    let ty = (lowest(&av.rest_positions()) - lowest(&posed)).clamp(-1.0, 1.0);
    let translation = [0.0, ty, 0.0];

    // Landmarks: the estimator's own keypoints, through C and the pelvis-to-head scale only, placed at the posed
    // avatar pelvis (rest pelvis + translation) so they share the frame of checkLeftRight's forward kinematics.
    let (root, head) = (
        sam.joints[rest.index("root")],
        sam.joints[rest.index("c_head")],
    );
    let s = PELVIS_TO_HEAD / crate::maths::norm(sub(head, root));
    let pelvis = add(av.rest_positions()[av.index("pelvis")], translation);
    let lm = |k: usize| add(pelvis, scale(cam_to_avatar(sub(sam.keypoints[k], root)), s));
    Pose {
        mapped: world.iter().map(Option::is_some).collect(),
        deltas,
        translation,
        landmarks: [KP_LEFT_WRIST, KP_RIGHT_WRIST, KP_LEFT_ANKLE, KP_RIGHT_ANKLE].map(lm),
        scale: s,
    }
}

/// One row of the bone-direction check: avatar bone, MHR bone, angle between posed directions (degrees),
/// and whether the bone was rest-aligned.
pub struct BoneError {
    pub avatar: String,
    pub mhr: String,
    pub degrees: f64,
    pub aligned: bool,
}

/// Compare each avatar bone's posed direction (FK with the converted deltas) with the MHR bone's posed direction
/// taken from `pred_joint_coords` through C.
pub fn bone_errors(
    sam: &Sam,
    rest: &Rest,
    av: &Avatar,
    map: &JointMap,
    pose: &Pose,
) -> Vec<BoneError> {
    let (_, p) = av.fk(&pose.deltas, pose.translation);
    let mut out = vec![];
    for (c, name) in av.names.iter().enumerate() {
        let Some(j) = av.parent[c] else { continue };
        let pe = map.get(&av.names[j]);
        let Some(mj) = &pe.mhr else { continue };
        let aligned = pe.align.as_ref().is_some_and(|(ch, _)| ch == name);
        // The aligned bone uses the map's MHR child (the ball for the ankle, the middle-finger base for the
        // wrist); other bones use the child's mapped joint.
        let mc = match (&pe.align, &map.get(name).mhr) {
            (Some((ch, m)), _) if ch == name => m.clone(),
            (_, Some(m)) => m.clone(),
            _ => continue,
        };
        let src = cam_to_avatar(sub(sam.joints[rest.index(&mc)], sam.joints[rest.index(mj)]));
        out.push(BoneError {
            avatar: format!("{}→{name}", av.names[j]),
            mhr: format!("{mj}→{mc}"),
            degrees: angle_deg(unit(sub(p[c], p[j])), unit(src)),
            aligned,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mhr::{KP_LEFT_HIP, KP_NOSE, KP_RIGHT_HIP};

    #[test]
    fn c_maps_a_standing_camera_figure_to_avatar_axes() {
        // A figure facing the camera in SAM's camera frame: head at −Y, its left at +X, nose towards the camera (−Z).
        let (pelvis, head, nose, left_hip) = (
            [0.0, -0.92, 0.0],
            [0.0, -1.57, 0.0],
            [0.0, -1.6, -0.1],
            [0.09, -0.9, 0.0],
        );
        let (h, n, l) = (sub(head, pelvis), sub(nose, head), sub(left_hip, pelvis));
        assert!(cam_to_avatar(h)[1] > 0.6, "head above pelvis (+Y up)");
        assert!(cam_to_avatar(l)[0] > 0.0, "left hip at +X");
        assert!(cam_to_avatar(n)[2] > 0.0, "nose at +Z (forward)");
        // C is a proper rotation (det +1), so it preserves handedness: +X × +Y = +Z still holds.
        let (x, y) = (
            cam_to_avatar([1.0, 0.0, 0.0]),
            cam_to_avatar([0.0, 1.0, 0.0]),
        );
        assert_eq!(crate::maths::cross(x, y), cam_to_avatar([0.0, 0.0, 1.0]));
    }

    fn sample(id: &str) -> Option<Sam> {
        let dir = std::env::var("SAM_SAMPLE_DIR").ok()?;
        Some(Sam::load(&format!("{dir}/{id}.json")))
    }

    /// Golden test on raw SAM output, which ADR-0003 keeps out of the repository:
    /// `SAM_SAMPLE_DIR=<batch-dinov3> cargo test -- --include-ignored`.
    #[test]
    #[ignore = "needs SAM_SAMPLE_DIR pointing at a batch-dinov3 directory holding yang-001.json"]
    fn golden_yang_001() {
        let sam = sample("yang-001").expect("set SAM_SAMPLE_DIR");
        let (rest, av, map) = (
            Rest::parse(crate::MHR_REST),
            crate::avatar::load_repo_avatar(),
            JointMap::parse(crate::JOINT_MAP),
        );
        // The real standing figure satisfies C's orientation assertions.
        let k = |i: usize| cam_to_avatar(sam.keypoints[i]);
        let pelvis = cam_to_avatar(sam.joints[rest.index("root")]);
        assert!(cam_to_avatar(sam.joints[rest.index("c_head")])[1] > pelvis[1] + 0.5);
        assert!(k(KP_LEFT_HIP)[0] > k(KP_RIGHT_HIP)[0]);
        assert!(k(KP_NOSE)[2] > cam_to_avatar(sam.joints[rest.index("c_head")])[2]);

        let pose = convert(&sam, &rest, &av, &map);
        assert!(
            crate::maths::norm(pose.translation) < 0.05,
            "{:?}",
            pose.translation
        );
        for q in &pose.deltas {
            assert!(
                ((q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt() - 1.0).abs() < 1e-9
            );
        }
        for e in bone_errors(&sam, &rest, &av, &map, &pose) {
            if e.aligned {
                assert!(e.degrees < 2.0, "{} {:.2}°", e.avatar, e.degrees);
            }
        }
    }
}
