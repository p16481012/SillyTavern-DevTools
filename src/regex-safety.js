export const USER_REGEX_MAX_LENGTH = 256;
export const USER_REGEX_MAX_GROUPS = 24;
export const USER_REGEX_MAX_QUANTIFIERS = 32;

export class UserRegexError extends Error {
    constructor(code) {
        super(code);
        this.name = 'UserRegexError';
        this.code = code;
    }
}

function analysisPattern(pattern) {
    return pattern
        .replace(/\\./gu, '_')
        .replace(/\[(?:\\.|[^\]\\])*\]/gu, '[]');
}

function quantifierLengthAt(pattern, index) {
    const character = pattern[index];
    if (character === '*' || character === '+' || character === '?') {
        return pattern[index + 1] === '?' ? 2 : 1;
    }
    if (character !== '{') return 0;
    const match = pattern.slice(index).match(/^\{\d+(?:,\d*)?\}\??/u);
    return match?.[0]?.length ?? 0;
}

function repetitionLengthAt(pattern, index) {
    const character = pattern[index];
    if (character === '*' || character === '+' || character === '?') {
        return pattern[index + 1] === '?' ? 2 : 1;
    }
    if (character !== '{') return 0;
    const match = pattern.slice(index).match(
        /^\{(\d+)(?:,(\d*)?)?\}(\?)?/u,
    );
    if (!match) return 0;
    const minimum = Number(match[1]);
    const hasRange = match[0].includes(',');
    const maximum = hasRange
        ? match[2] === '' || match[2] == null
            ? Number.POSITIVE_INFINITY
            : Number(match[2])
        : minimum;
    return hasRange && maximum !== minimum ? match[0].length : 0;
}

function hasWordBoundaryEscape(pattern) {
    for (let index = 0; index < pattern.length; index += 1) {
        if (pattern[index] !== '\\') continue;
        const marker = pattern[index + 1];
        if (marker === 'b' || marker === 'B') return true;
        index += 1;
    }
    return false;
}

function escapedAtom(pattern, index) {
    if (index + 1 >= pattern.length) {
        return { signature: 'literal:\\', end: index + 1 };
    }
    const marker = pattern[index + 1];
    const controlEscapes = new Map([
        ['t', '\t'],
        ['n', '\n'],
        ['r', '\r'],
        ['f', '\f'],
        ['v', '\v'],
        ['0', '\0'],
    ]);
    if (controlEscapes.has(marker)) {
        return {
            signature: `literal:${controlEscapes.get(marker)}`,
            end: index + 2,
        };
    }
    if (marker === 'x' && /^[0-9a-f]{2}$/iu.test(pattern.slice(index + 2, index + 4))) {
        return {
            signature: `literal:${String.fromCodePoint(
                Number.parseInt(pattern.slice(index + 2, index + 4), 16),
            ).toLowerCase()}`,
            end: index + 4,
        };
    }
    if (marker === 'u') {
        const braced = pattern.slice(index + 2).match(/^\{([0-9a-f]{1,6})\}/iu);
        const fixed = pattern.slice(index + 2, index + 6);
        const hexadecimal = braced?.[1]
            ?? (/^[0-9a-f]{4}$/iu.test(fixed) ? fixed : null);
        const end = braced
            ? index + 2 + braced[0].length
            : hexadecimal
                ? index + 6
                : index + 2;
        const codePoint = hexadecimal ? Number.parseInt(hexadecimal, 16) : NaN;
        if (Number.isFinite(codePoint) && codePoint <= 0x10ffff) {
            return {
                signature: `literal:${String.fromCodePoint(codePoint).toLowerCase()}`,
                end,
            };
        }
        return { signature: 'escape:unicode', end };
    }
    if (marker === 'c' && /^[a-z]$/iu.test(pattern[index + 2] ?? '')) {
        return {
            signature: `literal:${String.fromCodePoint(
                pattern[index + 2].toUpperCase().codePointAt(0) % 32,
            )}`,
            end: index + 3,
        };
    }
    if ((marker === 'p' || marker === 'P') && pattern[index + 2] === '{') {
        const closing = pattern.indexOf('}', index + 3);
        if (closing >= 0) {
            return {
                signature: `escape:${pattern.slice(index, closing + 1)}`,
                end: closing + 1,
            };
        }
    }
    if ('dDsSwW'.includes(marker)) {
        return {
            signature: `escape:${marker}`,
            end: index + 2,
        };
    }
    return {
        signature: `literal:${marker.toLowerCase()}`,
        end: index + 2,
    };
}

function characterClassAtom(pattern, index) {
    let cursor = index + 1;
    while (cursor < pattern.length) {
        if (pattern[cursor] === '\\') {
            cursor += 2;
            continue;
        }
        if (pattern[cursor] === ']') {
            return {
                signature: `class:${pattern.slice(index, cursor + 1)}`,
                end: cursor + 1,
            };
        }
        cursor += 1;
    }
    return {
        signature: `class:${pattern.slice(index)}`,
        end: pattern.length,
    };
}

function atomsMayOverlap(left, right) {
    if (left === right || left === 'any' || right === 'any') return true;
    if (left.startsWith('literal:') && right.startsWith('literal:')) {
        const leftValue = left.slice('literal:'.length);
        const rightValue = right.slice('literal:'.length);
        return !(
            /^[\x00-\x7f]$/u.test(leftValue)
            && /^[\x00-\x7f]$/u.test(rightValue)
            && leftValue !== rightValue
        );
    }
    if (left.startsWith('class:') && right.startsWith('class:')) return true;
    if (
        (
            left.startsWith('class:')
            && (
                right.startsWith('escape:')
                || right.startsWith('literal:')
            )
        )
        || (
            right.startsWith('class:')
            && (
                left.startsWith('escape:')
                || left.startsWith('literal:')
            )
        )
    ) {
        return true;
    }
    return (
        left.startsWith('escape:')
        || right.startsWith('escape:')
    );
}

function groupPrefixEnd(pattern, index) {
    if (pattern[index] !== '(' || pattern[index + 1] !== '?') return index + 1;
    if (pattern[index + 2] === '<' && !['=', '!'].includes(pattern[index + 3])) {
        const closing = pattern.indexOf('>', index + 3);
        return closing >= 0 ? closing + 1 : index + 2;
    }
    return index + 3;
}

function hasAmbiguousAdjacentRepetition(pattern) {
    let previous = null;
    for (let index = 0; index < pattern.length;) {
        const character = pattern[index];
        if (character === '(') {
            index = groupPrefixEnd(pattern, index);
            continue;
        }
        if (character === ')') {
            index += 1;
            const repetitionLength = repetitionLengthAt(pattern, index);
            if (repetitionLength > 0) index += repetitionLength;
            continue;
        }
        if (character === '|') {
            previous = null;
            index += 1;
            continue;
        }
        if (character === '^' || character === '$') {
            index += 1;
            continue;
        }
        if (quantifierLengthAt(pattern, index) > 0) {
            previous = null;
            index += quantifierLengthAt(pattern, index);
            continue;
        }

        let atom;
        if (character === '\\') {
            atom = escapedAtom(pattern, index);
        } else if (character === '[') {
            atom = characterClassAtom(pattern, index);
        } else {
            const literal = String.fromCodePoint(pattern.codePointAt(index));
            atom = {
                signature: literal === '.'
                    ? 'any'
                    : `literal:${literal.toLowerCase()}`,
                end: index + literal.length,
            };
        }
        const repetitionLength = repetitionLengthAt(pattern, atom.end);
        const current = {
            signature: atom.signature,
            repeated: repetitionLength > 0,
        };
        if (
            previous?.repeated
            && current.repeated
            && atomsMayOverlap(previous.signature, current.signature)
        ) {
            return true;
        }
        previous = current;
        index = atom.end + repetitionLength;
    }
    return false;
}

function hasRiskyQuantifierStructure(pattern) {
    const stack = [];
    let unboundedQuantifiers = 0;
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === '(') {
            stack.push({
                containsAlternation: false,
                containsQuantifier: false,
            });
            continue;
        }
        if (character === '|') {
            const frame = stack.at(-1);
            if (frame) frame.containsAlternation = true;
            continue;
        }
        if (character === ')') {
            const frame = stack.pop() ?? {
                containsAlternation: false,
                containsQuantifier: false,
            };
            const quantifierLength = quantifierLengthAt(pattern, index + 1);
            if (
                quantifierLength > 0
                && (frame.containsAlternation || frame.containsQuantifier)
            ) {
                return true;
            }
            const parent = stack.at(-1);
            if (parent && (frame.containsQuantifier || quantifierLength > 0)) {
                parent.containsQuantifier = true;
            }
            if (quantifierLength > 0) {
                if (pattern[index + 1] === '*' || pattern[index + 1] === '+') {
                    unboundedQuantifiers += 1;
                }
                index += quantifierLength;
            }
            continue;
        }

        const quantifierLength = quantifierLengthAt(pattern, index);
        if (quantifierLength === 0) continue;
        const frame = stack.at(-1);
        if (frame) frame.containsQuantifier = true;
        if (character === '*' || character === '+') unboundedQuantifiers += 1;
        if (unboundedQuantifiers >= 8) return true;
        index += quantifierLength - 1;
    }
    return false;
}

export function validateUserRegex(value) {
    const pattern = String(value ?? '');
    if (!pattern) return { ok: false, code: 'empty-pattern' };
    if (pattern.length > USER_REGEX_MAX_LENGTH) {
        return { ok: false, code: 'regex-too-long' };
    }
    if (pattern.includes('\0')) {
        return { ok: false, code: 'unsafe-regex' };
    }

    const inspected = analysisPattern(pattern);
    const groupCount = (inspected.match(/\((?!\?[:=!<])/gu) ?? []).length
        + (inspected.match(/\(\?:/gu) ?? []).length
        + (inspected.match(/\(\?<[^=!][^>]*>/gu) ?? []).length;
    if (groupCount > USER_REGEX_MAX_GROUPS) {
        return { ok: false, code: 'unsafe-regex' };
    }

    const quantifierCount = (inspected.match(/[*+?]|\{\d+(?:,\d*)?\}/gu) ?? []).length;
    if (quantifierCount > USER_REGEX_MAX_QUANTIFIERS) {
        return { ok: false, code: 'unsafe-regex' };
    }

    const hasBackreference = /\\(?:[1-9]\d*|k<[^>]+>)/u.test(pattern);
    const hasWordBoundary = hasWordBoundaryEscape(pattern);
    const hasSurrogateEscape = /\\u(?:d[89ab][0-9a-f]{2}|d[c-f][0-9a-f]{2})/iu
        .test(pattern);
    const hasLookaround = /\(\?(?:[=!]|<[=!])/u.test(inspected);
    const hasInlineModifiers = /\(\?[ims-]+:/u.test(inspected);
    const hasZeroWidthQuantifier = /\{0(?:,0)?\}\??/u.test(inspected);
    const hasAlternation = inspected.includes('|');
    const hasQuantifiedGroup = /\)(?:[*+?]|\{\d+(?:,\d*)?\})/u.test(inspected);
    const hasAmbiguousRepetition = hasAmbiguousAdjacentRepetition(pattern);
    const hasRiskyStructure = hasRiskyQuantifierStructure(inspected);
    const hasRepeatedWildcard = /(?:\.\*|\.\+)(?:[^|)]{0,24})(?:\.\*|\.\+)/u
        .test(inspected);

    if (
        hasBackreference
        || hasWordBoundary
        || hasSurrogateEscape
        || hasLookaround
        || hasInlineModifiers
        || hasZeroWidthQuantifier
        || hasAlternation
        || hasQuantifiedGroup
        || hasAmbiguousRepetition
        || hasRiskyStructure
        || hasRepeatedWildcard
    ) {
        return { ok: false, code: 'unsafe-regex' };
    }

    try {
        new RegExp(pattern, 'u');
    } catch {
        return { ok: false, code: 'invalid-regex' };
    }
    return { ok: true, code: null };
}

export function compileUserRegex(value, flags = 'u') {
    const pattern = String(value ?? '');
    const validation = validateUserRegex(pattern);
    if (!validation.ok) throw new UserRegexError(validation.code);
    return new RegExp(pattern, flags);
}
