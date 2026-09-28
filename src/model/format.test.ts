import { describe, expect, it } from 'vitest'
import { len, lenField, num, numField } from './format'

describe('automatic precision', () => {
  it('shows three significant figures, trimmed', () => {
    expect(num(2)).toBe('2')
    expect(num(2.5)).toBe('2.5')
    expect(num(1.33333)).toBe('1.33')
    expect(num(0.0842)).toBe('0.0842')
    expect(num(5.3474)).toBe('5.35')
    expect(num(142.5)).toBe('143')
    expect(num(-0.0001, 3, 0, 2)).toBe('0')
  })

  it('gives fields one more figure', () => {
    expect(numField(5.3474)).toBe('5.347')
    expect(numField(0.225)).toBe('0.225')
    expect(numField(11.25)).toBe('11.25')
  })

  it('keeps lengths to at least 0.1 mm / 0.001″, more when small', () => {
    expect(len(142.5, 'mm')).toBe('142.5 mm')
    expect(len(120, 'mm')).toBe('120 mm')
    expect(len(0.4, 'mm')).toBe('0.4 mm')
    expect(len(0.083, 'mm')).toBe('0.083 mm')
    expect(len(25.4 * 0.0123, 'in')).toBe('0.0123″')
    expect(len(25.4 * 1.237, 'in')).toBe('1.237″')
    expect(len(25.4 * 0.75, 'in')).toBe('3/4″')
    expect(lenField(8, 'mm')).toBe('8')
    expect(lenField(0.125, 'mm')).toBe('0.125')
  })
})
