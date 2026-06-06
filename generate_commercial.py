import bpy
import math
import random

# ==========================================
# CONSTANTS & SETUP
# ==========================================
FPS = 30
TOTAL_FRAMES = 810

# Color Palette (Premium Minimalist Tech)
COLOR_BG = (0.965, 0.965, 0.972, 1.0)        # Soft white studio backdrop
COLOR_DARK = (0.07, 0.07, 0.07, 1.0)          # Premium dark text/cursor
COLOR_BLUE = (0.05, 0.40, 0.95, 1.0)          # Modern brand blue
COLOR_BLUE_GLOW = (0.1, 0.5, 1.0, 1.0)       # Glowing brand blue
COLOR_ORANGE = (1.0, 0.35, 0.15, 1.0)        # Accent orange
COLOR_GREEN = (0.1, 0.8, 0.4, 1.0)           # Mint accent
COLOR_RED = (0.95, 0.2, 0.2, 1.0)            # Danger/Remove accent
COLOR_LIGHT_GREY = (0.90, 0.90, 0.92, 1.0)    # Soft timeline tracks

# ==========================================
# INITIALIZATION FUNCTIONS
# ==========================================
def clear_scene():
    """Wipes all existing objects, materials, meshes, cameras, and lights from the scene."""
    if bpy.ops.object.mode_set.poll():
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    
    # Clean up orphan data blocks
    for collection in [bpy.data.meshes, bpy.data.materials, bpy.data.curves, 
                       bpy.data.cameras, bpy.data.lights, bpy.data.images]:
        for block in collection:
            collection.remove(block)

def setup_render_settings():
    """Configures high-end rendering settings using the Cycles engine."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.render.resolution_x = 3840
    scene.render.resolution_y = 2160
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = TOTAL_FRAMES
    
    # Cycles performance and quality tweaks
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    
    # AgX Color management for premium contrast roll-off
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - High Contrast'
    
    # Output properties (MP4 H.264 if supported, else PNG sequence)
    try:
        scene.render.image_settings.file_format = 'FFMPEG'
        scene.render.ffmpeg.format = 'MPEG4'
        scene.render.ffmpeg.codec = 'H264'
        scene.render.ffmpeg.constant_rate_factor = 'HIGH'
        scene.render.ffmpeg.audio_codec = 'AAC'
    except TypeError:
        scene.render.image_settings.file_format = 'PNG'
    
    # Motion Blur
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5

# ==========================================
# MATERIAL GENERATION
# ==========================================
def create_principled_material(name, base_color, roughness=0.4, metallic=0.0, specular=0.5):
    """Creates a basic standard Principled BSDF material."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    
    node_bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    node_bsdf.inputs['Base Color'].default_value = base_color
    node_bsdf.inputs['Roughness'].default_value = roughness
    node_bsdf.inputs['Metallic'].default_value = metallic
    
    node_output = nodes.new(type='ShaderNodeOutputMaterial')
    mat.node_tree.links.new(node_bsdf.outputs['BSDF'], node_output.inputs['Surface'])
    return mat

def create_emission_material(name, color, strength=5.0):
    """Creates a glowing emissive material for buttons or UI accents."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    
    node_emit = nodes.new(type='ShaderNodeEmission')
    node_emit.inputs['Color'].default_value = color
    node_emit.inputs['Strength'].default_value = strength
    
    node_output = nodes.new(type='ShaderNodeOutputMaterial')
    mat.node_tree.links.new(node_emit.outputs['Emission'], node_output.inputs['Surface'])
    return mat

# ==========================================
# ANIMATION HELPER
# ==========================================
def keyframe_prop(obj, path, index, frame, value, interp='BEZIER'):
    """Sets a property value and creates a keyframe with custom interpolation."""
    if index is not None:
        val_arr = getattr(obj, path)
        val_arr[index] = value
        obj.keyframe_insert(data_path=path, index=index, frame=frame)
    else:
        setattr(obj, path, value)
        obj.keyframe_insert(data_path=path, frame=frame)
        
    # Apply interpolation to fcurve
    if obj.animation_data and obj.animation_data.action:
        for fc in obj.animation_data.action.fcurves:
            if fc.data_path == path and (index is None or fc.array_index == index):
                for kp in fc.keyframe_points:
                    if abs(kp.co[0] - frame) < 0.05:
                        kp.interpolation = interp
                        break

# ==========================================
# GEOMETRY GENERATORS (PROCEDURAL UI)
# ==========================================
def create_rounded_plane(name, width, height, radius, thickness=0.03, material=None):
    """Generates a modern rounded rectangle panel."""
    # Start with a standard plane
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width, height, 1)
    bpy.ops.object.transform_apply(scale=True)
    
    # Round the corners using vertex bevel in Edit Mode
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type="VERT")
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.bevel(offset=radius, affect='VERTICES', segments=5)
    bpy.ops.object.mode_set(mode='OBJECT')
    
    # Add modern thickness (solidify)
    if thickness > 0:
        mod = obj.modifiers.new(name="Solidify", type='SOLIDIFY')
        mod.thickness = thickness
        bpy.ops.object.modifier_apply(modifier="Solidify")
        
    if material:
        obj.data.materials.append(material)
        
    return obj

def create_text_object(name, body, location, scale=1.0, extrude=0.02, bevel=0.005, material=None, parent=None):
    """Creates a centered 3D text object."""
    font_curve = bpy.data.curves.new(name=name, type='FONT')
    font_curve.body = body
    font_curve.extrude = extrude
    font_curve.bevel_depth = bevel
    font_curve.align_x = 'CENTER'
    font_curve.align_y = 'MIDDLE'
    
    obj = bpy.data.objects.new(name=name, object_data=font_curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.scale = (scale, scale, scale)
    
    if parent:
        obj.parent = parent
    if material:
        obj.data.materials.append(material)
    return obj

def create_click_ripple(location, frame):
    """Spawns an expanding and fading click wave at a target location."""
    bpy.ops.mesh.primitive_torus_add(align='WORLD', location=location, major_radius=0.01, minor_radius=0.005)
    ripple = bpy.context.active_object
    ripple.name = "ClickRipple"
    
    # Expands rapidly
    keyframe_prop(ripple, "scale", 0, frame, 0.1, 'BEZIER')
    keyframe_prop(ripple, "scale", 1, frame, 0.1, 'BEZIER')
    keyframe_prop(ripple, "scale", 2, frame, 0.1, 'BEZIER')
    
    keyframe_prop(ripple, "scale", 0, frame + 15, 20.0, 'BEZIER')
    keyframe_prop(ripple, "scale", 1, frame + 15, 20.0, 'BEZIER')
    keyframe_prop(ripple, "scale", 2, frame + 15, 0.1, 'BEZIER')
    
    # Control visibility range
    ripple.hide_viewport = True
    ripple.hide_render = True
    ripple.keyframe_insert(data_path="hide_viewport", frame=0)
    ripple.keyframe_insert(data_path="hide_render", frame=0)
    
    ripple.hide_viewport = False
    ripple.hide_render = False
    ripple.keyframe_insert(data_path="hide_viewport", frame=frame)
    ripple.keyframe_insert(data_path="hide_render", frame=frame)
    
    ripple.hide_viewport = True
    ripple.hide_render = True
    ripple.keyframe_insert(data_path="hide_viewport", frame=frame + 16)
    ripple.keyframe_insert(data_path="hide_render", frame=frame + 16)
    
    mat_ripple = create_emission_material("MatRipple", COLOR_BLUE_GLOW, 8.0)
    ripple.data.materials.append(mat_ripple)

# ==========================================
# LIGHTING & CAMERA RIG
# ==========================================
def setup_lighting():
    """Sets up a professional studio lighting rig for soft shadows and clean white backgrounds."""
    # Key light
    bpy.ops.object.light_add(type='AREA', radius=6, location=(8, -10, 10))
    key = bpy.context.active_object
    key.name = "KeyLight"
    key.data.energy = 800
    
    # Fill light
    bpy.ops.object.light_add(type='AREA', radius=8, location=(-8, -8, 8))
    fill = bpy.context.active_object
    fill.name = "FillLight"
    fill.data.energy = 400
    
    # Subtle rim/backlight
    bpy.ops.object.light_add(type='AREA', radius=4, location=(0, 8, 8))
    back = bpy.context.active_object
    back.name = "BackLight"
    back.data.energy = 250

def setup_camera_rig():
    """Creates a cinematic camera following a target empty for dynamic parallax and DOF."""
    # Create target empty
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0))
    target = bpy.context.active_object
    target.name = "CameraTarget"
    
    # Create camera
    bpy.ops.camera.preset_add()
    camera_obj = bpy.context.active_object
    camera_obj.name = "CinematicCamera"
    camera_obj.location = (0, -12, 4)
    bpy.context.scene.camera = camera_obj
    
    # Dynamic DOF configuration
    camera = camera_obj.data
    camera.dof.use_dof = True
    camera.dof.focus_object = target
    camera.dof.aperture_fstop = 2.0  # Shallow depth of field for cinematic focus
    
    # Smooth tracking constraint
    track = camera_obj.constraints.new(type='TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    
    return camera_obj, target

# ==========================================
# COMMERCIAL STAGES (SCENES 1-7)
# ==========================================

def build_commercial():
    """Master builder function executing procedural animation stages."""
    clear_scene()
    setup_render_settings()
    setup_lighting()
    
    # Set up global background plane
    backdrop = create_rounded_plane("Backdrop", 30, 20, 0, thickness=0.0, 
                                    material=create_principled_material("MatBackdrop", COLOR_BG, roughness=0.9))
    backdrop.location = (0, 0, -2.0)
    
    # Instantiate camera rig
    camera, target = setup_camera_rig()
    
    # Spawning materials
    mat_dark = create_principled_material("MatDark", COLOR_DARK, roughness=0.3)
    mat_blue = create_principled_material("MatBlue", COLOR_BLUE, roughness=0.2)
    mat_blue_glow = create_emission_material("MatBlueGlow", COLOR_BLUE_GLOW, 6.0)
    mat_orange = create_principled_material("MatOrange", COLOR_ORANGE, roughness=0.2)
    mat_red = create_principled_material("MatRed", COLOR_RED, roughness=0.2)
    mat_light_grey = create_principled_material("MatLightGrey", COLOR_LIGHT_GREY, roughness=0.4)
    
    # Universal Cursor (The Protagonist)
    cursor = create_rounded_plane("Cursor", 0.05, 0.35, 0.015, thickness=0.01, material=mat_blue)
    cursor.location = (-3.5, 0.0, 0.05)
    
    # Camera path keys (frame, camera_loc, target_loc)
    camera_path = [
        (0, (0.0, -12.0, 4.0), (0.0, 0.0, 0.0)),
        (120, (1.2, -7.0, 2.0), (1.2, 0.0, 0.0)),
        (180, (0.6, -3.5, 1.2), (0.6, 0.0, 0.0)),
        (240, (0.0, -8.0, 2.5), (0.0, 0.0, 0.0)),
        (270, (-1.5, -6.0, 3.0), (-0.5, 0.0, 0.5)),
        (320, (0.0, -9.0, 4.5), (0.0, 5.0, 1.5)),
        (360, (0.0, -12.0, 3.0), (0.0, 1.0, 0.5)),
        (420, (-1.0, -8.0, 2.0), (-1.0, 0.0, 0.0)),
        (480, (0.0, -11.0, 3.0), (0.0, 0.0, 0.0)),
        (540, (0.0, -7.5, 1.5), (0.0, 0.0, 0.5)),
        (600, (0.0, -9.5, 2.0), (0.0, 0.0, 0.5)),
        (660, (0.0, -22.0, 6.0), (0.0, 0.0, 1.0)),
        (720, (0.0, -17.0, 4.0), (0.0, 0.0, 0.8)),
        (730, (0.0, -10.0, 0.0), (0.0, 0.0, 0.0)),
        (810, (0.0, -10.0, 0.0), (0.0, 0.0, 0.0))
    ]
    for frame, c_loc, t_loc in camera_path:
        for i in range(3):
            keyframe_prop(camera, "location", i, frame, c_loc[i], 'BEZIER')
            keyframe_prop(target, "location", i, frame, t_loc[i], 'BEZIER')

    # ==========================================
    # SCENE 1: TYPEWRITER & TIMELINE TRANSFORMATION (0 - 120)
    # ==========================================
    scene1_grp = bpy.data.objects.new("Scene1_Group", None)
    bpy.context.scene.collection.objects.link(scene1_grp)
    
    # Substrings typewriter logic
    raw_filename = "podcast_raw_v23.mp4"
    type_objs = []
    start_type = 10
    char_delay = 3
    
    for i in range(1, len(raw_filename) + 1):
        visible_f = start_type + (i - 1) * char_delay
        text_obj = create_text_object(f"Typ_Char_{i}", raw_filename[:i], (-3.5, 0.0, 0.05), 
                                      scale=0.5, extrude=0.01, bevel=0.002, material=mat_dark, parent=scene1_grp)
        # Typewriter visibility masks
        text_obj.hide_viewport = True
        text_obj.hide_render = True
        text_obj.keyframe_insert(data_path="hide_viewport", frame=0)
        text_obj.keyframe_insert(data_path="hide_render", frame=0)
        
        text_obj.hide_viewport = False
        text_obj.hide_render = False
        text_obj.keyframe_insert(data_path="hide_viewport", frame=visible_f)
        text_obj.keyframe_insert(data_path="hide_render", frame=visible_f)
        
        if i < len(raw_filename):
            next_visible_f = start_type + i * char_delay
            text_obj.hide_viewport = True
            text_obj.hide_render = True
            text_obj.keyframe_insert(data_path="hide_viewport", frame=next_visible_f)
            text_obj.keyframe_insert(data_path="hide_render", frame=next_visible_f)
        else:
            # Hide final complete text block when shifting to timeline
            text_obj.hide_viewport = True
            text_obj.hide_render = True
            text_obj.keyframe_insert(data_path="hide_viewport", frame=85)
            text_obj.keyframe_insert(data_path="hide_render", frame=85)
            
        type_objs.append(text_obj)
        
    # Animate cursor matching text entry
    cursor.parent = scene1_grp
    keyframe_prop(cursor, "location", 0, 0, -3.5)
    keyframe_prop(cursor, "location", 1, 0, 0.0)
    
    for i in range(1, len(raw_filename) + 1):
        x_offset = -3.5 + (i * 0.23)
        cursor_f = start_type + (i - 1) * char_delay
        keyframe_prop(cursor, "location", 0, cursor_f, x_offset)
        
    # Cursor blink
    for f in range(0, 80, 10):
        val = (1.0, 1.0, 1.0) if (f // 10) % 2 == 0 else (0.0, 0.0, 0.0)
        keyframe_prop(cursor, "scale", 0, f, val[0], 'CONSTANT')
        keyframe_prop(cursor, "scale", 1, f, val[1], 'CONSTANT')
        keyframe_prop(cursor, "scale", 2, f, val[2], 'CONSTANT')
        
    # Shrink/Transition Scene 1 Group
    keyframe_prop(scene1_grp, "scale", 0, 80, 1.0)
    keyframe_prop(scene1_grp, "scale", 1, 80, 1.0)
    keyframe_prop(scene1_grp, "scale", 2, 80, 1.0)
    
    keyframe_prop(scene1_grp, "scale", 0, 95, 0.0, 'BEZIER')
    keyframe_prop(scene1_grp, "scale", 1, 95, 0.0, 'BEZIER')
    keyframe_prop(scene1_grp, "scale", 2, 95, 0.0, 'BEZIER')

    # ==========================================
    # SCENE 2: MAGNET Snapping timeline & "Remove Silence" (120 - 240)
    # ==========================================
    scene2_grp = bpy.data.objects.new("Scene2_Group", None)
    bpy.context.scene.collection.objects.link(scene2_grp)
    
    # Set scene 2 timeline scale entry
    scene2_grp.scale = (0.0, 0.0, 0.0)
    keyframe_prop(scene2_grp, "scale", 0, 80, 0.0)
    keyframe_prop(scene2_grp, "scale", 1, 80, 0.0)
    keyframe_prop(scene2_grp, "scale", 2, 80, 0.0)
    
    keyframe_prop(scene2_grp, "scale", 0, 100, 1.0, 'BEZIER')
    keyframe_prop(scene2_grp, "scale", 1, 100, 1.0, 'BEZIER')
    keyframe_prop(scene2_grp, "scale", 2, 100, 1.0, 'BEZIER')
    
    # Hide after Scene 2 finishes
    keyframe_prop(scene2_grp, "scale", 0, 235, 1.0)
    keyframe_prop(scene2_grp, "scale", 0, 245, 0.0, 'BEZIER')
    keyframe_prop(scene2_grp, "scale", 1, 245, 0.0, 'BEZIER')
    keyframe_prop(scene2_grp, "scale", 2, 245, 0.0, 'BEZIER')

    # "Remove Silence" modern UI button
    btn = create_rounded_plane("BtnRemoveSilence", 1.2, 0.3, 0.08, thickness=0.03, material=mat_light_grey)
    btn.location = (2.2, 2.0, 0.05)
    btn.parent = scene2_grp
    btn_text = create_text_object("TxtRemoveSilence", "Remove Silence", (2.2, 2.0, 0.09), 
                                  scale=0.18, extrude=0.01, bevel=0.001, material=mat_dark, parent=scene2_grp)
    
    # Build 3 separate timeline segments representing raw clip with silence gaps
    clip1 = create_rounded_plane("Clip_1", 1.2, 0.4, 0.08, thickness=0.04, material=mat_light_grey)
    clip1.location = (-2.0, 0.0, 0.02)
    clip1.parent = scene2_grp
    
    clip2 = create_rounded_plane("Clip_2", 0.9, 0.4, 0.08, thickness=0.04, material=mat_light_grey)
    clip2.location = (0.8, 0.0, 0.02)
    clip2.parent = scene2_grp
    
    clip3 = create_rounded_plane("Clip_3", 0.7, 0.4, 0.08, thickness=0.04, material=mat_light_grey)
    clip3.location = (2.9, 0.0, 0.02)
    clip3.parent = scene2_grp
    
    # Waveform procedural peaks in segments
    def populate_peaks(parent, width, offset_x):
        peaks_grp = bpy.data.objects.new(f"Peaks_{parent.name}", None)
        bpy.context.scene.collection.objects.link(peaks_grp)
        peaks_grp.parent = parent
        peaks_grp.location = (offset_x, 0, 0.05)
        num_bars = int(width * 15)
        for i in range(num_bars):
            h = abs(math.sin(i * 0.4)) * 0.28 + random.uniform(0.02, 0.06)
            bar = create_rounded_plane(f"Bar_{parent.name}_{i}", 0.02, h, 0.005, thickness=0.005, material=mat_blue)
            bar.parent = peaks_grp
            bar.location = ((-width / 2) + (i * 0.065), 0, 0.0)
            
    populate_peaks(clip1, 2.0, 0.0)
    populate_peaks(clip2, 1.4, 0.0)
    populate_peaks(clip3, 1.1, 0.0)
    
    # Spawn warning red zones on gaps before deletion
    gap1 = create_rounded_plane("Gap_1", 0.5, 0.4, 0.02, thickness=0.01, material=mat_red)
    gap1.location = (-0.5, 0.0, 0.025)
    gap1.parent = scene2_grp
    
    gap2 = create_rounded_plane("Gap_2", 0.35, 0.4, 0.02, thickness=0.01, material=mat_red)
    gap2.location = (1.9, 0.0, 0.025)
    gap2.parent = scene2_grp
    
    # Transition cursor from scene 1 typing to button click
    cursor2 = create_rounded_plane("CursorS2", 0.06, 0.06, 0.03, thickness=0.01, material=mat_blue)
    cursor2.parent = scene2_grp
    
    # Cursor path
    cursor_keys = [
        (100, (-2.5, -1.0, 0.1)),
        (130, (2.2, 2.0, 0.1)),
        (135, (2.2, 2.0, 0.05)),   # Click
        (140, (2.2, 2.0, 0.1)),
        (160, (0.0, 0.0, 0.1))
    ]
    for frame, val in cursor_keys:
        for i in range(3):
            keyframe_prop(cursor2, "location", i, frame, val[i])
            
    # Keyframe Click Ripple & button reaction
    # Ripple frame 135
    bpy.app.timers.register(lambda: create_click_ripple((2.2, 2.0, 0.1), 135), first_interval=0.1)
    
    # Button press effect
    keyframe_prop(btn, "scale", 2, 133, 1.0)
    keyframe_prop(btn, "scale", 2, 135, 0.5, 'BEZIER')
    keyframe_prop(btn, "scale", 2, 138, 1.0, 'BEZIER')
    
    # Warning gaps flash red then contract and vanish
    keyframe_prop(gap1, "scale", 0, 145, 1.0)
    keyframe_prop(gap1, "scale", 1, 145, 1.0)
    keyframe_prop(gap1, "scale", 0, 160, 0.0, 'BEZIER')
    keyframe_prop(gap1, "scale", 1, 160, 0.0, 'BEZIER')
    
    keyframe_prop(gap2, "scale", 0, 145, 1.0)
    keyframe_prop(gap2, "scale", 1, 145, 1.0)
    keyframe_prop(gap2, "scale", 0, 160, 0.0, 'BEZIER')
    keyframe_prop(gap2, "scale", 1, 160, 0.0, 'BEZIER')
    
    # Magnetic snappy snap
    # Clip 1 stays static. Clip 2 moves left. Clip 3 moves left.
    keyframe_prop(clip2, "location", 0, 160, 0.8)
    keyframe_prop(clip2, "location", 0, 175, -0.9, 'BEZIER') # Snaps left to clip 1
    
    keyframe_prop(clip3, "location", 0, 165, 2.9)
    keyframe_prop(clip3, "location", 0, 182, -1.9, 'BEZIER') # Snaps left to clip 2
    
    # ==========================================
    # SCENE 3: HIGHLIGHT TEXT & FLYING CAPTIONS (240 - 360)
    # ==========================================
    scene3_grp = bpy.data.objects.new("Scene3_Group", None)
    bpy.context.scene.collection.objects.link(scene3_grp)
    scene3_grp.scale = (0.0, 0.0, 0.0)
    
    keyframe_prop(scene3_grp, "scale", 0, 240, 0.0)
    keyframe_prop(scene3_grp, "scale", 1, 240, 0.0)
    keyframe_prop(scene3_grp, "scale", 2, 240, 0.0)
    
    keyframe_prop(scene3_grp, "scale", 0, 250, 1.0, 'BEZIER')
    keyframe_prop(scene3_grp, "scale", 1, 250, 1.0, 'BEZIER')
    keyframe_prop(scene3_grp, "scale", 2, 250, 1.0, 'BEZIER')
    
    keyframe_prop(scene3_grp, "scale", 0, 350, 1.0)
    keyframe_prop(scene3_grp, "scale", 0, 360, 0.0, 'BEZIER')
    keyframe_prop(scene3_grp, "scale", 1, 360, 0.0, 'BEZIER')
    keyframe_prop(scene3_grp, "scale", 2, 360, 0.0, 'BEZIER')
    
    # Cursor for scene 3
    cursor3 = create_rounded_plane("CursorS3", 0.06, 0.06, 0.03, thickness=0.01, material=mat_blue)
    cursor3.parent = scene3_grp
    cursor3.location = (-3.0, 1.0, 0.1)
    
    # Transcript panel
    panel = create_rounded_plane("TranscriptPanel", 3.0, 1.8, 0.1, thickness=0.02, material=mat_light_grey)
    panel.location = (-1.0, 0.5, 0.0)
    panel.parent = scene3_grp
    
    t_lines = ["AI editing tools", "make captions fast."]
    create_text_object("TxtL1", t_lines[0], (-1.0, 0.7, 0.03), 0.25, 0.005, 0.001, mat_dark, scene3_grp)
    create_text_object("TxtL2", t_lines[1], (-1.0, 0.2, 0.03), 0.25, 0.005, 0.001, mat_dark, scene3_grp)
    
    # Yellow highlight block that slides over words
    highlight = create_rounded_plane("HighlightBox", 0.01, 0.25, 0.02, thickness=0.002, material=create_emission_material("MatHighlight", COLOR_BLUE_GLOW, 2.0))
    highlight.location = (-2.5, 0.7, 0.02)
    highlight.parent = scene3_grp
    
    # Highlight scaling to sweep words
    keyframe_prop(highlight, "scale", 0, 245, 0.1)
    keyframe_prop(highlight, "location", 0, 245, -2.5)
    keyframe_prop(highlight, "scale", 0, 260, 150.0, 'BEZIER')
    keyframe_prop(highlight, "location", 0, 260, -1.0, 'BEZIER')
    
    # "Generate Captions" Button
    btn_cap = create_rounded_plane("BtnGenerateCaptions", 1.2, 0.3, 0.08, thickness=0.03, material=mat_light_grey)
    btn_cap.location = (2.2, 1.0, 0.05)
    btn_cap.parent = scene3_grp
    btn_cap_txt = create_text_object("TxtGenerateCaptions", "Generate Captions", (2.2, 1.0, 0.09), 
                                      scale=0.15, extrude=0.01, bevel=0.001, material=mat_dark, parent=scene3_grp)
    
    # Cursor tracks click
    keyframe_prop(cursor3, "location", 0, 240, -3.0)
    keyframe_prop(cursor3, "location", 1, 240, 1.0)
    keyframe_prop(cursor3, "location", 0, 265, 2.2, 'BEZIER')
    keyframe_prop(cursor3, "location", 1, 265, 1.0, 'BEZIER')
    keyframe_prop(cursor3, "location", 2, 268, 0.05)
    keyframe_prop(cursor3, "location", 2, 272, 0.1)
    
    # Spawning click ripple 3
    bpy.app.timers.register(lambda: create_click_ripple((2.2, 1.0, 0.1), 268), first_interval=0.1)
    
    # Explosion of caption words
    words = ["TRANSFORMING", "VIDEO", "WITH", "AI"]
    word_objs = []
    
    for i, w in enumerate(words):
        w_obj = create_text_object(f"ExplodeWord_{w}", w, (0.0, 0.0, 0.0), 
                                   scale=0.5, extrude=0.08, bevel=0.01, material=mat_blue_glow, parent=scene3_grp)
        # Random initial explosion locations in background Z
        keyframe_prop(w_obj, "location", 0, 268, random.uniform(-4, 4))
        keyframe_prop(w_obj, "location", 1, 268, random.uniform(8, 12))
        keyframe_prop(w_obj, "location", 2, 268, random.uniform(2, 6))
        
        # Flying towards camera layout coords at frame 320
        keyframe_prop(w_obj, "location", 0, 310, (i - 1.5) * 1.5, 'BEZIER')
        keyframe_prop(w_obj, "location", 1, 310, 4.0, 'BEZIER')
        keyframe_prop(w_obj, "location", 2, 310, 1.0, 'BEZIER')
        
        # Settle sequence layout
        keyframe_prop(w_obj, "location", 0, 335, (i - 1.5) * 1.2, 'BEZIER')
        keyframe_prop(w_obj, "location", 1, 335, 1.0, 'BEZIER')
        keyframe_prop(w_obj, "location", 2, 335, 0.5, 'BEZIER')
        
        word_objs.append(w_obj)

    # ==========================================
    # SCENE 4: CREATE SHORTS & FORMAT SPLITTING (360 - 480)
    # ==========================================
    scene4_grp = bpy.data.objects.new("Scene4_Group", None)
    bpy.context.scene.collection.objects.link(scene4_grp)
    scene4_grp.scale = (0.0, 0.0, 0.0)
    
    keyframe_prop(scene4_grp, "scale", 0, 360, 0.0)
    keyframe_prop(scene4_grp, "scale", 1, 360, 0.0)
    keyframe_prop(scene4_grp, "scale", 2, 360, 0.0)
    
    keyframe_prop(scene4_grp, "scale", 0, 370, 1.0, 'BEZIER')
    keyframe_prop(scene4_grp, "scale", 1, 370, 1.0, 'BEZIER')
    keyframe_prop(scene4_grp, "scale", 2, 370, 1.0, 'BEZIER')
    
    keyframe_prop(scene4_grp, "scale", 0, 470, 1.0)
    keyframe_prop(scene4_grp, "scale", 0, 480, 0.0, 'BEZIER')
    keyframe_prop(scene4_grp, "scale", 1, 480, 0.0, 'BEZIER')
    keyframe_prop(scene4_grp, "scale", 2, 480, 0.0, 'BEZIER')
    
    # Cursor for scene 4
    cursor4 = create_rounded_plane("CursorS4", 0.06, 0.06, 0.03, thickness=0.01, material=mat_blue)
    cursor4.parent = scene4_grp
    cursor4.location = (-2.0, -1.0, 0.1)
    
    # Original timeline
    base_t = create_rounded_plane("BaseTimeline", 3.0, 0.35, 0.06, thickness=0.04, material=mat_light_grey)
    base_t.location = (0.0, 0.0, 0.0)
    base_t.parent = scene4_grp
    
    # "Create Shorts" Button
    btn_shorts = create_rounded_plane("BtnCreateShorts", 1.2, 0.3, 0.08, thickness=0.03, material=mat_light_grey)
    btn_shorts.location = (0.0, 1.8, 0.05)
    btn_shorts.parent = scene4_grp
    btn_shorts_txt = create_text_object("TxtCreateShorts", "Create Shorts", (0.0, 1.8, 0.09), 
                                        scale=0.18, extrude=0.01, bevel=0.001, material=mat_dark, parent=scene4_grp)
    
    # Cursor Action
    keyframe_prop(cursor4, "location", 0, 370, -2.0)
    keyframe_prop(cursor4, "location", 1, 370, -1.0)
    keyframe_prop(cursor4, "location", 0, 390, 0.0, 'BEZIER')
    keyframe_prop(cursor4, "location", 1, 390, 1.8, 'BEZIER')
    keyframe_prop(cursor4, "location", 2, 392, 0.05)
    keyframe_prop(cursor4, "location", 2, 395, 0.1)
    
    bpy.app.timers.register(lambda: create_click_ripple((0.0, 1.8, 0.1), 392), first_interval=0.1)
    
    # Branching Formats: 16:9 (Left), 9:16 (Center), 1:1 (Right)
    f_16_9 = create_rounded_plane("Format_16_9", 1.6, 0.9, 0.05, thickness=0.02, material=mat_light_grey)
    f_16_9.location = (-2.5, 0.0, 0.0)
    f_16_9.parent = scene4_grp
    f_16_9.scale = (0.0, 0.0, 0.0)
    
    f_9_16 = create_rounded_plane("Format_9_16", 0.7, 1.2, 0.05, thickness=0.02, material=mat_light_grey)
    f_9_16.location = (0.0, 0.0, 0.0)
    f_9_16.parent = scene4_grp
    f_9_16.scale = (0.0, 0.0, 0.0)
    
    f_1_1 = create_rounded_plane("Format_1_1", 1.1, 1.1, 0.05, thickness=0.02, material=mat_light_grey)
    f_1_1.location = (2.5, 0.0, 0.0)
    f_1_1.parent = scene4_grp
    f_1_1.scale = (0.0, 0.0, 0.0)
    
    # Shrink central timeline, expand formats
    keyframe_prop(base_t, "scale", 0, 400, 1.0)
    keyframe_prop(base_t, "scale", 1, 400, 1.0)
    keyframe_prop(base_t, "scale", 0, 420, 0.0, 'BEZIER')
    keyframe_prop(base_t, "scale", 1, 420, 0.0, 'BEZIER')
    
    for fmt in [f_16_9, f_9_16, f_1_1]:
        keyframe_prop(fmt, "scale", 0, 400, 0.0)
        keyframe_prop(fmt, "scale", 1, 400, 0.0)
        keyframe_prop(fmt, "scale", 0, 425, 1.0, 'BEZIER')
        keyframe_prop(fmt, "scale", 1, 425, 1.0, 'BEZIER')

    # ==========================================
    # SCENE 5: BUILDER PROFILE SEARCH & BADGES (480 - 600)
    # ==========================================
    scene5_grp = bpy.data.objects.new("Scene5_Group", None)
    bpy.context.scene.collection.objects.link(scene5_grp)
    scene5_grp.scale = (0.0, 0.0, 0.0)
    
    keyframe_prop(scene5_grp, "scale", 0, 480, 0.0)
    keyframe_prop(scene5_grp, "scale", 1, 480, 0.0)
    keyframe_prop(scene5_grp, "scale", 2, 480, 0.0)
    
    keyframe_prop(scene5_grp, "scale", 0, 490, 1.0, 'BEZIER')
    keyframe_prop(scene5_grp, "scale", 1, 490, 1.0, 'BEZIER')
    keyframe_prop(scene5_grp, "scale", 2, 490, 1.0, 'BEZIER')
    
    keyframe_prop(scene5_grp, "scale", 0, 595, 1.0)
    keyframe_prop(scene5_grp, "scale", 0, 605, 0.0, 'BEZIER')
    keyframe_prop(scene5_grp, "scale", 1, 605, 0.0, 'BEZIER')
    keyframe_prop(scene5_grp, "scale", 2, 605, 0.0, 'BEZIER')
    
    # Search input field
    search_bar = create_rounded_plane("SearchBar", 2.2, 0.35, 0.08, thickness=0.03, material=mat_light_grey)
    search_bar.location = (0.0, 1.8, 0.0)
    search_bar.parent = scene5_grp
    
    # Types "Yaz" inside search bar
    raw_search = "Yaz"
    for i in range(1, len(raw_search) + 1):
        visible_f = 500 + (i - 1) * 6
        search_txt = create_text_object(f"Search_Char_{i}", raw_search[:i], (-0.7, 1.8, 0.04), 
                                        scale=0.25, extrude=0.005, bevel=0.001, material=mat_dark, parent=scene5_grp)
        search_txt.hide_viewport = True
        search_txt.hide_render = True
        search_txt.keyframe_insert(data_path="hide_viewport", frame=0)
        search_txt.keyframe_insert(data_path="hide_render", frame=0)
        
        search_txt.hide_viewport = False
        search_txt.hide_render = False
        search_txt.keyframe_insert(data_path="hide_viewport", frame=visible_f)
        search_txt.keyframe_insert(data_path="hide_render", frame=visible_f)
        
        if i < len(raw_search):
            next_visible_f = 500 + i * 6
            search_txt.hide_viewport = True
            search_txt.hide_render = True
            search_txt.keyframe_insert(data_path="hide_viewport", frame=next_visible_f)
            search_txt.keyframe_insert(data_path="hide_render", frame=next_visible_f)
            
    # Central user profile node
    profile_node = create_rounded_plane("ProfileNode", 0.6, 0.6, 0.3, thickness=0.05, material=mat_blue)
    profile_node.location = (0.0, -0.2, 0.05)
    profile_node.parent = scene5_grp
    profile_node.scale = (0.0, 0.0, 0.0)
    
    keyframe_prop(profile_node, "scale", 0, 520, 0.0)
    keyframe_prop(profile_node, "scale", 0, 535, 1.0, 'BEZIER')
    keyframe_prop(profile_node, "scale", 1, 535, 1.0, 'BEZIER')
    keyframe_prop(profile_node, "scale", 2, 535, 1.0, 'BEZIER')
    
    # Surrounding orbiting badges
    badges_data = [
        ("World Champion", (-2.2, 0.6, 0.05), COLOR_ORANGE),
        ("Builder", (-2.0, -0.8, 0.05), COLOR_GREEN),
        ("Mentor", (-1.2, -1.8, 0.05), COLOR_BLUE),
        ("Creator", (1.2, -1.8, 0.05), COLOR_ORANGE),
        ("Projects", (2.0, -0.8, 0.05), COLOR_GREEN),
        ("Badges", (2.2, 0.6, 0.05), COLOR_BLUE)
    ]
    
    badge_objs = []
    for idx, (label, loc, col) in enumerate(badges_data):
        mat_badge = create_principled_material(f"MatBadge_{idx}", col, roughness=0.3)
        b_bg = create_rounded_plane(f"BadgeBG_{idx}", 0.9, 0.25, 0.05, thickness=0.02, material=mat_light_grey)
        b_bg.location = loc
        b_bg.parent = scene5_grp
        b_bg.scale = (0.0, 0.0, 0.0)
        
        # Staggered entry
        entry_f = 530 + (idx * 5)
        keyframe_prop(b_bg, "scale", 0, entry_f, 0.0)
        keyframe_prop(b_bg, "scale", 0, entry_f + 15, 1.0, 'BEZIER')
        keyframe_prop(b_bg, "scale", 1, entry_f + 15, 1.0, 'BEZIER')
        
        b_txt = create_text_object(f"BadgeTxt_{idx}", label, (loc[0], loc[1], loc[2] + 0.03), 
                                   scale=0.12, extrude=0.005, bevel=0.001, material=mat_badge, parent=scene5_grp)
        b_txt.scale = (0.0, 0.0, 0.0)
        keyframe_prop(b_txt, "scale", 0, entry_f + 5, 0.0)
        keyframe_prop(b_txt, "scale", 0, entry_f + 20, 1.0, 'BEZIER')
        keyframe_prop(b_txt, "scale", 1, entry_f + 20, 1.0, 'BEZIER')
        
        badge_objs.append(b_bg)
        
    # Orbiting / sinusoidal motion logic
    for frame in range(540, 600, 2):
        phase = frame * 0.08
        # Orbiting coordinates mapping
        for idx, bg_obj in enumerate(badge_objs):
            offset_y = math.sin(phase + idx) * 0.05
            offset_z = math.cos(phase + idx) * 0.02
            # Add dynamic loc offset keys
            keyframe_prop(bg_obj, "location", 1, frame, badges_data[idx][1][1] + offset_y)
            keyframe_prop(bg_obj, "location", 2, frame, badges_data[idx][1][2] + offset_z)

    # ==========================================
    # SCENE 6: COMPONENT CONVERGENCE & LOGO ASSEMBLY (600 - 720)
    # ==========================================
    scene6_grp = bpy.data.objects.new("Scene6_Group", None)
    bpy.context.scene.collection.objects.link(scene6_grp)
    scene6_grp.scale = (0.0, 0.0, 0.0)
    
    keyframe_prop(scene6_grp, "scale", 0, 600, 0.0)
    keyframe_prop(scene6_grp, "scale", 0, 610, 1.0, 'BEZIER')
    keyframe_prop(scene6_grp, "scale", 1, 610, 1.0, 'BEZIER')
    
    keyframe_prop(scene6_grp, "scale", 0, 715, 1.0)
    keyframe_prop(scene6_grp, "scale", 0, 725, 0.0, 'BEZIER')
    keyframe_prop(scene6_grp, "scale", 1, 725, 0.0, 'BEZIER')
    
    # Spawn a massive cluster of particles/blocks representing the previous design elements
    debris = []
    num_debris = 32
    for i in range(num_debris):
        color_choice = random.choice([COLOR_BLUE, COLOR_ORANGE, COLOR_GREEN, COLOR_LIGHT_GREY])
        mat_d = create_principled_material(f"MatDebris_{i}", color_choice, roughness=0.3)
        deb = create_rounded_plane(f"Debris_{i}", 0.25, 0.12, 0.03, thickness=0.02, material=mat_d)
        deb.parent = scene6_grp
        
        # Position randomized in a cloud around the camera
        init_loc = (random.uniform(-6, 6), random.uniform(2, 6), random.uniform(-3, 3))
        keyframe_prop(deb, "location", 0, 600, init_loc[0])
        keyframe_prop(deb, "location", 1, 600, init_loc[1])
        keyframe_prop(deb, "location", 2, 600, init_loc[2])
        
        # Pulling back convergence towards Center (0.0, 1.5, 0.5)
        keyframe_prop(deb, "location", 0, 665, 0.0, 'BEZIER')
        keyframe_prop(deb, "location", 1, 665, 1.5, 'BEZIER')
        keyframe_prop(deb, "location", 2, 665, 0.5, 'BEZIER')
        
        # Disappear/shrink out
        keyframe_prop(deb, "scale", 0, 655, 1.0)
        keyframe_prop(deb, "scale", 0, 670, 0.0, 'BEZIER')
        keyframe_prop(deb, "scale", 1, 670, 0.0, 'BEZIER')
        
        debris.append(deb)
        
    # Letters of "CUTFLOW"
    logo_letters = ["C", "U", "T", "F", "L", "O", "W"]
    letter_objs = []
    
    for idx, char in enumerate(logo_letters):
        letter_obj = create_text_object(f"Logo_{char}", char, ((idx - 3) * 0.9, 1.5, 0.5), 
                                        scale=1.2, extrude=0.15, bevel=0.015, material=mat_blue_glow, parent=scene6_grp)
        letter_obj.scale = (0.0, 0.0, 0.0)
        
        # Staggered entry from converged debris center
        entry_f = 650 + (idx * 5)
        keyframe_prop(letter_obj, "scale", 0, entry_f, 0.0)
        keyframe_prop(letter_obj, "scale", 0, entry_f + 20, 1.2, 'BEZIER') # Overshoot
        keyframe_prop(letter_obj, "scale", 0, entry_f + 30, 1.0, 'BEZIER') # Settle
        
        keyframe_prop(letter_obj, "scale", 1, entry_f, 0.0)
        keyframe_prop(letter_obj, "scale", 1, entry_f + 20, 1.2, 'BEZIER')
        keyframe_prop(letter_obj, "scale", 1, entry_f + 30, 1.0, 'BEZIER')
        
        letter_objs.append(letter_obj)

    # ==========================================
    # SCENE 7: FINAL CALL TO ACTION (720 - 810)
    # ==========================================
    scene7_grp = bpy.data.objects.new("Scene7_Group", None)
    bpy.context.scene.collection.objects.link(scene7_grp)
    scene7_grp.scale = (0.0, 0.0, 0.0)
    
    keyframe_prop(scene7_grp, "scale", 0, 715, 0.0)
    keyframe_prop(scene7_grp, "scale", 0, 725, 1.0, 'BEZIER')
    keyframe_prop(scene7_grp, "scale", 1, 725, 1.0, 'BEZIER')
    
    # Final target text: cutflow.ai/you
    cta_string = "cutflow.ai/you"
    cta_objs = []
    
    start_cta = 735
    cta_delay = 4
    
    for i in range(1, len(cta_string) + 1):
        visible_f = start_cta + (i - 1) * cta_delay
        # Pause before "you"
        if i > 11:
            visible_f += 10 # 10 frames pause
            
        txt_obj = create_text_object(f"CTA_Char_{i}", cta_string[:i], (-2.5, 0.0, 0.05), 
                                     scale=0.7, extrude=0.02, bevel=0.004, material=mat_dark, parent=scene7_grp)
        txt_obj.hide_viewport = True
        txt_obj.hide_render = True
        txt_obj.keyframe_insert(data_path="hide_viewport", frame=0)
        txt_obj.keyframe_insert(data_path="hide_render", frame=0)
        
        txt_obj.hide_viewport = False
        txt_obj.hide_render = False
        txt_obj.keyframe_insert(data_path="hide_viewport", frame=visible_f)
        txt_obj.keyframe_insert(data_path="hide_render", frame=visible_f)
        
        if i < len(cta_string):
            next_visible_f = start_cta + i * cta_delay
            if i >= 11:
                next_visible_f += 10
            txt_obj.hide_viewport = True
            txt_obj.hide_render = True
            txt_obj.keyframe_insert(data_path="hide_viewport", frame=next_visible_f)
            txt_obj.keyframe_insert(data_path="hide_render", frame=next_visible_f)
            
        cta_objs.append(txt_obj)
        
    # CTA Cursor
    cursor7 = create_rounded_plane("CursorS7", 0.06, 0.5, 0.02, thickness=0.01, material=mat_blue)
    cursor7.parent = scene7_grp
    
    keyframe_prop(cursor7, "location", 0, 720, -2.5)
    keyframe_prop(cursor7, "location", 1, 720, 0.0)
    
    # Trace typing steps
    for i in range(1, len(cta_string) + 1):
        cursor_f = start_cta + (i - 1) * cta_delay
        if i > 11:
            cursor_f += 10
        x_offset = -2.5 + (i * 0.35)
        keyframe_prop(cursor7, "location", 0, cursor_f, x_offset)
        
    # Constant blinks at final frames holding state
    for f in range(720, 810, 8):
        val = (1.0, 1.0, 1.0) if (f // 8) % 2 == 0 else (0.0, 0.0, 0.0)
        keyframe_prop(cursor7, "scale", 0, f, val[0], 'CONSTANT')
        keyframe_prop(cursor7, "scale", 1, f, val[1], 'CONSTANT')
        keyframe_prop(cursor7, "scale", 2, f, val[2], 'CONSTANT')

    # ==========================================
    # COMPOSITOR SETUP (GLOW & LENS EFFECTS)
    # ==========================================
    bpy.context.scene.use_nodes = True
    comp_nodes = bpy.context.scene.node_tree.nodes
    comp_links = bpy.context.scene.node_tree.links
    comp_nodes.clear()
    
    # Render layers node
    node_render = comp_nodes.new(type='CompositorNodeRLayers')
    
    # Fog Glow (Glare) node for high-end startup aesthetic
    node_glare = comp_nodes.new(type='CompositorNodeGlare')
    node_glare.glare_type = 'FOG_GLOW'
    node_glare.quality = 'HIGH'
    node_glare.threshold = 0.5
    node_glare.size = 7
    
    # Subtle Chromatic Aberration (Lens Distortion)
    node_distort = comp_nodes.new(type='CompositorNodeLensdist')
    node_distort.inputs['Dispersion'].default_value = 0.015  # Soft visual borders
    
    # Composite output node
    node_output = comp_nodes.new(type='CompositorNodeComposite')
    
    # Hook everything up
    comp_links.new(node_render.outputs['Image'], node_glare.inputs['Image'])
    comp_links.new(node_glare.outputs['Image'], node_distort.inputs['Image'])
    comp_links.new(node_distort.outputs['Image'], node_output.inputs['Image'])

if __name__ == "__main__":
    build_commercial()
