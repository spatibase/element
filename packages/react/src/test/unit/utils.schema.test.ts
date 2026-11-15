import { describe, it, expect } from 'vitest'
import { slugify, uniqueKey } from '@element-editor/core/internal'

describe('slugify', () => {
  it('lowercases and replaces spaces with underscores', () => {
    expect(slugify('My Field Name')).toBe('my_field_name')
  })

  it('trims leading and trailing whitespace', () => {
    expect(slugify('  Foo Bar  ')).toBe('foo_bar')
  })

  it('collapses multiple spaces/special chars into one underscore', () => {
    expect(slugify('Hello  World!!')).toBe('hello_world')
  })

  it('strips leading and trailing underscores', () => {
    expect(slugify('!leading')).toBe('leading')
    expect(slugify('trailing!')).toBe('trailing')
  })

  it('returns "field" for an empty string', () => {
    expect(slugify('')).toBe('field')
  })

  it('returns "field" for a string of only special chars', () => {
    expect(slugify('!!!')).toBe('field')
  })

  it('preserves numbers', () => {
    expect(slugify('Field 2')).toBe('field_2')
  })

  it('handles a plain lowercase slug unchanged', () => {
    expect(slugify('name')).toBe('name')
  })
})

describe('uniqueKey', () => {
  it('returns the slug when no collision', () => {
    expect(uniqueKey('Rating', new Set())).toBe('rating')
  })

  it('appends _2 on first collision', () => {
    expect(uniqueKey('Rating', new Set(['rating']))).toBe('rating_2')
  })

  it('appends _3 when _2 is also taken', () => {
    expect(uniqueKey('Rating', new Set(['rating', 'rating_2']))).toBe('rating_3')
  })

  it('keeps incrementing until a free slot is found', () => {
    const taken = new Set(['rating', 'rating_2', 'rating_3', 'rating_4'])
    expect(uniqueKey('Rating', taken)).toBe('rating_5')
  })

  it('uses slugify on the label before collision check', () => {
    // 'My Field' slugifies to 'my_field'
    expect(uniqueKey('My Field', new Set(['my_field']))).toBe('my_field_2')
  })
})
