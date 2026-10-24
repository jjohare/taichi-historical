"""Build the illustrative archive avatar in Blender; no estimated poses are used.

Run through the Blender skill's headless job runner. Outputs go to BLENDER_JOB_DIR.
Blender owns the geometry, armature, skin weights, glTF export and diagnostic renders.

Construction (v2, "continuous skinned mesh"): the torso, arms and legs are one
continuous surface. Smooth solids that follow the bones are fused by a voxel
remesh, filleted, re-meshed to an even quad budget and cut along exact planes so
that the garment zones (jacket, trousers, linen collar and cuffs, exposed skin)
are materials on that one surface, not separate pieces. The head, the hands
(palm, four fingers and thumb fused into one surface) and the shoes and soles
stay separate named objects, because the explorer's skeleton view keeps exactly
those visible. Body weights start from Blender's automatic (bone-heat) weights
and are then corrected: no cross-side or thigh influence on the jacket, and the
exposed wrists, ankles and neck follow the joint they cross, ending rigid with
the hand, ankle and head bones where they meet the separate parts.

The 24-bone armature below is the retargeting contract and must not change.

Optional script argument (after `--`): `--pose-tests` renders diagnostic bends
AFTER the rest-pose GLB, blend file and preview have been written.
"""
import bpy
import bmesh
import math
import os
import sys
import json
import struct
import zlib
from mathutils import Vector, Quaternion
from mathutils.kdtree import KDTree

out = os.environ.get("BLENDER_JOB_DIR", os.path.abspath("assets/model"))
os.makedirs(out, exist_ok=True)
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
POSE_TESTS = '--pose-tests' in argv
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, colour):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*colour, 1)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .85
    return mat

cloth = material('Jade training jacket — illustrative colour', (.10,.19,.16))
trousers = material('Ink trousers', (.075,.095,.085))
skin = material('Warm clay — illustrative skin', (.56,.36,.24))
trim = material('Linen collar and fasteners', (.72,.66,.52))
shoe = material('Cloth shoes', (.045,.055,.05))
sole = material('Pale soles', (.43,.40,.32))
hair = material('Short dark hair', (.075,.07,.06))
eye = material('Facial marks', (.045,.035,.03))

# ---------------------------------------------------------------------------
# Armature: unchanged from v1. Bone names, hierarchy, heads, tails and rolls are
# the contract with assets/explorer/retarget.js and the pose fixtures.
# ---------------------------------------------------------------------------
# Standard SMPL-style names, with an independently authored rest shape.
# Blender Z-up, forward -Y; glTF export converts to Y-up, forward +Z.
points = {
 'pelvis':(0,0,.94),'spine1':(0,0,1.10),'spine2':(0,0,1.28),'spine3':(0,0,1.44),
 'neck':(0,0,1.54),'head':(0,0,1.67),
}
parents = {'pelvis':None,'spine1':'pelvis','spine2':'spine1','spine3':'spine2','neck':'spine3','head':'neck'}
for side, sign in [('left',1),('right',-1)]:
    for part,pos,parent in [
      ('hip',(sign*.14,0,.91),'pelvis'),('knee',(sign*.15,0,.51),f'{side}_hip'),
      ('ankle',(sign*.15,0,.11),f'{side}_knee'),('foot',(sign*.15,-.10,.055),f'{side}_ankle'),
      ('collar',(sign*.13,0,1.44),'spine3'),('shoulder',(sign*.255,0,1.43),f'{side}_collar'),
      ('elbow',(sign*.435,0,1.16),f'{side}_shoulder'),('wrist',(sign*.55,0,.93),f'{side}_elbow'),
      ('hand',(sign*.59,0,.85),f'{side}_wrist')]:
        name=f'{side}_{part}'; points[name]=pos; parents[name]=parent

arm_data=bpy.data.armatures.new('Archive avatar skeleton')
arm=bpy.data.objects.new('ArchiveAvatar',arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active=arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,pos in points.items():
    bone=arm_data.edit_bones.new(name);bone.head=pos
    children=[key for key in points if parents[key]==name]
    bone.tail=points[children[0]] if children else Vector(pos)+Vector((0,0,.08))
    if (bone.tail-bone.head).length<.01:bone.tail.z+=.08
    if parents[name]:bone.parent=arm_data.edit_bones[parents[name]]
bpy.ops.object.mode_set(mode='OBJECT')
arm.select_set(False)
meshes=[]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
P = lambda name: Vector(points[name])

def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def activate(*objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

def new_object(name, verts, edges=(), faces=()):
    # Object and mesh data share a name: GLTFLoader names multi-material child meshes
    # after the mesh data, and the skeleton-view filter in rig.js tests those names.
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(v) for v in verts], list(edges), list(faces))
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj

def apply_modifiers(obj):
    activate(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)

def ellipsoid(name, loc, scale, mat, segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=loc)
    obj = bpy.context.object
    obj.name = name; obj.data.name = name; obj.scale = scale
    activate(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(mat)
    return obj

def tube(name, start, end, radii, mat, segments=12):
    """Closed tube with several profile rings; used only as input to a fused (remeshed) part."""
    start, end = Vector(start), Vector(end); axis = (end - start).normalized()
    u = axis.cross(Vector((0, 1, 0))).normalized(); v = axis.cross(u).normalized()
    verts = []; faces = []
    for t, r in radii:
        centre = start.lerp(end, t)
        for j in range(segments):
            theta = 2 * math.pi * j / segments
            verts.append(centre + r * (math.cos(theta) * u + math.sin(theta) * v))
    for row in range(len(radii) - 1):
        for j in range(segments):
            a = row * segments + j; b = row * segments + (j + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range((len(radii) - 1) * segments, len(radii) * segments)))
    obj = new_object(name, verts, (), faces)
    obj.data.materials.append(mat)
    return obj

def join(target, others):
    activate(target, *others)
    bpy.ops.object.join()
    return target

def smooth_shading(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = True

def bind(obj):
    """Parent to the armature with an Armature modifier (linear blend, as three.js skins)."""
    mod = obj.modifiers.new('Skin', 'ARMATURE'); mod.object = arm
    mod.use_deform_preserve_volume = False
    obj.parent = arm
    smooth_shading(obj)
    meshes.append(obj)
    return obj

def set_weights(obj, weights):
    """weights: list (per vertex) of {bone: weight}; normalised, at most four influences."""
    obj.vertex_groups.clear()
    groups = {name: obj.vertex_groups.new(name=name) for name in points}
    for index, table in enumerate(weights):
        items = sorted(((w, b) for b, w in table.items() if w > 1e-4), reverse=True)[:4]
        total = sum(w for w, _ in items)
        for w, b in items:
            groups[b].add([index], w / total, 'REPLACE')

def read_weights(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 0} for v in obj.data.vertices]

def segment_param(p, a, b):
    ab = b - a
    return max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))

# ---------------------------------------------------------------------------
# Body: one continuous surface. Smooth solids that follow the bones (a lofted torso,
# capsule chains for the neck, arms and legs) are fused by a voxel remesh, filleted by
# volume-preserving smoothing, re-meshed coarser to an even quad budget, then cut along exact planes so that each garment
# border (jacket hem, collar, sleeve cuffs, trouser cuffs) is a clean edge loop.
BODY_VOXEL = .018                        # second remesh: about 12k body vertices
HEM_Z, COLLAR_Z, NECK_Z = 1.03, 1.50, 1.55
SLEEVE_CUFF, SLEEVE_END = .62, .75      # along elbow -> wrist
TROUSER_CUFF, TROUSER_END = .72, .81    # along knee -> ankle

def loft(name, rings, segments=40):
    """Closed vertical loft through elliptical rings (z, half-width, half-depth)."""
    verts = [(rx * math.cos(2 * math.pi * j / segments), ry * math.sin(2 * math.pi * j / segments), z)
             for z, rx, ry in rings for j in range(segments)]
    faces = [(r * segments + j, r * segments + (j + 1) % segments, (r + 1) * segments + (j + 1) % segments, (r + 1) * segments + j)
             for r in range(len(rings) - 1) for j in range(segments)]
    faces += [tuple(reversed(range(segments))), tuple(range((len(rings) - 1) * segments, len(rings) * segments))]
    return new_object(name, verts, (), faces)

def capsule_chain(name, stops, segments=24):
    """Spheres at each stop joined by truncated cones: a smooth limb of varying radius."""
    parts = []
    for i, (point, radius) in enumerate(stops):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=segments // 2, radius=radius, location=point)
        parts.append(bpy.context.object)
        if i:
            parts.append(tube(f'{name} {i}', stops[i - 1][0], point, [(0, stops[i - 1][1]), (1, radius)], skin, segments))
    return parts

volumes = [loft('Torso volume', [(.86, .16, .105), (.90, .2, .128), (.95, .213, .134), (1.0, .222, .139),
                                 (HEM_Z, .238, .148), (1.07, .238, .147), (1.27, .232, .143), (1.37, .236, .135),
                                 (1.43, .22, .122), (1.462, .165, .102), (1.482, .1, .085)])]
volumes += capsule_chain('Neck volume', [((0, 0, 1.46), .09), ((0, 0, 1.545), .088), ((0, 0, 1.568), .064), ((0, 0, 1.665), .056)])
for side, sign in [('left', 1), ('right', -1)]:
    p = lambda part: P(f'{side}_{part}')
    shoulder, elbow, wrist, hand, knee, ankle = p('shoulder'), p('elbow'), p('wrist'), p('hand'), p('knee'), p('ankle')
    # Loose sleeve, linen cuff ending well before the wrist, exposed wrist running into the palm.
    volumes += capsule_chain(f'{side} arm volume', [
        (Vector((sign * .17, 0, 1.425)), .1), (shoulder, .1), (shoulder.lerp(elbow, .45), .09), (elbow, .075),
        (elbow.lerp(wrist, SLEEVE_CUFF), .069), (elbow.lerp(wrist, SLEEVE_END - .01), .066),
        (elbow.lerp(wrist, SLEEVE_END + .018), .034), (wrist, .031), (hand.lerp(wrist, .15), .028)])
    # Trouser seat into the thigh, raised trouser cuff, exposed ankle running into the shoe.
    volumes += capsule_chain(f'{side} leg volume', [
        (Vector((sign * .125, 0, .93)), .12), (p('hip').lerp(knee, .3), .118), (knee, .093), (knee.lerp(ankle, .4), .095),
        (knee.lerp(ankle, TROUSER_CUFF), .073), (knee.lerp(ankle, TROUSER_END - .01), .07),
        (knee.lerp(ankle, TROUSER_END + .022), .038), (ankle, .035), (ankle + Vector((0, -.012, -.04)), .034)])
body = join(volumes[0], volumes[1:])
body.name = body.data.name = 'Archive avatar body'
body.data.remesh_voxel_size = .008
activate(body)
bpy.ops.object.voxel_remesh()
fillet = body.modifiers.new('Fillet', 'LAPLACIANSMOOTH')
fillet.iterations = 12; fillet.lambda_factor = .6; fillet.use_volume_preserve = True; fillet.use_normalized = True
apply_modifiers(body)

def keep_outer_shell(obj):
    """Merge coincident vertices, drop every shell but the largest (internal cavities of the union), fix normals."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.faces.ensure_lookup_table()
    seen = set(); shells = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack = [face]; shell = []; seen.add(face.index)
        while stack:
            f = stack.pop(); shell.append(f)
            for edge in f.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index); stack.append(other)
        shells.append(shell)
    shells.sort(key=len, reverse=True)
    doomed = [f for shell in shells[1:] for f in shell]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    print(obj.name, 'shells', len(shells), 'non-manifold edges', non_manifold)
    return non_manifold

keep_outer_shell(body)
# Even quads at the vertex budget: a second, coarser voxel pass over the already filleted shape.
body.data.remesh_voxel_size = BODY_VOXEL
activate(body)
bpy.ops.object.voxel_remesh()
keep_outer_shell(body)
print('body vertices after coarse remesh', len(body.data.vertices))
relax = body.modifiers.new('Relax', 'LAPLACIANSMOOTH')
relax.iterations = 2; relax.lambda_factor = .3; relax.use_volume_preserve = True; relax.use_normalized = True
apply_modifiers(body)

def nearest_on(point, a, b):
    return a.lerp(b, segment_param(point, a, b))

cuts = [((0, 0, HEM_Z), (0, 0, 1), lambda c: abs(c.x) < .32 and abs(c.z - HEM_Z) < .06),
        ((0, 0, COLLAR_Z), (0, 0, 1), lambda c: math.hypot(c.x, c.y) < .115 and abs(c.z - COLLAR_Z) < .03),
        ((0, 0, NECK_Z), (0, 0, 1), lambda c: math.hypot(c.x, c.y) < .12 and abs(c.z - NECK_Z) < .05)]
for side in ('left', 'right'):
    elbow, wrist, knee, ankle = P(f'{side}_elbow'), P(f'{side}_wrist'), P(f'{side}_knee'), P(f'{side}_ankle')
    for t in (SLEEVE_CUFF, SLEEVE_END):
        centre = elbow.lerp(wrist, t)
        cuts.append((centre, wrist - elbow, lambda c, centre=centre: (c - centre).length < .12))
    for t in (TROUSER_CUFF, TROUSER_END):
        centre = knee.lerp(ankle, t)
        cuts.append((centre, ankle - knee, lambda c, centre=centre: (c - centre).length < .13))
bm = bmesh.new(); bm.from_mesh(body.data)
for co, normal, near in cuts:
    faces = [f for f in bm.faces if near(f.calc_center_median())]
    geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(normal).normalized())
bm.to_mesh(body.data); bm.free()

def zone(c):
    """Garment zone of a point on the body, using the same planes as the cuts."""
    side = 'left' if c.x > 0 else 'right'
    elbow, wrist, knee, ankle = (P(f'{side}_{part}') for part in ('elbow', 'wrist', 'knee', 'ankle'))
    if (c - nearest_on(c, elbow, wrist)).length < .1 and abs(c.x) > .4:
        if (c - wrist).dot(wrist - elbow) > 0:
            return 'skin'
        t = segment_param(c, elbow, wrist)
        return 'skin' if t >= SLEEVE_END else 'trim' if t >= SLEEVE_CUFF else 'jacket'
    if c.z < knee.z and (c - nearest_on(c, knee, ankle)).length < .12:
        t = segment_param(c, knee, ankle)
        return 'skin' if t >= TROUSER_END else 'trim' if t >= TROUSER_CUFF else 'trousers'
    if math.hypot(c.x, c.y) < .115 and c.z >= COLLAR_Z:
        return 'skin' if c.z >= NECK_Z else 'trim'
    return 'jacket' if c.z >= HEM_Z else 'trousers'

zone_material = {'jacket': cloth, 'trousers': trousers, 'skin': skin, 'trim': trim}
body.data.materials.clear()
slots = list(zone_material.values())
for mat in slots:
    body.data.materials.append(mat)
for poly in body.data.polygons:
    poly.material_index = slots.index(zone_material[zone(poly.center)])
smooth_shading(body)

# ---------------------------------------------------------------------------
# Separate, rigid parts kept visible in skeleton view.
# ---------------------------------------------------------------------------
head_parts = [ellipsoid('Head', (0, -.006, 1.71), (.103, .096, .137), skin, 32, 16),
              ellipsoid('Short hair', (0, .012, 1.798), (.098, .092, .052), hair, 32, 12),
              ellipsoid('Nose', (0, -.102, 1.704), (.019, .025, .033), skin, 16, 8),
              ellipsoid('Mouth', (0, -.095, 1.663), (.025, .005, .003), eye, 12, 6)]
for sign in [-1, 1]:
    head_parts.append(ellipsoid('Ear', (sign * .102, 0, 1.71), (.016, .022, .035), skin, 16, 8))
    head_parts.append(ellipsoid('Eye', (sign * .037, -.094, 1.735), (.012, .006, .006), eye, 12, 6))
head = join(head_parts[0], head_parts[1:])
head.name = 'Head'; head.data.name = 'Head'

hands = {}
shoes = {}
for side, sign in [('left', 1), ('right', -1)]:
    hand = P(f'{side}_hand')
    # Palm, four separated fingers and an opposed thumb, fused into one surface by a voxel remesh.
    parts = [ellipsoid(f'{side} palm part', hand, (.045, .025, .06), skin)]
    for finger in range(4):
        spread = finger - 1.5
        start = hand + Vector((spread * .019, 0, -.038))
        end = start + Vector((sign * .015 + spread * .005, 0, -(.061 - abs(spread) * .007)))
        parts.append(tube(f'{side} finger {finger + 1}', start, end, [(0, .0095), (.5, .0085), (1, .0075)], skin, 10))
        parts.append(ellipsoid(f'{side} fingertip {finger + 1}', end, (.0075, .0085, .0095), skin, 12, 6))
    t0 = hand + Vector((-sign * .031, -.005, .01)); t1 = hand + Vector((-sign * .06, -.012, -.036))
    parts.append(tube(f'{side} thumb part', t0, t1, [(0, .014), (.6, .011), (1, .0105)], skin, 10))
    parts.append(ellipsoid(f'{side} thumb tip', t1, (.0105, .0105, .0105), skin, 12, 6))
    fused = join(parts[0], parts[1:])
    fused.name = fused.data.name = f'{side} palm with four fingers and thumb'
    fused.data.remesh_voxel_size = .0022
    activate(fused)
    bpy.ops.object.voxel_remesh()
    decimate = fused.modifiers.new('Reduce', 'DECIMATE'); decimate.ratio = min(1.0, 800 / len(fused.data.vertices))
    smooth = fused.modifiers.new('Soften', 'CORRECTIVE_SMOOTH'); smooth.iterations = 3; smooth.use_only_smooth = True
    apply_modifiers(fused)
    if not fused.data.materials:
        fused.data.materials.append(skin)
    hands[side] = fused

    # Distinct cloth shoe and pale sole, lightly bevelled.
    upper = ellipsoid(f'{side} distinct cloth shoe', (sign * .15, -.063, .058), (.063, .135, .05), shoe, 32, 16)
    for v in upper.data.vertices:
        if v.co.z < .035:  # flatten the underside onto the sole
            v.co.z = .035 - (.035 - v.co.z) * .25
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=1, depth=1, location=(sign * .15, -.063, .021))
    base = bpy.context.object
    base.name = base.data.name = f'{side} shoe sole'
    base.scale = (.066, .14, .02)
    activate(base); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    base.data.materials.append(sole)
    bevel = base.modifiers.new('Rounded edge', 'BEVEL'); bevel.width = .006; bevel.segments = 3
    apply_modifiers(base)
    shoes[side] = (upper, base)

# Linen fastenings, seated on the jacket front by casting onto the continuous body.
fastenings = []
for z in [1.13, 1.22, 1.31, 1.40]:
    hit, location, _, _ = body.ray_cast(Vector((.02, -1, z)), Vector((0, 1, 0)))
    y = location.y if hit else -.15
    fastenings.append(ellipsoid(f'Cloth fastening {z}', (.02, y - .002, z), (.045, .009, .012), trim, 16, 8))

# ---------------------------------------------------------------------------
# Weights: automatic (bone heat), then corrected.
# ---------------------------------------------------------------------------
# The leaf bones (hands, feet, head) have tails pointing up into the limb they end, which
# would steal the wrists, ankles and neck. Exclude them from the automatic pass only.
leaf_bones = [f'{s}_{part}' for s in ('left', 'right') for part in ('hand', 'foot')] + ['head']
for name in leaf_bones:
    arm_data.bones[name].use_deform = False
activate(body, arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for name in leaf_bones:
    arm_data.bones[name].use_deform = True
assert all(b.use_deform for b in arm_data.bones), 'every bone must deform again before export'
heat = read_weights(body)
# Keep only the weights; the modifier and parent are re-made by bind() after the fastenings join.
for mod in list(body.modifiers):
    body.modifiers.remove(mod)
body.parent = None
assert sum(1 for w in heat if w) > .95 * len(heat), 'automatic weighting failed for part of the body'

def limb_blend(a, b, t, t0, t1):
    """Blend from bone `a` to bone `b` as t runs t0..t1 (smoothstep)."""
    s = smoothstep(t0, t1, t)
    return {a: 1 - s, b: s} if a != b else {a: 1.0}

corrected = []
for index, vertex in enumerate(body.data.vertices):
    co = vertex.co; table = dict(heat[index])
    # 1. No influence from the opposite side's limbs (bone heat bleeds across the crotch and chest).
    if co.x > .015:
        table = {b: w for b, w in table.items() if not b.startswith('right_')}
    elif co.x < -.015:
        table = {b: w for b, w in table.items() if not b.startswith('left_')}
    # The jacket hangs from the spine: no thigh influence above the hem (it crumples the front in a crouch).
    if co.z > HEM_Z and abs(co.x) < .3:
        table = {b: w for b, w in table.items() if not b.endswith('_hip')}
    side = 'left' if co.x > 0 else 'right'
    s = lambda part: f'{side}_{part}'
    elbow, wrist, hand = P(s('elbow')), P(s('wrist')), P(s('hand'))
    knee, ankle = P(s('knee')), P(s('ankle'))
    # 2. Forearm, exposed wrist and the ring that enters the palm (elbow -> wrist -> hand).
    forearm_t = segment_param(co, elbow, wrist); hand_u = segment_param(co, wrist, hand)
    near_forearm = (co - elbow.lerp(wrist, forearm_t)).length < .1 or (co - wrist.lerp(hand, hand_u)).length < .07
    if abs(co.x) > .40 and co.z < elbow.z + .02 and near_forearm:
        if (co - wrist).dot(wrist - elbow) > 0:
            table = limb_blend(s('wrist'), s('hand'), hand_u, .45, .8)
        elif forearm_t > .55:
            table = limb_blend(s('elbow'), s('wrist'), forearm_t, .88, 1.0)
    # 3. Shin, exposed ankle and the ring inside the shoe.
    shin_t = segment_param(co, knee, ankle)
    if abs(co.x) > .05 and co.z < knee.z - .1 and (co - knee.lerp(ankle, shin_t)).length < .11:
        if co.z <= ankle.z:
            table = {s('ankle'): 1.0}
        elif shin_t > .6:
            table = limb_blend(s('knee'), s('ankle'), shin_t, .9, 1.0)
    # 4. Neck into the head: the top of the neck is rigid with the head.
    if abs(co.x) < .1 and co.z > 1.53:
        if co.z >= 1.62:
            table = {'head': 1.0}
        elif co.z > 1.555:
            table = limb_blend('neck', 'head', co.z, 1.575, 1.62)
        else:
            table = limb_blend('spine3', 'neck', co.z, 1.51, 1.555)
    if not table:
        table = {'pelvis': 1.0}
    corrected.append(table)
set_weights(body, corrected)
activate(body)
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=.5, repeat=6)
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
# Re-pin the junction rings after smoothing, so nothing gaps against the rigid parts.
final = read_weights(body)
for index, vertex in enumerate(body.data.vertices):
    co = vertex.co; side = 'left' if co.x > 0 else 'right'
    if abs(co.x) < .1 and co.z >= 1.62:
        final[index] = {'head': 1.0}
    elif abs(co.x) > .05 and co.z <= points[f'{side}_ankle'][2] + .005 and co.z < .3:
        final[index] = {f'{side}_ankle': 1.0}
    elif abs(co.x) > .5 and segment_param(co, P(f'{side}_wrist'), P(f'{side}_hand')) > .8:
        final[index] = {f'{side}_hand': 1.0}
set_weights(body, final)

# Fastenings follow the nearest body vertex.
body_tree = KDTree(len(body.data.vertices))
for v in body.data.vertices:
    body_tree.insert(v.co, v.index)
body_tree.balance()
for f in fastenings:
    centre = sum((v.co for v in f.data.vertices), Vector()) / len(f.data.vertices)
    _, nearest, _ = body_tree.find(centre)
    set_weights(f, [dict(final[nearest]) for _ in f.data.vertices])
join(body, fastenings)
body.name = body.data.name = 'Archive avatar body'
bind(body)

set_weights(head, [{'head': 1.0} for _ in head.data.vertices]); bind(head)
for side, fused in hands.items():
    set_weights(fused, [{f'{side}_hand': 1.0} for _ in fused.data.vertices]); bind(fused)
for side, parts in shoes.items():
    foot_y = points[f'{side}_foot'][1]
    for part in parts:
        # Heel with the ankle bone, toe with the foot bone, blended across the ball of the foot.
        part_weights = []
        for v in part.data.vertices:
            toe = smoothstep(foot_y + .03, foot_y - .03, v.co.y)
            part_weights.append({f'{side}_ankle': 1 - toe, f'{side}_foot': toe})
        set_weights(part, part_weights); bind(part)

arm['description']='Illustrative training avatar inspired by archive clothing; not a portrait, scan or DPMesh estimate.'
arm['pose_binding']='none'
arm['clearance']='Sleeves end before wrists; trouser cuffs before ankles; jacket above hip crease.'
for obj in meshes:
    obj.matrix_parent_inverse.identity()
    assert obj.name == obj.data.name, obj.name
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'archive-avatar.glb'),export_format='GLB',export_animations=False,
                          export_extras=True,export_texcoords=False,export_tangents=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'archive-avatar.blend'))

# ---------------------------------------------------------------------------
# Document a reproducible diagnostic view; no catalogue pose is used.
# ---------------------------------------------------------------------------
def strip_png_text(path):
    """Rewrite a PNG without tEXt/iTXt/zTXt chunks (Blender stores the source file path in them)."""
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    kept = [data[:8]]; pos = 8
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos:pos + 12 + length]
        if kind not in (b'tEXt', b'iTXt', b'zTXt'):
            kept.append(chunk)
        pos += 12 + length
    with open(path, 'wb') as f:
        f.write(b''.join(kept))

scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=800;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.use_stamp=False
scene.world.color=(.65,.65,.60)
for name,location,power,size in [('Key',(3,-4,5),450,4),('Fill',(-3,-2,3),300,3)]:
    bpy.ops.object.light_add(type='AREA',location=location);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(Vector((0,0,1))-lamp.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2.8,-4.5,2.25));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,.95))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=2.15;scene.camera=camera
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.render.filepath=os.path.join(out,'avatar-neutral.png');bpy.ops.render.render(write_still=True)
strip_png_text(os.path.join(out,'avatar-neutral.png'))
for obj in meshes:
    print('mesh', obj.name, len(obj.data.vertices))
report={'bones':len(arm.data.bones),'meshes':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),
        'source':'Original illustrative model; historic clothing reference only','pose_estimates':0,'binding':'none',
        'build':'continuous skinned mesh v2','blender':bpy.app.version_string}
with open(os.path.join(out,'build-report.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps(report))

# ---------------------------------------------------------------------------
# Optional pose tests. Everything above is already written at rest; nothing is saved below.
# Bends follow the explorer's rule: a rotation about the rest-world +X axis in the bone's frame.
# ---------------------------------------------------------------------------
if POSE_TESTS:
    def bend(name, degrees):
        pose_bone = arm.pose.bones[name]
        axis = arm_data.bones[name].matrix_local.to_3x3().inverted() @ Vector((1, 0, 0))
        pose_bone.rotation_mode = 'QUATERNION'
        pose_bone.rotation_quaternion = Quaternion(axis.normalized(), math.radians(degrees))
    def rest():
        for pose_bone in arm.pose.bones:
            pose_bone.rotation_mode = 'QUATERNION'; pose_bone.rotation_quaternion = (1, 0, 0, 0)
    views = {'front': (0, -3.3015, 1.45), 'side': (3.3015, 0, 1.45), 'three-quarter': (2.8, -4.5, 2.25)}
    def shoot(label):
        for view, location in views.items():
            camera.location = location
            camera.rotation_euler = (Vector((0, 0, .95)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            path = os.path.join(out, f'pose-{label}-{view}.png')
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            strip_png_text(path)
    tests = {
        'rest': {},
        'elbows40-crouch30': {'left_elbow': -40, 'right_elbow': -40, 'left_hip': -30, 'right_hip': -30,
                              'left_knee': 60, 'right_knee': 60, 'left_ankle': -30, 'right_ankle': -30},
        'left-elbow60-deep-crouch': {'left_elbow': -60, 'left_hip': -60, 'right_hip': -60,
                                     'left_knee': 120, 'right_knee': 120, 'left_ankle': -45, 'right_ankle': -45},
        'twist': {'left_shoulder': 50, 'right_shoulder': -50, 'neck': 20, 'head': -20, 'left_wrist': 40, 'left_foot': 30},
    }
    for label, bends in tests.items():
        rest()
        for name, degrees in bends.items():
            bend(name, degrees)
        bpy.context.view_layer.update()
        shoot(label)
    rest()
