"""Build the illustrative archive avatar in Blender; no estimated poses are used.

Run through the Blender skill's headless job runner. Outputs go to BLENDER_JOB_DIR.
Blender owns the geometry, armature, glTF export and diagnostic renders.
"""
import bpy
import math
import os
import json
from mathutils import Vector

out = os.environ.get("BLENDER_JOB_DIR", os.path.abspath("assets/model"))
os.makedirs(out, exist_ok=True)
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

def bind(obj,bone,mat):
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    group=obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Skin','ARMATURE');mod.object=arm
    obj.parent=arm
    obj.select_set(False)
    for poly in obj.data.polygons:poly.use_smooth=True
    meshes.append(obj)
    return obj

def ellipsoid(name,loc,scale,bone,mat,segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=12,radius=1,location=loc)
    obj=bpy.context.object;obj.name=name;obj.scale=scale
    return bind(obj,bone,mat)

def tube(name,start,end,radii,bone,mat,segments=16):
    start,end=Vector(start),Vector(end);axis=(end-start).normalized()
    u=axis.cross(Vector((0,1,0))).normalized();v=axis.cross(u).normalized()
    verts=[];faces=[]
    # Several rings give shoulders and cuffs a gentle fabric profile.
    for t,r in radii:
        centre=start.lerp(end,t)
        for j in range(segments):
            theta=2*math.pi*j/segments
            verts.append(centre+r*(math.cos(theta)*u+math.sin(theta)*v))
    for row in range(len(radii)-1):
        for j in range(segments):
            a=row*segments+j;b=row*segments+(j+1)%segments
            faces.append((a,b,b+segments,a+segments))
    faces.append(tuple(reversed(range(segments))))
    faces.append(tuple(range((len(radii)-1)*segments,len(radii)*segments)))
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj)
    return bind(obj,bone,mat)

# A short jacket, rather than the long hems seen in some historical plates,
# deliberately leaves the hip crease and thighs free for deep flexion.
verts=[];faces=[];rings=[(1.02,.245,.145),(1.08,.25,.15),(1.27,.24,.145),(1.42,.25,.13),(1.48,.17,.10)]
for z,rx,ry in rings:
    for j in range(24):
        a=2*math.pi*j/24;verts.append((rx*math.cos(a),ry*math.sin(a),z))
for row in range(len(rings)-1):
    for j in range(24):faces.append((row*24+j,row*24+(j+1)%24,(row+1)*24+(j+1)%24,(row+1)*24+j))
faces.extend([tuple(reversed(range(24))),tuple(range(96,120))])
data=bpy.data.meshes.new('Short jacket');data.from_pydata(verts,[],faces);data.update()
obj=bpy.data.objects.new('Hip-clear jacket',data);bpy.context.collection.objects.link(obj)
bind(obj,'spine2',cloth)
# Smooth torso weighting; garments stay within the body silhouette.
obj.vertex_groups.clear()
for name in ['spine1','spine2','spine3']:obj.vertex_groups.new(name=name)
for vertex in obj.data.vertices:
    z=vertex.co.z
    if z<1.28:
        t=max(0,min(1,(z-1.10)/.18));a,b='spine1','spine2'
    else:t=max(0,min(1,(z-1.28)/.16));a,b='spine2','spine3'
    obj.vertex_groups[a].add([vertex.index],1-t,'REPLACE');obj.vertex_groups[b].add([vertex.index],t,'REPLACE')
ellipsoid('Trouser seat',(0,0,.94),(.23,.14,.13),'pelvis',trousers)
tube('Standing collar',(0,0,1.45),(0,0,1.54),[(0,.095),(.75,.08),(1,.075)],'neck',trim)
for z in [1.13,1.22,1.31,1.40]:
    ellipsoid(f'Cloth fastening {z}',(.02,-.151,z),(.045,.009,.012),'spine2' if z<1.35 else 'spine3',trim,16)
ellipsoid('Neck',(0,0,1.56),(.065,.065,.09),'neck',skin)
ellipsoid('Head',(0,-.006,1.71),(.103,.096,.137),'head',skin)
ellipsoid('Short hair',(0,.012,1.798),(.098,.092,.052),'head',hair)
ellipsoid('Nose',(0,-.102,1.704),(.019,.025,.033),'head',skin,16)
for sign in [-1,1]:
    ellipsoid('Ear',(sign*.102,0,1.71),(.016,.022,.035),'head',skin,16)
    ellipsoid('Eye',(sign*.037,-.094,1.735),(.012,.006,.006),'head',eye,12)
ellipsoid('Mouth',(0,-.095,1.663),(.025,.005,.003),'head',eye,12)

for side,sign in [('left',1),('right',-1)]:
    p=lambda part:Vector(points[f'{side}_{part}'])
    ellipsoid(f'{side} shoulder fabric',p('shoulder'),(.108,.108,.105),f'{side}_shoulder',cloth)
    tube(f'{side} upper sleeve',p('shoulder'),p('elbow'),[(0,.106),(.4,.101),(.85,.083),(1,.078)],f'{side}_shoulder',cloth)
    ellipsoid(f'{side} elbow fabric',p('elbow'),(.079,.079,.079),f'{side}_elbow',cloth)
    cuff_end=p('elbow').lerp(p('wrist'),.73)
    tube(f'{side} lower sleeve',p('elbow'),cuff_end,[(0,.078),(.65,.075),(1,.065)],f'{side}_elbow',cloth)
    tube(f'{side} cuff',p('elbow').lerp(p('wrist'),.65),cuff_end,[(0,.067),(1,.067)],f'{side}_elbow',trim)
    tube(f'{side} exposed wrist',cuff_end,p('hand'),[(0,.033),(1,.029)],f'{side}_wrist',skin)
    palm=ellipsoid(f'{side} palm',p('hand'),(.045,.025,.06),f'{side}_hand',skin)
    # Four separated fingers plus an opposed thumb: no mitten hidden in a sleeve.
    for finger in range(4):
        start=p('hand')+Vector(((finger-1.5)*.019,0,-.038))
        end=start+Vector((sign*.015,0,-(.061-abs(finger-1.5)*.007)))
        tube(f'{side} finger {finger+1}',start,end,[(0,.009),(1,.007)],f'{side}_hand',skin,8)
        ellipsoid(f'{side} fingertip {finger+1}',end,(.007,.008,.009),f'{side}_hand',skin,12)
    tube(f'{side} thumb',p('hand')+Vector((-sign*.031,-.005,.01)),p('hand')+Vector((-sign*.06,-.01,-.036)),[(0,.013),(1,.01)],f'{side}_hand',skin,10)
    tube(f'{side} thigh trousers',p('hip'),p('knee'),[(0,.125),(.3,.127),(.8,.108),(1,.096)],f'{side}_hip',trousers)
    ellipsoid(f'{side} knee fabric',p('knee'),(.096,.096,.096),f'{side}_knee',trousers)
    trouser_end=p('knee').lerp(p('ankle'),.79)
    tube(f'{side} lower trousers',p('knee'),trouser_end,[(0,.096),(.4,.10),(1,.066)],f'{side}_knee',trousers)
    tube(f'{side} trouser cuff',p('knee').lerp(p('ankle'),.73),trouser_end,[(0,.067),(1,.067)],f'{side}_knee',trim)
    tube(f'{side} exposed ankle',trouser_end,p('ankle'),[(0,.036),(1,.035)],f'{side}_ankle',skin)
    ellipsoid(f'{side} distinct cloth shoe',(sign*.15,-.063,.055),(.063,.135,.048),f'{side}_foot',shoe)
    ellipsoid(f'{side} shoe sole',(sign*.15,-.063,.022),(.065,.138,.014),f'{side}_foot',sole)

arm['description']='Illustrative training avatar inspired by archive clothing; not a portrait, scan or DPMesh estimate.'
arm['pose_binding']='none'
arm['clearance']='Sleeves end before wrists; trouser cuffs before ankles; jacket above hip crease.'
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'archive-avatar.glb'),export_format='GLB',export_animations=False,export_extras=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'archive-avatar.blend'))

# Document a reproducible diagnostic view; no catalogue pose is used.
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=800;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.world.color=(.65,.65,.60)
for name,location,power,size in [('Key',(3,-4,5),450,4),('Fill',(-3,-2,3),300,3)]:
    bpy.ops.object.light_add(type='AREA',location=location);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(Vector((0,0,1))-lamp.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2.8,-4.5,2.25));camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,.95))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=2.15;scene.camera=camera
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.render.filepath=os.path.join(out,'avatar-neutral.png');bpy.ops.render.render(write_still=True)
report={'bones':len(arm.data.bones),'meshes':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),'source':'Original illustrative model; historic clothing reference only','pose_estimates':0,'binding':'none'}
with open(os.path.join(out,'build-report.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps(report))
