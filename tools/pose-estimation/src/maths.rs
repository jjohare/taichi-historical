//! Vector and quaternion maths. Quaternions are `[x, y, z, w]` (three.js and glTF order); products compose
//! right to left on vectors, so `mul(a, b)` applies `b` first.

/// A 3-vector.
pub type V3 = [f64; 3];
/// A quaternion `[x, y, z, w]`.
pub type Q = [f64; 4];

/// The identity rotation.
pub const IDENTITY: Q = [0.0, 0.0, 0.0, 1.0];

pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn scale(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn norm(a: V3) -> f64 {
    dot(a, a).sqrt()
}
pub fn unit(a: V3) -> V3 {
    let n = norm(a);
    assert!(n > 1e-12, "zero-length vector");
    scale(a, 1.0 / n)
}
/// Angle between two vectors in degrees (robust near 0° and 180°).
pub fn angle_deg(a: V3, b: V3) -> f64 {
    norm(cross(a, b)).atan2(dot(a, b)).to_degrees()
}

/// Hamilton product `a · b`.
pub fn mul(a: Q, b: Q) -> Q {
    [
        a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
        a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}
/// Inverse of a unit quaternion.
pub fn conj(q: Q) -> Q {
    [-q[0], -q[1], -q[2], q[3]]
}
/// Unit length, with `w ≥ 0` so that equal rotations print identically.
pub fn normalise(q: Q) -> Q {
    let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    let s = if q[3] < 0.0 { -1.0 / n } else { 1.0 / n };
    [q[0] * s, q[1] * s, q[2] * s, q[3] * s]
}
/// `q` applied to `v`.
pub fn rotate(q: Q, v: V3) -> V3 {
    let u = [q[0], q[1], q[2]];
    let t = scale(cross(u, v), 2.0);
    add(add(v, scale(t, q[3])), cross(u, t))
}
/// Rotation angle of `q` in degrees.
#[cfg(test)]
pub fn angle_of(q: Q) -> f64 {
    2.0 * q[3].abs().min(1.0).acos().to_degrees()
}
#[cfg(test)]
pub fn axis_angle(axis: V3, degrees: f64) -> Q {
    let a = unit(axis);
    let (s, c) = (degrees.to_radians() / 2.0).sin_cos();
    [a[0] * s, a[1] * s, a[2] * s, c]
}

/// Quaternion of a row-major rotation matrix acting on column vectors (Shepperd's method).
pub fn from_matrix(m: [[f64; 3]; 3]) -> Q {
    let tr = m[0][0] + m[1][1] + m[2][2];
    let q = if tr > 0.0 {
        let s = (tr + 1.0).sqrt() * 2.0;
        [
            (m[2][1] - m[1][2]) / s,
            (m[0][2] - m[2][0]) / s,
            (m[1][0] - m[0][1]) / s,
            s / 4.0,
        ]
    } else if m[0][0] > m[1][1] && m[0][0] > m[2][2] {
        let s = (1.0 + m[0][0] - m[1][1] - m[2][2]).sqrt() * 2.0;
        [
            s / 4.0,
            (m[0][1] + m[1][0]) / s,
            (m[0][2] + m[2][0]) / s,
            (m[2][1] - m[1][2]) / s,
        ]
    } else if m[1][1] > m[2][2] {
        let s = (1.0 + m[1][1] - m[0][0] - m[2][2]).sqrt() * 2.0;
        [
            (m[0][1] + m[1][0]) / s,
            s / 4.0,
            (m[1][2] + m[2][1]) / s,
            (m[0][2] - m[2][0]) / s,
        ]
    } else {
        let s = (1.0 + m[2][2] - m[0][0] - m[1][1]).sqrt() * 2.0;
        [
            (m[0][2] + m[2][0]) / s,
            (m[1][2] + m[2][1]) / s,
            s / 4.0,
            (m[1][0] - m[0][1]) / s,
        ]
    };
    normalise(q)
}

/// The smallest rotation taking direction `from` onto direction `to` (no twist about either).
pub fn shortest_arc(from: V3, to: V3) -> Q {
    let (a, b) = (unit(from), unit(to));
    let d = dot(a, b);
    if d < -1.0 + 1e-12 {
        // Antiparallel: any axis perpendicular to `a` will do; pick the one least aligned with a basis axis.
        let other = if a[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        let axis = unit(cross(a, other));
        return [axis[0], axis[1], axis[2], 0.0];
    }
    let c = cross(a, b);
    normalise([c[0], c[1], c[2], 1.0 + d])
}

/// The rotation taking the frame of (`u_from`, `v_from`) onto that of (`u_to`, `v_to`) (TRIAD): `u` maps exactly,
/// `v` as closely as the angle between `u` and `v` allows.
pub fn frame_align(u_from: V3, v_from: V3, u_to: V3, v_to: V3) -> Q {
    let frame = |u: V3, v: V3| {
        let e1 = unit(u);
        let e3 = unit(cross(e1, v));
        [e1, cross(e3, e1), e3]
    };
    let (f, t) = (frame(u_from, v_from), frame(u_to, v_to));
    // R = T · Fᵀ, with the frames' unit vectors as columns.
    let mut r = [[0.0; 3]; 3];
    for (i, row) in r.iter_mut().enumerate() {
        for (j, x) in row.iter_mut().enumerate() {
            *x = (0..3).map(|k| t[k][i] * f[k][j]).sum();
        }
    }
    from_matrix(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: Q, b: Q) -> bool {
        (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]).abs() > 1.0 - 1e-12
    }
    fn vclose(a: V3, b: V3) -> bool {
        norm(sub(a, b)) < 1e-12
    }

    #[test]
    fn shortest_arc_maps_direction_without_twist() {
        let cases = [
            ([0.67, -0.74, 0.05], [0.555, -0.832, 0.0]),
            ([0.0, 1.0, 0.0], [0.0, 1.0, 0.0]),
            ([1.0, 0.0, 0.0], [-1.0, 0.0, 0.0]),
            ([0.0, 0.0, 1.0], [0.0, 0.0, -1.0]),
            ([0.3, 0.2, -0.9], [-0.1, 0.8, 0.4]),
        ];
        for (from, to) in cases {
            let q = shortest_arc(from, to);
            assert!((norm([q[0], q[1], q[2]]).powi(2) + q[3] * q[3] - 1.0).abs() < 1e-12);
            assert!(
                vclose(rotate(q, unit(from)), unit(to)),
                "{from:?} -> {to:?}"
            );
            // The rotation axis is perpendicular to both directions, i.e. no twist component about them.
            let axis = [q[0], q[1], q[2]];
            assert!(dot(axis, unit(from)).abs() < 1e-9);
            assert!((angle_of(q) - angle_deg(from, to)).abs() < 1e-6);
        }
    }

    #[test]
    fn frame_align_maps_both_vectors() {
        let q = normalise(axis_angle([0.2, -1.0, 0.4], 63.0));
        let (u, v) = ([0.16, -0.03, 0.01], [0.01, 0.15, -0.02]);
        assert!(close(frame_align(u, v, rotate(q, u), rotate(q, v)), q));
        let a = frame_align(
            [1.0, 0.0, 0.0],
            [0.1, 1.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.1],
        );
        assert!(
            vclose(rotate(a, [1.0, 0.0, 0.0]), [1.0, 0.0, 0.0]),
            "primary maps exactly"
        );
    }

    #[test]
    fn matrix_round_trip_and_composition() {
        let q = normalise(mul(
            axis_angle([1.0, 2.0, 3.0], 73.0),
            axis_angle([0.0, 1.0, 0.0], -150.0),
        ));
        let cols = [
            rotate(q, [1.0, 0.0, 0.0]),
            rotate(q, [0.0, 1.0, 0.0]),
            rotate(q, [0.0, 0.0, 1.0]),
        ];
        let m = [
            [cols[0][0], cols[1][0], cols[2][0]],
            [cols[0][1], cols[1][1], cols[2][1]],
            [cols[0][2], cols[1][2], cols[2][2]],
        ];
        assert!(close(from_matrix(m), q));
        // 180° about X, the camera-to-avatar position flip, is a trace −1 matrix.
        let flip = from_matrix([[1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, -1.0]]);
        assert!(close(flip, [1.0, 0.0, 0.0, 0.0]));
        let (a, b, v) = (
            axis_angle([0.0, 0.0, 1.0], 90.0),
            axis_angle([1.0, 0.0, 0.0], 90.0),
            [0.0, 1.0, 0.0],
        );
        // mul(a, b) applies b first: Y →(X 90°) Z →(Z 90°) Z.
        assert!(vclose(rotate(mul(a, b), v), rotate(a, rotate(b, v))));
        assert!(vclose(rotate(mul(a, b), v), [0.0, 0.0, 1.0]));
        assert!(close(mul(q, conj(q)), IDENTITY));
    }

    #[test]
    fn parent_relative_deltas_round_trip() {
        // Q_j = D_p⁻¹ · D_j, then recomposing down the chain recovers every world delta.
        let d = [
            axis_angle([0.0, 1.0, 0.0], 30.0),
            axis_angle([1.0, 0.2, 0.0], -75.0),
            axis_angle([0.3, -0.4, 0.9], 140.0),
            axis_angle([0.0, 0.0, 1.0], 179.0),
        ];
        let q: Vec<Q> = (0..d.len())
            .map(|i| {
                if i == 0 {
                    d[0]
                } else {
                    normalise(mul(conj(d[i - 1]), d[i]))
                }
            })
            .collect();
        let mut acc = IDENTITY;
        for (i, qi) in q.iter().enumerate() {
            acc = mul(acc, *qi);
            assert!(close(acc, d[i]), "joint {i}");
        }
    }
}
