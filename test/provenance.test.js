import assert from 'node:assert/strict';
import test from 'node:test';
import {
    attachProvenanceLocations,
    escapeJsonPointerSegment,
    jsonPointer,
    legacyUnavailableProvenance,
    MAX_PROVENANCE_LOCATIONS,
} from '../src/provenance.js';

test('JSON pointer helpers implement RFC 6901 escaping', () => {
    assert.equal(escapeJsonPointerSegment('a/b~c'), 'a~1b~0c');
    assert.equal(jsonPointer('payload', 0, 'a/b~c'), '/payload/0/a~1b~0c');
    assert.equal(jsonPointer(), '');
});

test('provenance locations are normalized, de-duplicated, and bounded', () => {
    const values = Array.from({ length: MAX_PROVENANCE_LOCATIONS + 10 }, (_, index) => ({
        jsonPointer: `/payload/${index}/content`,
        messageIndex: index,
        role: 'SYSTEM',
        valueRange: { start: 0, end: 1 },
        finalRange: { start: index, end: index + 1 },
    }));
    values.push(values[0]);
    const provenance = attachProvenanceLocations(
        { method: 'exact', confidence: 1 },
        values,
    );

    assert.equal(provenance.availability, 'available');
    assert.equal(provenance.locations.length, MAX_PROVENANCE_LOCATIONS);
    assert.equal(provenance.locationCount, MAX_PROVENANCE_LOCATIONS + 10);
    assert.equal(provenance.locationsTruncated, true);
    assert.equal(provenance.locations[0].role, 'system');
});

test('legacy provenance does not fabricate structured locations', () => {
    assert.deepEqual(
        legacyUnavailableProvenance({
            method: 'exact',
            confidence: 1,
            locations: [{
                jsonPointer: '/guessed',
                messageIndex: 0,
                role: 'system',
                finalRange: { start: 0, end: 1 },
            }],
        }),
        {
            method: 'exact',
            confidence: 1,
            availability: 'legacy-unavailable',
            locations: [],
            locationCount: 0,
            locationsTruncated: false,
        },
    );
});
