# Gear Designer — plan

A browser tool for designing wooden gears and meshing pairs, then printing 1:1 cutting templates or exporting DXF/SVG. It's the third workshop tool after Serpentine and Star Knobs, and is built on [`workshop-kit`](https://github.com/tomkail/workshop-kit).

## Decisions so far

- **Name:** Gear Designer.
- **Tools:** CNC and laser would be ideal, but the shop is basic. Defaults target a bandsaw or scroll saw, drill and files, with a printed template. CNC and laser outputs are kept but aren't the priority.
- **Scope now:** basic spur gears, with meshing pairs from the first milestone.
- **Scope later:** all gear types, so the model is built around swappable gear kinds from the start (see [Gear kinds](#gear-kinds)).
- **Clocks:** not for now; cycloidal teeth and lantern pinions move to Later.
- **Units:** decided below, in [Units](#units).

## What it should feel like

[geargenerator.com](https://geargenerator.com/) is the model for the canvas: drag gears around, they snap into mesh, and the whole train turns. [Evolvent Design's spur gear generator](https://evolventdesign.com/pages/spur-gear-generator) is the model for precision: proper parameters, correct involute teeth and clean exports. Gears should combine the two, with woodworking defaults and output that prints at true size.

It should look and behave like Serpentine and Star Knobs: the same themes, floating toolbar, parameter panel, dot grid, and pan/zoom.

## Woodworking constraints that shape the defaults

Wooden gears are not scaled-down metal gears:

- **Big teeth.** Wood needs large teeth to survive. The default module is 4 mm, with a warning below about 2.5 mm, and inch users get diametral pitch (DP).
- **Pressure angle 20°, with 25° offered.** Higher angles give stronger, stubbier teeth and allow fewer teeth before undercut.
- **Generous clearance.** Default backlash is about 0.1 × module, plus extra root clearance, because wood moves and saw cuts wander.
- **Cutting method sets the limits.** Scroll saw / bandsaw is the default: round the tooth tips and root corners, and keep the smallest inside radius above what the blade can turn. CNC (bit radius as minimum inside radius) and laser (kerf offset) come later as options.
- **Drill the roots first.** This is the basic-tools trick that matters most, like the scallops on Star Knobs. The template marks a drill centre in every tooth gap, sized so a standard bit forms the rounded root. You drill all the gaps in square stock, then saw the flanks out to each hole, and sand to the line. The root radius snaps to standard bit sizes.
- **Grain.** Short grain across teeth breaks. The template shows a grain-direction arrow, and plywood is suggested for small tooth counts.
- **Arbor.** Centre bore, with an optional flat or keyway. Spokes and lightening holes are an option.
- **Clocks.** Traditional wooden clocks use **cycloidal** teeth and **lantern pinions**. Not needed now, but the gear-kind design leaves room for them.

## Units

Store everything in millimetres, and describe tooth size by **module** (pitch diameter ÷ teeth).
- **Metric users** (the default outside the US, as in Star Knobs) see module.
- **Inch users** see diametral pitch (teeth per inch of pitch diameter, DP = 25.4 ÷ module) and inch dimensions.
- **Everyone** also sees **circular pitch**, the tooth-to-tooth distance along the pitch circle, in both mm and inches. It's the size you can actually measure with a ruler, so it's the easiest way to judge tooth size without knowing the jargon.
- **Input:** module and DP can both be typed in either mode, and the tooth-size field has plain presets such as "small (m3)", "medium (m4)" and "chunky (m6)".

## Gear maths (spur, external, involute)

Symbols: module *m*, teeth *z*, pressure angle *α*, profile shift coefficient *x*, backlash *j*.

| Quantity | Formula |
| --- | --- |
| Pitch diameter | d = m·z |
| Base diameter | d_b = d·cos α |
| Addendum / dedendum | h_a = m(1 + x), h_f = m(1.25 − x) |
| Tip / root diameter | d_a = d + 2h_a, d_f = d − 2h_f |
| Tooth thickness at pitch circle | s = m(π/2 + 2x·tan α) − j |
| Involute (roll angle t) | (r_b(cos t + t·sin t), r_b(sin t − t·cos t)) |
| Involute function | inv α = tan α − α |
| Minimum teeth without undercut | z_min = 2 / sin²α (≈ 17 at 20°, ≈ 12 at 25°) |
| Shift needed to avoid undercut | x_min = 1 − z·sin²α / 2 |
| Standard centre distance | a = m(z₁ + z₂) / 2 |
| Working pressure angle with shift | inv α_w = 2·tan α·(x₁ + x₂)/(z₁ + z₂) + inv α |
| Centre distance with shift | a = m(z₁ + z₂)·cos α / (2·cos α_w) |
| Contact ratio | ε = [√(r_a1² − r_b1²) + √(r_a2² − r_b2²) − a·sin α_w] / (π·m·cos α) |
| Ratio / speed | i = z₂ / z₁, ω₂ = −ω₁·z₁ / z₂ |

**Meshing phase.** Tooth 0 of each gear sits on its +x axis at rotation 0. Gear 2's centre lies at angle φ from gear 1's. For gear 2 to mesh with gear 1:

θ₂ = φ + π + π/z₂ − (z₁/z₂)(θ₁ − φ)

When gear 1 has a tooth pointing along the line of centres, gear 2 has a gap there. Differentiating gives the correct counter-rotation, dθ₂/dθ₁ = −z₁/z₂. Solve this down the train from the driver each animation frame.

**Profile.** Each flank is the involute from the base circle (or the root, if that's larger) out to the tip. It's joined to a root fillet (trochoid or circular approximation) and a tip arc, and mirrored about the tooth centreline. The half-tooth angle at the pitch circle is s/d; the flank starts on the base circle at s/d + inv α from the centreline.

**Output curves.** workshop-kit's drawing model has lines, arcs and cubic Béziers. Fit each involute flank with 2–4 cubic Béziers, so SVG and PDF stay smooth and small. Check the fit error against the true curve in tests (target below 0.01 mm). DXF already flattens cubics.

**Warnings.** Show undercut (z below z_min and no shift), tooth tips narrower than about 0.25m, contact ratio under 1.2 (wood should aim for at least 1.4), teeth under the woodworking minimum, and inside radii below the chosen blade or bit radius.

## Features by milestone

### M1 — Spur gear and meshing pair (MVP)
- [x] Scaffold with Vite 8 and React 18, the same way as Star Knobs. Depend on `github:tomkail/workshop-kit#v0.1.0` and deploy to GitHub Pages.
- [x] Involute geometry module, with tests for the base circle, tooth thickness, symmetry, closure and Bézier fit error.
- [x] Parameter panel (spokes, lightening holes and hub circle still to do):
  - teeth, module or DP, pressure angle, profile shift (with an "auto, avoid undercut" button), backlash
  - root fillet and tip rounding
  - bore with optional flat or key, hub circle, spokes or lightening holes
- [x] Canvas: the gear with pitch, base, tip and root circles drawn as construction lines, dimension labels, and draggable handles for tooth count and size.
- [x] Root drilling marks: a drill centre and bit size for every tooth gap, snapped to standard bits.
- [x] Blade setting for scroll saw or bandsaw (smallest turning radius), which drives the tip and root rounding checks.
- [x] **Meshing pair:** a second gear with its own tooth count on the same module. It sits at the correct centre distance and phase, and both animate at their true speeds. Show the ratio, centre distance and contact ratio, and include the axle spacing on the printed template.
- [x] Output through workshop-kit: 1:1 print with rulers, tiling for big gears, PDF, SVG and DXF. Labels give tooth count, module, pitch diameter, bore, and "meshes with …" when the gear is in a train.
- [x] Undo/redo, autosave, save/open files, and a share URL.

### M2 — Trains (the geargenerator experience)
- [ ] More than two gears on the canvas. Drag a gear near another and it snaps to the correct centre distance and phase.
- [ ] Mesh graph: gears as nodes, with edges for meshing or for sharing an axle (compound gears). Allow one driver and reject loops that would lock.
- [ ] Animation: an RPM for the driver, and every gear turns at its computed speed with correct phase. Play/pause, and scrub by dragging.
- [ ] Train readout: overall ratio, each gear's RPM and direction, and total ratio from input to output.
- [ ] "Design a ratio": enter a target ratio and get tooth-count pairs, including two-stage compound options.
- [ ] Print a baseboard layout: all axle centres and their spacings on 1:1 tiled sheets, for drilling the frame.

### M3 — More gear types (the long-term goal is all of them)
- [ ] Rack and pinion.
- [ ] Internal (ring) gears, with checks for tip interference.
- [ ] Ratchet and pawl.
- [ ] Bevel and crown gears as flat templates (crown gear teeth, and bevel development patterns).
- [ ] Worm and wheel profiles.
- [ ] CNC and laser options: bit-radius checks and kerf offset.
- [ ] Sprockets (chain pitch and roller diameter), and belts or chains between two gears, as geargenerator offers.

### Later / maybe
- Clock work: cycloidal profile, lantern pinions, and an escapement helper (e.g. deadbeat).
- Non-circular gears.
- Double helical and herringbone gears drawn as stacked 2D layers, for laser-cut plywood.
- STL export for 3D printing test fits. Out of scope unless asked.

## Gear kinds

Every type plugs into one interface, so adding racks or internal gears later doesn't mean reworking the spur code:

```ts
interface GearKind<Spec> {
  id: 'spur' | 'rack' | 'internal' | …
  defaults(): Spec
  outline(spec: Spec): PathItem[]          // workshop-kit drawing items, mm
  pitchRadius(spec: Spec): number          // Infinity for racks
  canMesh(a: Spec, b: GearSpecAny): Issue | null
  checks(spec: Spec): Issue[]
  panel: React.FC<{ spec: Spec; onChange(s: Spec): void }>
}
```

Meshing, trains and animation only rely on pitch radius, tooth count and phase, so they work for any kind that provides them.

## Architecture

```
gear-designer/
  src/
    model/
      involute.ts     tooth profile maths → workshop-kit segments (pure, tested)
      cycloidal.ts    (M3)
      gear.ts         GearSpec → full outline, bore, spokes; checks
      train.ts        mesh graph, placement constraints, speeds, phase solve
      template.ts     gear/train → Drawing(s) for print/export
    stores/           design (+ history), settings, viewport, theme
    components/       GearCanvas, GearPanel, TrainPanel, AppToolbar, dialogs
```

Reuse from workshop-kit, adding nothing Gears-specific to it:
- Theme and `ThemeProvider`, the toolbar, panel and modal primitives, and hotkeys.
- The viewport store, `useViewportCanvas` and the multi-level grid.
- The drawing model and its outputs: SVG, PDF, DXF, print, page layout and tiling, and the `PrintDialog`.
- Units (mm, inch and fractions) and `screenScale` for the 1:1 view.
- `createHistory` for undo.

Candidates to move into the kit, once a second app needs them:
- An **offset or kerf** helper for path items.
- A **minimum inside-radius** check.
- An **animation clock** hook (Serpentine could use it too).

Suggested document model:

```ts
interface GearSpec {
  id: string
  kind: 'spur' | 'rack' | 'internal' | 'lantern' | 'cycloidal'
  teeth: number
  module: number          // mm; DP converted on input
  pressureAngle: number   // degrees
  profileShift: number
  backlash: number        // mm
  rootFillet: number      // × module
  tipRound: number        // × module
  bore: BoreSpec          // like Star Knobs, plus flat/key
  spokes?: SpokeSpec
  position: Vec           // mm
  phase: number           // radians, solved for driven gears
}

interface TrainDoc {
  gears: GearSpec[]
  links: { a: string; b: string; type: 'mesh' | 'axle' }[]
  driverId: string
  driverRpm: number
  cutting: { method: 'scroll' | 'cnc' | 'laser'; toolRadius: number; kerf: number }
}
```

## Testing

- **Geometry:** each outline closes; tooth thickness at the pitch circle matches s; teeth are symmetric; the involute Bézier fit stays within 0.01 mm; undercut is flagged exactly below z_min.
- **Meshing:** the phase formula leaves no overlap between two gears' outlines when stepped through a full tooth pitch (sample points and check overlap); the centre distance with profile shift matches worked examples.
- **Trains:** speeds and directions through compound axles; locking loops are rejected.
- **Output:** tooth count in the DXF; true-size MediaBox in the PDF, as the Star Knobs tests already do.
- **Browser check:** animate a train and print a layout sheet.

## Built so far

M1 is done apart from spokes, lightening holes and the hub circle (42 tests). Decisions made along the way:

- **Drilled roots.** Each root hole sits on the gap centreline, tangent to both flanks. The auto bit is the largest standard size in the user's unit whose hole reaches the root circle, so the gap is never shallower than standard. The check flags a chosen bit that leaves less than 0.15 × module of tip clearance.
- **Below the base circle** the flank is a radial line. There's no trochoid yet; undercut is flagged by the z_min rule instead.
- **Backlash** thins each tooth by the set amount at the pitch circle, so a pair's play is the sum of both gears' settings.
- **The document** is a list of gears plus mesh links (`GearDoc.links`, each with the direction from `a` to `b`). The first gear drives at `driverRpm`. For now every gear meshes with the first and there are at most two (`MAX_GEARS`); M2 lifts that.
- **Shared parameters.** Meshed gears share module and pressure angle; editing either gear edits both, and `normaliseDoc` enforces it.
- **Placement** lives in `src/model/train.ts`: working pressure angle and centre distance with profile shift, the phase formula, speeds, contact ratio (using the tip-fillet radius as the effective tip) and tip-to-root clearance. The overlap test steps each test pair through a tooth pitch and checks no sampled point of one outline falls inside the other.
- **The template** lays the gears out side by side for cutting, each labelled with what it meshes with, plus an axle-spacing gauge (two crosshairs one centre distance apart) for drilling the frame. The canvas shows them in mesh.
- **`GearKind`** (`src/model/kinds.ts`) holds compute, pitch radius and mesh compatibility. Panels are chosen by kind id in the components rather than living in the model.

## Next step

Finish M1 with spokes, lightening holes and the hub circle. Then M2: more than two gears, snapping into mesh when dragged near another, and compound axles.

A small pair (12 and 30 teeth at module 4) already needs two A4 sheets because the gears sit side by side. A tighter packing (the smaller gear beside or inside the larger one's bounding box) would save paper.
