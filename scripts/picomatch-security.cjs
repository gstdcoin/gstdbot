const { test } = require('node:test');
const assert = require('node:assert/strict');
const match = require('../vendor/picomatch');

test('unsafe repeated extglobs fail at compilation through every parser entry', () => {
    for (const pattern of ['+(*)x', '+(*a)b', '*(a*)z', '+(ab|abab)c', '+("a"|a)b', '+(a\\*)b', '+(a|\u0000a)b', '+(*(a )|*(b))', '+(*(/)|*(a))']) {
        for (const options of [{}, { fastpaths: false }, { maxExtglobRecursion: false }, { capture: true }, { unescape: true }]) {
            for (const compile of [match, match.makeRe, match.parse]) {
                assert.throws(() => compile(pattern, options), /Unsafe repeated extglob/);
            }
        }
    }
});

test('raw regex grouping cannot wrap a safe extglob in another unbounded repeat', () => {
    for (const pattern of ['(+(a|b))+z', '+(a|b)+z', '((ab)+)+c']) {
        assert.throws(() => match.makeRe(pattern), /Unsafe repeated regex group/);
    }
});

test('case-insensitive alternatives cannot regain ambiguous repetition', () => {
    for (const options of [{nocase:true},{flags:'i'},{flags:'iu'}]) {
        assert.throws(() => match('+(a|A)b', options), /Unsafe repeated extglob/);
        assert.throws(() => match('+(s|ſ)b', options), /Unsafe repeated extglob/);
        assert.equal(match('+(foo|bar).ts', options)('FOObar.ts'), true);
    }
});

test('ordinary globs, safe repetition, state and regular expression APIs remain compatible', () => {
    assert.equal(match('**/tests/**/*.spec.ts')('tests/One.spec.ts'), true);
    assert.equal(match('**/tests/**/*.spec.ts')('src/One.ts'), false);
    assert.equal(match('+(foo|bar).ts')('foobar.ts'), true);
    assert.equal(match('+(foo|bar).ts')('baz.ts'), false);
    assert.equal(match('+(*(a)|*(b))')('abba'), true);
    assert.equal(match(['*.js', '*.ts'])('a.ts'), true);
    assert.equal(match('*.js', { dot: true })('.a.js'), true);
    assert.equal(match('*.js')('.a.js'), false);
    assert.equal(match('**/*.ts', { windows: true })('src\\One.ts'), true);
    const withState = match('!*.js', {}, true);
    assert.equal(withState.state.negated, true);
    assert.equal(match.makeRe('*.ts').test('One.ts'), true);
    assert.equal(match.compileRe(match.parse('*.ts')).test('One.ts'), true);
    assert.equal(match.scan('src/**/*.ts').isGlob, true);
});

