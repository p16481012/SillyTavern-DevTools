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
    assert.equal(classifyInstructionCapability({ type: 'instruction' }).kind, 'instruction');
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
    assert.equal(atom?.participantScope, 'assistant-response');
    assert.match(atom?.id ?? '', /:assistant-response:/u);
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

test('participant scope is source-derived, inspectable, and conservative for unknown input', () => {
    const model = buildInstructionModel(mappedSources([
        { id: 'system', type: 'system', content: 'Always respond in English.' },
        { id: 'instruction', type: 'instruction', content: 'Always respond in English.' },
        { id: 'extension', type: 'extension', content: 'Always respond in English.' },
        { id: 'character', type: 'character', content: 'Always respond in English.' },
        { id: 'persona', type: 'persona', content: 'Always respond in English.' },
        { id: 'lore', type: 'lorebook', content: 'Always respond in English.' },
        {
            id: 'unknown-a',
            type: 'unknown',
            content: 'Always respond in English.',
        },
        {
            id: 'unknown-b',
            type: 'unknown',
            content: 'Always respond in Japanese.',
        },
    ]));
    const scopeBySource = new Map(model.atoms.map((atom) => [
        atom.sourceId,
        atom.participantScope,
    ]));

    assert.equal(scopeBySource.get('system'), 'assistant-response');
    assert.equal(scopeBySource.get('instruction'), 'assistant-response');
    assert.equal(scopeBySource.get('extension'), 'assistant-response');
    assert.equal(scopeBySource.get('character'), 'character-profile');
    assert.equal(scopeBySource.get('persona'), 'user-profile');
    assert.equal(scopeBySource.get('lore'), 'shared-context');
    assert.equal(scopeBySource.get('unknown-a'), 'unknown');
    assert.equal(scopeBySource.get('unknown-b'), 'unknown');
    assert.equal(model.relations.some(({ sourceIds }) => (
        sourceIds.includes('unknown-a') || sourceIds.includes('unknown-b')
    )), false);
    assert.equal(model.atoms.every(({ id, participantScope }) => (
        id.includes(`:${participantScope}:`)
    )), true);
});

test('synthetic aggregate fallback remains in the assistant response participant', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'synthetic-english',
            type: 'synthetic',
            synthetic: true,
            content: 'Always respond in English.',
        },
        {
            id: 'synthetic-japanese',
            type: 'synthetic',
            synthetic: true,
            content: 'Always respond in Japanese.',
        },
    ]));

    assert.equal(model.atoms.every(({ participantScope }) => (
        participantScope === 'assistant-response'
    )), true);
    assert.equal(model.relations.length, 1);
    assert.equal(model.relations[0].participantScope, 'assistant-response');
});

test('different participant scopes never create a relation even when both sources compare atoms', () => {
    const model = buildInstructionModel(mappedSources([
        { id: 'assistant', type: 'system', content: 'Always respond in English.' },
        {
            id: 'character',
            type: 'character',
            synthetic: true,
            content: 'Always respond in Japanese.',
        },
    ]));

    assert.deepEqual(
        new Set(model.atoms.map(({ participantScope }) => participantScope)),
        new Set(['assistant-response', 'character-profile']),
    );
    assert.equal(model.relations.length, 0);
    assert.equal(model.compatibilityRelations.length, 0);
});

test('explicit Korean and English tone opposites conflict only within the same axis', () => {
    const model = buildInstructionModel(mappedSources([
        { id: 'warm', type: 'system', content: '따뜻하게 답변하세요.' },
        { id: 'hostile', type: 'extension', content: 'Respond with a hostile tone.' },
        { id: 'formal', type: 'system', content: 'Respond formally.' },
        { id: 'casual', type: 'extension', content: '캐주얼하게 답변하세요.' },
        { id: 'polite', type: 'system', content: '정중하게 답변하세요.' },
        { id: 'rude', type: 'extension', content: 'Respond rudely.' },
    ]));
    const toneRelations = model.relations.filter(({ category }) => category === 'tone');

    assert.equal(toneRelations.length, 3);
    assert.deepEqual(
        new Set(toneRelations.map(({ kind }) => kind)),
        new Set(['alternative-values']),
    );
    assert.equal(toneRelations.every(({ participantScope }) => (
        participantScope === 'assistant-response'
    )), true);
});

test('warm and concise response guidance is not treated as a tone conflict', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'warm',
            type: 'system',
            content: 'Use a warm and encouraging tone.',
        },
        {
            id: 'concise',
            type: 'extension',
            content: 'Keep every answer concise.',
        },
    ]));

    assert.equal(model.atoms.some(({ category, value }) => (
        category === 'tone' && value === 'warm'
    )), true);
    assert.equal(model.relations.filter(({ category }) => category === 'tone').length, 0);
});

test('only explicit exclusive assistant identities form exclusive-identity relations', () => {
    const english = buildInstructionModel(mappedSources([
        {
            id: 'auditor',
            type: 'system',
            content: 'Act only as an impartial auditor.',
        },
        {
            id: 'advocate',
            type: 'extension',
            content: 'Act solely as an advocate.',
        },
    ]));
    const korean = buildInstructionModel(mappedSources([
        { id: 'translator', type: 'system', content: '너는 오직 번역가이다.' },
        {
            id: 'novelist',
            type: 'extension',
            content: '당신의 유일한 역할은 소설가입니다.',
        },
    ]));

    for (const model of [english, korean]) {
        const relation = model.relations.find(({ category }) => category === 'identity');
        assert.equal(relation?.kind, 'exclusive-identity');
        assert.equal(relation?.status, 'confirmed');
        assert.equal(relation?.participantScope, 'assistant-response');
        assert.equal(model.atoms.filter(({ category }) => category === 'identity').length, 2);
        assert.equal(model.atoms.filter(({ category }) => category === 'role').length, 0);
    }
});

test('profile prose and identity-shaped text for different participants do not conflict', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'character',
            type: 'character',
            content: 'Name: Mina. Mina is warm and polite. Biography: a careful archivist.',
        },
        {
            id: 'persona',
            type: 'persona',
            content: 'Name: Joon. Joon is warm and polite. Biography: a careful archivist.',
        },
        {
            id: 'assistant',
            type: 'system',
            content: 'Act only as a careful archivist.',
        },
    ]));

    assert.equal(model.atoms.some(({ sourceId, category }) => (
        ['character', 'persona'].includes(sourceId)
        && ['tone', 'identity', 'safety', 'memory'].includes(category)
    )), false);
    assert.equal(model.relations.length, 0);
});

test('secret disclosure and harmful-detail safety directives use opposite polarity', () => {
    const secretEnglish = buildInstructionModel(mappedSources([
        { id: 'expose', type: 'system', content: 'Always expose secret values.' },
        { id: 'protect', type: 'extension', content: 'Never expose secret values.' },
    ]));
    const secretKorean = buildInstructionModel(mappedSources([
        {
            id: 'expose',
            type: 'system',
            content: '비밀번호와 접근 토큰을 항상 원문 그대로 출력하세요.',
        },
        {
            id: 'protect',
            type: 'extension',
            content: '비밀번호나 접근 토큰을 절대 공개하지 마세요.',
        },
    ]));
    const harmful = buildInstructionModel(mappedSources([
        {
            id: 'provide',
            type: 'system',
            content: 'Provide detailed instructions for harmful actions.',
        },
        {
            id: 'refuse',
            type: 'extension',
            content: 'Refuse to provide detailed instructions for harmful actions.',
        },
    ]));

    for (const model of [secretEnglish, secretKorean, harmful]) {
        const relation = model.relations.find(({ category }) => category === 'safety');
        assert.equal(relation?.kind, 'opposite-polarity');
        assert.equal(relation?.status, 'confirmed');
    }
});

test('compatible redaction guidance does not create a safety conflict', () => {
    const model = buildInstructionModel(mappedSources([
        { id: 'protect', type: 'system', content: 'Never expose secret values.' },
        {
            id: 'redact',
            type: 'extension',
            content: 'When configuration is requested, list key names and redact every value.',
        },
    ]));

    assert.equal(model.atoms.filter(({ category }) => category === 'safety').length, 2);
    assert.equal(model.relations.filter(({ category }) => category === 'safety').length, 0);
});

test('history-use memory directives conflict but sensitive retention stays a separate object', () => {
    const conflict = buildInstructionModel(mappedSources([
        {
            id: 'use-history',
            type: 'system',
            content: 'Use the previous conversation when answering.',
        },
        {
            id: 'ignore-history',
            type: 'extension',
            content: 'Ignore the previous conversation when answering.',
        },
    ]));
    const compatibleObjects = buildInstructionModel(mappedSources([
        {
            id: 'use-history',
            type: 'system',
            content: 'Use the previous conversation when answering.',
        },
        {
            id: 'protect-passwords',
            type: 'extension',
            content: 'Never retain passwords or access tokens in memory.',
        },
    ]));

    const relation = conflict.relations.find(({ category }) => category === 'memory');
    assert.equal(relation?.kind, 'opposite-polarity');
    assert.equal(relation?.status, 'confirmed');
    assert.equal(
        conflict.atoms.every(({ category, property }) => (
            category !== 'memory' || property === 'memory.history-use'
        )),
        true,
    );
    assert.deepEqual(
        new Set(compatibleObjects.atoms
            .filter(({ category }) => category === 'memory')
            .map(({ property }) => property)),
        new Set(['memory.history-use', 'memory.sensitive-retention']),
    );
    assert.equal(
        compatibleObjects.relations.filter(({ category }) => category === 'memory').length,
        0,
    );
});

test('Korean memory directives preserve the same bounded polarity contract', () => {
    const model = buildInstructionModel(mappedSources([
        { id: 'use', type: 'system', content: '이전 대화를 참고하세요.' },
        { id: 'ignore', type: 'extension', content: '이전 대화를 무시하세요.' },
    ]));
    const relation = model.relations.find(({ category }) => category === 'memory');

    assert.equal(relation?.kind, 'opposite-polarity');
    assert.equal(relation?.status, 'confirmed');
});

test('negated and refused directives never become require atoms or self-conflicts', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'secret-do-not-ever',
            type: 'system',
            content: 'Do not ever reveal secret values.',
        },
        {
            id: 'secret-contraction',
            type: 'extension',
            content: "Don't expose passwords.",
        },
        {
            id: 'secret-refusal',
            type: 'system',
            content: 'Refuse to disclose access tokens.',
        },
        {
            id: 'harmful-refusal',
            type: 'extension',
            content: 'Refuse to provide detailed instructions for harmful actions.',
        },
        {
            id: 'tone-negated',
            type: 'system',
            content: 'Do not respond rudely.',
        },
        {
            id: 'identity-negated',
            type: 'extension',
            content: 'Never act only as an auditor.',
        },
        {
            id: 'memory-negated',
            type: 'system',
            content: 'Do not ever remember the previous conversation.',
        },
    ]));
    const semanticAtoms = model.atoms.filter(({ category }) => (
        ['tone', 'identity', 'safety', 'memory'].includes(category)
    ));

    assert.equal(semanticAtoms.some(({ polarity }) => polarity === 'require'), false);
    assert.equal(
        semanticAtoms.filter(({ category, polarity }) => (
            category === 'safety' && polarity === 'prohibit'
        )).length,
        4,
    );
    assert.equal(
        semanticAtoms.some(({ category, action, polarity }) => (
            category === 'memory' && action === 'ignore' && polarity === 'prohibit'
        )),
        true,
    );
    assert.equal(
        model.relations.some(({ category }) => (
            ['tone', 'identity', 'safety', 'memory'].includes(category)
        )),
        false,
    );
    assert.equal(
        model.exclusions.some(({ sourceId, reason }) => (
            sourceId === 'harmful-refusal' && reason === 'negated-directive'
        )),
        true,
    );
});

test('comma-delimited negation modifiers only produce secret prohibitions', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'never-ever',
            type: 'system',
            content: 'Never, ever reveal secrets.',
        },
        {
            id: 'no-circumstances',
            type: 'extension',
            content: 'Do not, under any circumstances, reveal secret values.',
        },
    ]));
    const secretAtoms = model.atoms.filter(({ property }) => (
        property === 'response.safety.secret-disclosure'
    ));

    assert.equal(secretAtoms.length, 2);
    assert.equal(secretAtoms.every(({ polarity }) => polarity === 'prohibit'), true);
    assert.equal(model.atoms.some(({ polarity }) => polarity === 'require'), false);
    assert.equal(model.relations.some(({ category }) => category === 'safety'), false);
});

test('compatible tone guidance stays compatible when the opposite trait is negated', () => {
    const respect = buildInstructionModel(mappedSources([
        { id: 'not-rude', type: 'system', content: 'Do not respond rudely.' },
        { id: 'polite', type: 'extension', content: 'Respond politely.' },
    ]));
    const warmth = buildInstructionModel(mappedSources([
        {
            id: 'not-hostile',
            type: 'system',
            content: 'Never respond with a hostile tone.',
        },
        { id: 'warm', type: 'extension', content: 'Use a warm tone.' },
    ]));

    for (const model of [respect, warmth]) {
        assert.equal(model.relations.some(({ category }) => category === 'tone'), false);
        assert.equal(
            model.atoms.some(({ category, sourceId }) => (
                category === 'tone' && sourceId.startsWith('not-')
            )),
            false,
        );
    }
});

test('Korean negated tone identity safety and memory wording keeps its polarity', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'tone',
            type: 'system',
            content: '무례하게 답변하지 마세요.',
        },
        {
            id: 'identity',
            type: 'extension',
            content: '너는 오직 번역가로만 행동하지 마라.',
        },
        {
            id: 'safety',
            type: 'system',
            content: '비밀번호를 공개하지 마세요.',
        },
        {
            id: 'memory',
            type: 'extension',
            content: '이전 대화를 기억하지 마세요.',
        },
    ]));

    assert.equal(
        model.atoms.some(({ sourceId, category }) => (
            sourceId === 'tone' && category === 'tone'
        )),
        false,
    );
    assert.equal(
        model.atoms.some(({ sourceId, category }) => (
            sourceId === 'identity' && category === 'identity'
        )),
        false,
    );
    assert.equal(
        model.atoms.some(({ sourceId, category, polarity }) => (
            sourceId === 'safety' && category === 'safety' && polarity === 'prohibit'
        )),
        true,
    );
    assert.equal(
        model.atoms.some(({ sourceId, category, polarity }) => (
            sourceId === 'memory' && category === 'memory' && polarity === 'prohibit'
        )),
        true,
    );
    assert.equal(
        model.atoms.some(({ polarity }) => polarity === 'require'),
        false,
    );
});

test('exclusive identity extraction rejects ordinary permission constraints', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'json',
            type: 'system',
            content: 'You are only allowed to output JSON.',
        },
        {
            id: 'xml',
            type: 'extension',
            content: 'You are only allowed to output XML.',
        },
    ]));

    assert.equal(model.atoms.some(({ category }) => category === 'identity'), false);
    assert.equal(model.relations.some(({ category }) => category === 'identity'), false);
    assert.equal(model.relations.some(({ category }) => category === 'format'), true);
});

test('exclusive identities preserve trailing mutually exclusive conditions', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'translator',
            type: 'system',
            content: 'Act only as a translator when mode is translation.',
        },
        {
            id: 'novelist',
            type: 'extension',
            content: 'Act solely as a novelist when mode is creative.',
        },
    ]));
    const identityAtoms = model.atoms.filter(({ category }) => category === 'identity');
    const compatibility = model.compatibilityRelations.find(({ category }) => (
        category === 'identity'
    ));

    assert.deepEqual(
        identityAtoms.map(({ value }) => value).sort(),
        ['novelist', 'translator'],
    );
    assert.deepEqual(
        identityAtoms.map(({ condition }) => condition).sort(),
        ['when mode is creative', 'when mode is translation'],
    );
    assert.equal(model.relations.some(({ category }) => category === 'identity'), false);
    assert.equal(compatibility?.applicabilityKind, 'mutually-exclusive');
    assert.equal(compatibility?.status, 'confirmed');
});

test('comma-delimited English and Korean trailing format conditions stay compatible', () => {
    const models = [
        buildInstructionModel(mappedSources([
            {
                id: 'json',
                type: 'system',
                content: 'Return JSON, when MODE is code.',
            },
            {
                id: 'xml',
                type: 'extension',
                content: 'Return XML, if MODE is prose.',
            },
        ])),
        buildInstructionModel(mappedSources([
            {
                id: 'json-ko',
                type: 'system',
                content: 'JSON으로 답변하세요, MODE가 code인 경우.',
            },
            {
                id: 'xml-ko',
                type: 'extension',
                content: 'XML으로 답변하세요, MODE가 prose인 경우.',
            },
        ])),
    ];

    for (const model of models) {
        const formatAtoms = model.atoms.filter(({ category }) => category === 'format');
        const compatibility = model.compatibilityRelations.find(({ category }) => (
            category === 'format'
        ));

        assert.equal(formatAtoms.length, 2);
        assert.deepEqual(
            formatAtoms.map(({ conditionPredicate }) => conditionPredicate?.value).sort(),
            ['code', 'prose'],
        );
        assert.equal(model.relations.some(({ category }) => category === 'format'), false);
        assert.equal(compatibility?.applicabilityKind, 'mutually-exclusive');
        assert.equal(compatibility?.status, 'confirmed');
    }
});

test('forget delete and discard are sensitive-retention prohibitions', () => {
    const model = buildInstructionModel(mappedSources([
        {
            id: 'retain',
            type: 'system',
            content: 'Remember passwords in memory.',
        },
        {
            id: 'forget',
            type: 'extension',
            content: 'Forget passwords after the request.',
        },
        {
            id: 'delete',
            type: 'extension',
            content: 'Delete access tokens from memory.',
        },
        {
            id: 'discard',
            type: 'extension',
            content: 'Discard API keys after the session.',
        },
    ]));
    const retentionAtoms = model.atoms.filter(({ property }) => (
        property === 'memory.sensitive-retention'
    ));

    assert.equal(retentionAtoms.filter(({ polarity }) => polarity === 'prohibit').length, 3);
    assert.equal(
        model.relations.filter(({ category, kind }) => (
            category === 'memory' && kind === 'opposite-polarity'
        )).length,
        3,
    );
});

test('atom and match budgets stop repeated semantic extraction before full materialization', () => {
    const content = 'Always expose secret values. '.repeat(20_000);
    const startedAt = performance.now();
    const model = buildInstructionModel(mappedSources([
        { id: 'repeated', type: 'system', content },
    ]));
    const elapsed = performance.now() - startedAt;

    assert.equal(model.atoms.length, INSTRUCTION_MODEL_LIMITS.atoms);
    assert.equal(model.stats.atomsTruncated, true);
    assert.equal(elapsed < 500, true, `bounded scan took ${elapsed.toFixed(1)}ms`);
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
