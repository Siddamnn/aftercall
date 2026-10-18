// Run: npm run check  (plain Node, no test framework)
import assert from 'node:assert/strict'
import { blank, fromSpec, slug, toSpec, validate, validateTracker } from './signal-draft.ts'

const ok = { ...blank('choice', 'call_outcome'), instructions: 'Outcome?', options: [{ key: 'booked', text: 'Booked a slot' }, { key: 'other', text: 'Anything else' }] }
assert.deepEqual(validate(ok), {})
assert.match(validate({ ...ok, name: '' }).name!, /name/)
assert.match(validate({ ...ok, name: '9_lives' }).name!, /letter/)
assert.match(validate(ok, ['call_outcome']).name!, /already/)
assert.match(validate({ ...ok, options: [{ key: 'booked', text: 'x' }, { key: 'declined', text: 'y' }] }).criteria!, /"Other"/)
assert.match(validate({ ...ok, options: [{ key: 'Other', text: 'x' }, { key: 'other', text: 'y' }] }).criteria!, /same name/)
assert.match(validate({ ...ok, options: [{ key: 'booked', text: '' }, { key: 'other', text: 'y' }] }).criteria!, /Describe/)
assert.match(validate({ ...ok, instructions: 'Contradicts {policy}?' }).instructions!, /\{policy\}/)
assert.match(validate({ ...blank('score', 'mood'), instructions: 'Mood?', levels: ['calm'] }).criteria!, /2 and 10/)
assert.deepEqual(validate({ ...blank('yes_no', 'human'), instructions: 'Asked for a human?' }), {})

// Friendly names become valid keys; option names are slugged too.
assert.equal(slug('Asked for a human?'), 'asked_for_a_human')
assert.equal(slug('  Call -- outcome  '), 'call_outcome')
assert.equal(slug('x'.repeat(70) + ' y').length, 64)
assert.deepEqual(Object.keys(toSpec({ ...ok, options: [{ key: 'No answer', text: 'x' }, { key: 'Other', text: 'y' }] }).criteria!), ['no_answer', 'other'])

// Round trip keeps option order; empty yes/no descriptions are dropped, not sent as "".
assert.deepEqual(Object.keys(toSpec(fromSpec(toSpec(ok))).criteria!), ['booked', 'other'])
assert.equal(toSpec({ ...blank('yes_no', 'human'), instructions: 'x' }).criteria, undefined)
assert.deepEqual(toSpec({ ...blank('yes_no', 'human'), instructions: 'x', yes: 'Asks for a person' }).criteria, { true: 'Asks for a person' })

// Trackers: same name pattern as signals, and no "__".
assert.deepEqual(validateTracker('compliance', 'Clinic policy'), {})
assert.match(validateTracker('', '').name!, /name/)
assert.match(validateTracker('call__flow', '').name!, /two underscores/)
assert.match(validateTracker('outcome', '', ['outcome']).name!, /already/)
assert.match(validateTracker('outcome', 'x'.repeat(501)).description!, /500/)
assert.equal(fromSpec(toSpec({ ...ok, options: [{ key: 'No answer', text: 'x' }, { key: 'other', text: 'y' }] })).options[0].key, 'No answer')
console.log('signal-draft: ok')
