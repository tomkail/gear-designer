import { formatLength, MM_PER_INCH, type LengthUnit } from '@tomkail/workshop-kit'

/**
 * Number formatting that picks its own precision: enough decimal places to
 * show `sig` significant figures, so small values (0.0157″, 0.083 × module)
 * keep their digits and large ones (142.5 mm) don't grow noise.
 */

/** Decimal places that show `sig` significant figures, clamped to [min, max] */
export function decimalsFor(v: number, sig: number, min = 0, max = 6): number {
  if (!Number.isFinite(v) || v === 0) return min
  const d = sig - 1 - Math.floor(Math.log10(Math.abs(v)))
  return Math.max(min, Math.min(max, d))
}

/** A plain number to `sig` significant figures, trailing zeros trimmed */
export function num(v: number, sig = 3, min = 0, max = 6): string {
  if (!Number.isFinite(v)) return '—'
  const text = v.toFixed(decimalsFor(v, sig, min, max))
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text
  return trimmed === '-0' ? '0' : trimmed
}

/** Values shown in editable fields carry one more figure, so what you see is what's stored */
export const FIELD_SIG = 4

export const numField = (v: number) => num(v, FIELD_SIG, 0, 4)

/**
 * A length in the user's unit. At least 0.1 mm or 0.001″ resolution (what
 * you can mark and cut), more for small values; inches still show as a
 * fraction when they land on one.
 */
export function len(mm: number, unit: LengthUnit, sig = 3, options: { withUnit?: boolean } = {}): string {
  return formatLength(mm, unit, {
    withUnit: options.withUnit ?? true,
    mmDecimals: decimalsFor(mm, sig, 1, 4),
    inDecimals: decimalsFor(mm / MM_PER_INCH, sig, 3, 5),
  })
}

/** A length for an editable field: no unit, one more figure */
export const lenField = (mm: number, unit: LengthUnit) => len(mm, unit, FIELD_SIG, { withUnit: false })
