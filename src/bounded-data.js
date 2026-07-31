const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class BoundedDataError extends TypeError {
    constructor(code, message) {
        super(message);
        this.name = 'BoundedDataError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new BoundedDataError(code, message);
}

function isPlainRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function ownData(record, key) {
    if (!isPlainRecord(record)) {
        fail('UNSAFE_CONTAINER', 'Expected a plain data object.');
    }
    if (DANGEROUS_KEYS.has(key)) {
        fail('DANGEROUS_KEY', 'A prohibited object key was requested.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) return { present: false, value: undefined };
    if (!Object.hasOwn(descriptor, 'value')) {
        fail('ACCESSOR_PROPERTY', 'Accessor properties are not accepted as data.');
    }
    return { present: true, value: descriptor.value };
}

export function assertSafeDataContainer(record, {
    maxKeys = 128,
} = {}) {
    if (!isPlainRecord(record)) {
        fail('UNSAFE_CONTAINER', 'Expected a plain data object.');
    }
    const keys = Reflect.ownKeys(record);
    if (keys.length > maxKeys) {
        fail('TOO_MANY_KEYS', 'An object exceeds the parser key limit.');
    }
    for (const key of keys) {
        if (typeof key !== 'string') {
            fail('SYMBOL_KEY', 'Symbol keys are not accepted.');
        }
        if (DANGEROUS_KEYS.has(key)) {
            fail('DANGEROUS_KEY', 'A prohibited object key was found.');
        }
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            fail('ACCESSOR_PROPERTY', 'Accessor properties are not accepted as data.');
        }
    }
    return record;
}

export function assertExactKeys(record, allowedKeys, label = 'object') {
    if (!isPlainRecord(record)) {
        fail('UNSAFE_CONTAINER', `${label} must be a plain data object.`);
    }
    const allowed = new Set(allowedKeys);
    for (const key of Reflect.ownKeys(record)) {
        if (typeof key !== 'string') {
            fail('SYMBOL_KEY', `${label} must not contain symbol keys.`);
        }
        if (DANGEROUS_KEYS.has(key)) {
            fail('DANGEROUS_KEY', `${label} contains a prohibited key.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            fail('ACCESSOR_PROPERTY', `${label} must not contain accessors.`);
        }
        if (!allowed.has(key)) {
            fail('UNKNOWN_KEY', `${label} contains an unsupported key.`);
        }
    }
}

export function assertSafeStructuredData(value, {
    maxArrayLength = 64,
    maxDepth = 6,
    maxKeysPerObject = 64,
    maxNodes = 512,
    maxStringLength = 512,
} = {}) {
    const seen = new WeakSet();
    let nodes = 0;

    function visit(current, depth) {
        nodes += 1;
        if (nodes > maxNodes) {
            fail('TOO_MANY_NODES', 'The data object exceeds the parser size limit.');
        }
        if (depth > maxDepth) {
            fail('TOO_DEEP', 'The data object exceeds the parser depth limit.');
        }
        if (current === null || typeof current === 'boolean') return;
        if (typeof current === 'string') {
            if (current.length > maxStringLength) {
                fail('STRING_TOO_LONG', 'A string exceeds the parser size limit.');
            }
            return;
        }
        if (typeof current === 'number') {
            if (!Number.isFinite(current)) {
                fail('NON_FINITE_NUMBER', 'Non-finite numbers are not accepted.');
            }
            return;
        }
        if (typeof current !== 'object') {
            fail('UNSUPPORTED_VALUE', 'Only JSON-compatible data values are accepted.');
        }
        if (seen.has(current)) {
            fail('CYCLIC_DATA', 'Cyclic data is not accepted.');
        }
        seen.add(current);

        const prototype = Object.getPrototypeOf(current);
        if (Array.isArray(current)) {
            if (prototype !== Array.prototype) {
                fail('UNSAFE_PROTOTYPE', 'Arrays with custom prototypes are not accepted.');
            }
            if (current.length > maxArrayLength) {
                fail('ARRAY_TOO_LONG', 'An array exceeds the parser size limit.');
            }
        } else if (prototype !== Object.prototype && prototype !== null) {
            fail('UNSAFE_PROTOTYPE', 'Objects with custom prototypes are not accepted.');
        }

        const keys = Reflect.ownKeys(current);
        if (keys.length > maxKeysPerObject) {
            fail('TOO_MANY_KEYS', 'An object exceeds the parser key limit.');
        }
        for (const key of keys) {
            if (typeof key !== 'string') {
                fail('SYMBOL_KEY', 'Symbol keys are not accepted.');
            }
            if (DANGEROUS_KEYS.has(key)) {
                fail('DANGEROUS_KEY', 'A prohibited object key was found.');
            }
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                fail('ACCESSOR_PROPERTY', 'Accessor properties are not accepted as data.');
            }
            visit(descriptor.value, depth + 1);
        }
    }

    visit(value, 0);
    return value;
}

export function isPlainDataRecord(value) {
    return isPlainRecord(value);
}
