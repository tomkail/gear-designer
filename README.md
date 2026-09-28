# Gear Designer

Design wooden spur gears and print a 1:1 cutting template.

The third of a family of woodworking tools, alongside [Serpentine](https://github.com/tomkail/serpentine) and [Star Knobs](https://github.com/tomkail/star-knobs). All three use [`workshop-kit`](https://github.com/tomkail/workshop-kit) for theme, UI, canvas and true-scale printing. See [PLAN.md](PLAN.md) for the roadmap.

## Features

- True involute teeth, fitted with cubic Béziers (within 0.01 mm of the exact curve), so exports stay smooth and small.
- Woodworking defaults: module 4, 20° or 25° pressure angle, backlash, tip rounding and generous root clearance.
- Full-depth or **stub** teeth (0.8 × module above the pitch circle, 1 below). Stub teeth are stronger and undercut less, so they suit gears with few teeth.
- **Drill the roots.** The template marks a drill centre in every tooth gap. Each hole is tangent to both flanks and forms the rounded root, so you drill every gap in square stock and then saw the flanks down to the holes. The bit is the largest standard size that reaches the root circle, or one you pick.
- Or use filleted roots, checked against the tightest turn your saw blade can make.
- Tooth size as module or diametral pitch (type `m4` or `6dp` in either unit), plus the tooth spacing in mm and inches, the size you can measure with a ruler.
- Checks for undercut (with an "auto" profile shift), narrow tips, small teeth, root holes that are too big, and the bore breaking into the roots.
- Bore: plain hole, D-flat or keyway.
- **Meshing pairs.** Add a mating gear and it's placed at the right axle spacing (including profile shift) and turned so its teeth fall between the first gear's. Press play to watch both turn at their true speeds. The panel shows the ratio, axle spacing, contact ratio, play and tip clearance, and the template adds an axle-spacing gauge for drilling the frame.
- Drag handles on the canvas for the tooth count and the tooth size, and drag the second gear round the first.
- Output at true size: print (tiled across sheets with registration marks when the gear is bigger than the paper), PDF, SVG and DXF.
- Undo/redo, autosave, save/open `.gear.json` files, and a shareable URL.

## Printing accurately

Print at **100% / Actual size** and turn off "Fit to page". Measure the rulers on the printout before you cut.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # geometry, checks and export tests
npm run build   # static site in dist/
```

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`. The site is served from `/gear-designer/`; change `base` in `vite.config.ts` if the repo name differs.

## Layout

```
src/
  model/
    involute.ts   tooth profile maths → workshop-kit segments (pure, tested)
    gear.ts       GearSpec → outline, root drilling, bore, checks, measurements
    kinds.ts      the GearKind interface that future gear types plug into
    train.ts      meshing: centre distance, phase, speeds, contact ratio
    design.ts     the document, defaults, presets, URL sharing
    template.ts   gear → Drawing for print, PDF, SVG and DXF
  components/     canvas, panel, toolbar, dialogs
  stores/         zustand stores (design + undo history, settings, viewport, theme)
  actions.ts      file, export, print and view commands
```
