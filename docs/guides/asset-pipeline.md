# Asset pipeline

All 3D assets come from **CC0 kits**. They are assembled and baked in Blender and exported as
glTF with KTX2 textures. The pipeline is reproducible from source, driven by `assets/manifest.toml`
([ADR-0017](../adr/0017-asset-pipeline-cc0-blender-gltf.md)). Feature: FEAT-029.

Status: planned (M9). Until then, `apps/game/src/render/office.ts` builds procedural placeholder
geometry with the same handle API.

## Layout

```
assets/
├── kits/                    CC0 sources (Git LFS), one folder per kit, each with SOURCES.md
│   ├── kenney-furniture/
│   ├── quaternius-office/
│   ├── quaternius-characters/
│   └── polyhaven/           materials and HDRIs
├── blender/
│   ├── rooms/               room modules: <kind>-<w>x<d>.blend (walls, floor, windows, built-ins)
│   ├── props/               desk.blend, desk-lamp.blend, moodboard-wall.blend, …
│   └── characters/          base rig + retargeted animation library
├── scripts/                 bake.py, export.py (Blender --background)
├── manifest.toml            every exported asset
└── out/                     build output (git-ignored; CI artifact and CDN upload)
```

## Conventions

- **Grid:** 1 Blender unit = 1 m. Room modules snap to a 1 m grid, and the origin sits at the
  module's north-west floor corner.
- **Axes:** +X east, +Z south in the game (glTF +Y up). Export with "+Y up".
- **Names:**
  - object names equal manifest ids;
  - emissive screen surfaces are named `*_screen`;
  - lamp shades `*_shade`;
  - light anchors are empties named `light_*`;
  - seat anchors `seat_*`.

  The client finds these by name to attach sim-driven materials and lights.
- **Materials:** PBR metallic-roughness only. Albedo in sRGB; normal, ORM and lightmap in linear.
- **UVs:**
  - UV0 for materials;
  - **UV2 for the lightmap**: non-overlapping, 4 px padding at 1024².

## Manifest

```toml
[[module]]
id = "room.newsroom.10x10"
source = "blender/rooms/newsroom-10x10.blend"
sim_kind = "Newsroom"
footprint = [10, 10]
lightmap = { size = 1024, samples = 512 }
lods = [1.0, 0.5]

[[prop]]
id = "prop.desk-lamp"
source = "blender/props/desk-lamp.blend"
sim_device = "DeskLamp"
footprint = [1, 1]
collision = "box"

[[character]]
id = "char.base"
source = "blender/characters/base.blend"
clips = ["idle", "walk", "sit", "type", "talk", "listen", "think", "present", "sleep", "celebrate", "frustrated", "carry"]
```

## Bake and export

```sh
cargo xtask assets            # changed modules only (source hash recorded in assets/out/.hashes)
cargo xtask assets --all      # everything
```

For each module, `bake.py` (Blender in background mode, Cycles):
1. Bakes a **lightmap** to UV2, assuming interior lights on and neutral overcast daylight.
2. Bakes **AO**.
3. Packs both into the module's lightmap texture.

`export.py` then writes glTF 2.0 with:
- **KTX2/Basis** textures: UASTC for normal maps, ETC1S for albedo and ORM;
- **meshopt** geometry compression (`EXT_meshopt_compression`);
- the lightmap as a separate texture referenced by extras, which the client binds as
  `lightmapTexture` with `useLightmapAsShadowmap`.

At runtime the client scales the lightmap by the room's light state
([lighting-and-rendering.md](../architecture/lighting-and-rendering.md)).

## Characters

- One base mesh family with a Mixamo-compatible rig.
- Animations are retargeted in Blender onto the shared clip list above.
- Personas differ by palette, hair and props, not by skeleton.
- Skinned meshes are exported with at most 4 influences per vertex.

## Licensing

- Only CC0 sources.
- Every kit folder has a `SOURCES.md` with the URL, version, licence and download date.
- CI checks that every manifest `source` resolves to a kit, or to an original `.blend` in
  `assets/blender/`.

## Budgets (tracked as `cockpit.benchmark.v1`, `bench/bundle-size`)

| Asset | Budget |
|---|---|
| Room module glTF + textures | ≤ 1.5 MB each |
| Prop | ≤ 300 KB each |
| Character with all clips | ≤ 2.5 MB |
| Initial download (L1 building + 5 characters) | ≤ 20 MB |

`assets/out/**` is excluded from Cockpit's implementation paths, so regenerated assets never mark
features stale.
