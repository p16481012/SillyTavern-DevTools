import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    buildInstructionModel,
    classifyInstructionCapability,
    INSTRUCTION_MODEL_LIMITS,
} from '../src/instruction-atoms.js';

const goldenCorpus = JSON.parse(await readFile(
    new URL('./fixtures/rule-v3-golden.json', import.meta.url),
    'utf8',
));

function mappedSources(rawSources) {
    let cursor = 0;
    return rawSources.map((source) => {
        const start = cursor;
        cursor += source.content.length + 1;
        return {
            label: source.id,
            attribution: 'exact',
            included: true,
            ranges: [{ start, end: start + source.content.length }],
            ...source,
        };
    });
}

test('Rule Inspector V3 classifies source capabilities before extracting instructions', () => {
    assert.equal(classifyInstructionCapability({ type: 'system' }).kind, 'instruction');
    assert.equal(classifyInstructionCapability({ type: 'lorebook' }).kind, 'reference');
    assert.equal(
        classifyInstructionCapability({ type: 'chat_history' }).kind,
        'conversation',
    );
    assert.equal(classifyInstructionCapability({ type: 'tool_schema' }).kind, 'tool-data');
    assert.equal(
        classifyInstructionCapability({ type: 'multimodal' }).kind,
        'multimodal-placeholder',
    );
    assert.equal(classifyInstructionCapability({ type: 'final' }).kind, 'aggregate');
});

test('capabilities separate reference atoms from conversation, tool, and media data', () => {
    const model = buildInstructionModel(mappedSources([
        { id: 'system', type: 'system', content: 'Always respond in English.' },
        { id: 'lore', type: 'lorebook', content: 'Always respond in Japanese.' },
        { id: 'history', type: 'chat_history', content: '반드시 한국어로 답변하세요.' },
        { id: 'tool', type: 'tool_schema', content: 'Return JSON only.' },
        { id: 'image', type: 'multimodal', content: 'Always respond in Chinese.' },
    ]));

    assert.deepEqual(
        new Set(model.atoms.map(({ sourceId }) => sourceId)),
        new Set(['system', 'lore']),
    );
    assert.equal(
        model.atoms.find(({ sourceId }) => sourceId === 'lore')?.status,
        'insufficient-evidence',
    );
    assert.equal(model.relations.length, 0);
    assert.equal(model.stats.instructionSources, 1);
    assert.equal(model.stats.referenceSources, 1);
});

test('Rule Inspector V3 atoms preserve source, range, context, method, and confidence', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'instruction',
            type: 'extension',
            content: '사용자가 일본인인 경우 반드시 일본어로 답변하세요.',
            metadata: { role: 'system', position: 2, depth: 4 },
        },
    ]));

    const atom = model.atoms.find(({ category }) => category === 'language');
    assert.equal(atom?.sourceId, 'instruction');
    assert.equal(atom?.target, 'response');
    assert.equal(atom?.action, 'set');
    assert.equal(atom?.property, 'response.language');
    assert.equal(atom?.value, 'ja');
    assert.equal(atom?.polarity, 'require');
    assert.equal(atom?.scope, 'output');
    assert.match(atom?.condition ?? '', /경우/u);
    assert.equal(atom?.priority, 'high');
    assert.equal(atom?.status, 'candidate');
    assert.equal(atom?.sourceRole, 'system');
    assert.equal(atom?.position, 2);
    assert.equal(atom?.depth, 4);
    assert.equal(atom?.method, 'pattern:language:ja');
    assert.equal(typeof atom?.confidence, 'number');
    assert.equal(atom?.localRange.end > atom?.localRange.start, true);
    assert.equal(atom?.finalRanges.length, 1);
});

test('anonymized Korean golden corpus keeps expected precision and recall', () => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;

    for (const fixture of goldenCorpus) {
        const model = buildInstructionModel(mappedSources(fixture.sources));
        const actual = model.relations
            .map(({ category, status }) => `${category}:${status}`)
            .sort();
        const expected = [...fixture.expectedRelations].sort();
        assert.deepEqual(actual, expected, fixture.id);
        const actualCompatible = model.compatibilityRelations
            .map(({ category, applicabilityKind, status }) => (
                `${category}:${applicabilityKind}:${status}`
            ))
            .sort();
        const expectedCompatible = [
            ...(fixture.expectedCompatibleRelations ?? []),
        ].sort();
        assert.deepEqual(
            actualCompatible,
            expectedCompatible,
            `${fixture.id}: compatible relations`,
        );
        assert.equal(
            model.exclusions.length >= (fixture.minimumExclusions ?? 0),
            true,
            `${fixture.id}: exclusions`,
        );

        const remaining = [...expected];
        for (const item of actual) {
            const index = remaining.indexOf(item);
            if (index >= 0) {
                truePositive += 1;
                remaining.splice(index, 1);
            } else {
                falsePositive += 1;
            }
        }
        falseNegative += remaining.length;
    }

    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / Math.max(1, truePositive + falseNegative);
    assert.equal(precision >= 0.95, true);
    assert.equal(recall >= 0.95, true);
});

test('same simple condition promotes an overlapping conflict to confirmed', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'english',
            type: 'system',
            content: 'If mode is concise respond in English.',
        },
        {
            id: 'japanese',
            type: 'extension',
            content: 'If mode is concise respond in Japanese.',
        },
    ]));

    assert.equal(model.relations.length, 1);
    assert.equal(model.compatibilityRelations.length, 0);
    assert.equal(model.relations[0].kind, 'alternative-values');
    assert.equal(model.relations[0].applicabilityKind, 'same-predicate-overlap');
    assert.equal(model.relations[0].disposition, 'conflict');
    assert.equal(model.relations[0].status, 'confirmed');
    assert.equal(model.clusters.length, 1);
});

test('mutually exclusive simple conditions remain inspectable without a conflict cluster', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'english',
            type: 'system',
            content: 'If locale is en-US respond in English.',
        },
        {
            id: 'japanese',
            type: 'extension',
            content: 'If locale is ja-JP respond in Japanese.',
        },
    ]));

    assert.equal(model.relations.length, 0);
    assert.equal(model.compatibilityRelations.length, 1);
    assert.equal(
        model.compatibilityRelations[0].applicabilityKind,
        'mutually-exclusive',
    );
    assert.equal(model.compatibilityRelations[0].disposition, 'compatible');
    assert.equal(model.compatibilityRelations[0].status, 'confirmed');
    assert.equal(model.compatibilityRelations[0].clusterId, null);
    assert.equal(model.clusters.length, 0);
});

test('an explicit exception and its matching branch are compatible specialization', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'default',
            type: 'system',
            content: 'Unless locale is en-US respond in English.',
        },
        {
            id: 'exception-branch',
            type: 'extension',
            content: 'If locale is en-US respond in Japanese.',
        },
    ]));

    assert.equal(model.relations.length, 0);
    assert.equal(model.compatibilityRelations.length, 1);
    assert.equal(
        model.compatibilityRelations[0].applicabilityKind,
        'exception-specialization',
    );
    assert.equal(model.compatibilityRelations[0].disposition, 'compatible');
    assert.equal(model.compatibilityRelations[0].status, 'confirmed');
    assert.equal(model.clusters.length, 0);
});

test('compound or otherwise unresolved conditions stay candidate conflicts', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'english',
            type: 'system',
            content: 'If locale is en-US and mode is concise respond in English.',
        },
        {
            id: 'japanese',
            type: 'extension',
            content: 'If locale is ja-JP and mode is verbose respond in Japanese.',
        },
    ]));

    assert.equal(model.relations.length, 1);
    assert.equal(model.compatibilityRelations.length, 0);
    assert.equal(model.relations[0].applicabilityKind, 'unknown-overlap');
    assert.equal(model.relations[0].disposition, 'conflict');
    assert.equal(model.relations[0].status, 'candidate');
    assert.equal(model.clusters.length, 1);
});

test('every V3 relation exposes inspectable pair and cluster evidence', () => {
    const model = buildInstructionModel(mappedSources([
        { id: 'ko', type: 'system', content: '반드시 한국어로 답변하세요.' },
        { id: 'en', type: 'extension', content: 'Always respond in English.' },
        { id: 'ja', type: 'system', content: 'Always respond in Japanese.' },
    ]));

    assert.equal(model.relations.length, 3);
    assert.equal(model.clusters.length, 1);
    for (const relation of model.relations) {
        assert.equal(relation.atomIds.length, 2);
        assert.equal(relation.sourceIds.length, 2);
        assert.equal(relation.localEvidence.length, 2);
        assert.equal(relation.finalRanges.length, 2);
        assert.equal(relation.method, 'instruction-atom-pair');
        assert.equal(typeof relation.confidence, 'number');
        assert.equal(relation.applicabilityKind, 'unconditional-overlap');
        assert.equal(relation.disposition, 'conflict');
        assert.equal(relation.status, 'confirmed');
        assert.equal(relation.clusterId, model.clusters[0].id);
    }
    assert.deepEqual(
        new Set(model.clusters[0].sourceIds),
        new Set(['ko', 'en', 'ja']),
    );
});

test('V3 bounds analysis work for large prompt sets', () => {
    const sources = Array.from({ length: 300 }, (_, index) => ({
        id: `source-${index}`,
        type: 'system',
        content: index % 2 === 0
            ? 'Always respond in English and include an explanation.'
            : 'Always respond in Japanese and do not include an explanation.',
    }));
    const startedAt = performance.now();
    const model = buildInstructionModel(mappedSources(sources));
    const elapsed = performance.now() - startedAt;

    assert.equal(model.atoms.length <= INSTRUCTION_MODEL_LIMITS.atoms, true);
    assert.equal(model.relations.length <= INSTRUCTION_MODEL_LIMITS.relations, true);
    assert.equal(
        model.compatibilityRelations.length
            <= INSTRUCTION_MODEL_LIMITS.compatibleRelations,
        true,
    );
    assert.equal(model.stats.relationsTruncated, true);
    assert.equal(elapsed < 500, true, `analysis took ${elapsed.toFixed(1)}ms`);
});

test('disabled rule categories are omitted from the V3 model', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'mixed',
            type: 'system',
            content: 'Always respond in English and include an explanation.',
        },
    ]), {
        categoryEnabled: (category) => category !== 'language',
    });

    assert.equal(model.atoms.some(({ category }) => category === 'language'), false);
    assert.equal(model.atoms.some(({ category }) => category === 'directives'), true);
});
