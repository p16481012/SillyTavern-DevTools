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
    const hasNestedQuantifier = /\((?:[^()]|\([^()]*\))*[*+{][^()]*\)\s*(?:[*+{])/u
        .test(inspected);
    const hasQuantifiedAlternation = /\((?:[^()]|\([^()]*\))*\|(?:[^()]|\([^()]*\))*\)\s*(?:[*+{])/u
        .test(inspected);
    const hasRepeatedWildcard = /(?:\.\*|\.\+)(?:[^|)]{0,24})(?:\.\*|\.\+)/u
        .test(inspected);

    if (
        hasBackreference
        || hasNestedQuantifier
        || hasQuantifiedAlternation
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
