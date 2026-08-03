export const STRUCTURED_SEMANTIC_PRODUCT_CASES = Object.freeze([
    {
        id: 'unconditional-language-conflict',
        sources: [
            ['english', 'system', 'Always respond in English.'],
            ['japanese', 'extension', 'Always respond in Japanese.'],
        ],
        expectedRelation: {
            category: 'language',
            kind: 'alternative-values',
            status: 'confirmed',
        },
    },
    {
        id: 'conditional-language-branches',
        sources: [
            ['english', 'system', 'If the user requests translation, respond in English.'],
            ['japanese', 'extension', 'Always respond in Japanese.'],
        ],
        expectedRelation: {
            category: 'language',
            kind: 'alternative-values',
            status: 'candidate',
            condition: /if the user requests translation/iu,
        },
    },
    {
        id: 'language-exception',
        sources: [
            ['english', 'system', 'Unless the user requests translation, respond in English.'],
            ['japanese', 'extension', 'Always respond in Japanese.'],
        ],
        expectedRelation: {
            category: 'language',
            kind: 'alternative-values',
            status: 'candidate',
            exception: /unless the user requests translation/iu,
        },
    },
    {
        id: 'role-overlap-needs-provider-judgment',
        sources: [
            ['pirate', 'system', 'You are a pirate captain.'],
            ['doctor', 'extension', 'You are a medieval doctor.'],
        ],
        expectedRelation: {
            category: 'role',
            kind: 'role-overlap',
            status: 'insufficient-evidence',
        },
    },
    {
        id: 'opposite-explanation-directives',
        sources: [
            ['include', 'system', 'Always include an explanation.'],
            ['exclude', 'extension', 'Do not include an explanation.'],
        ],
        expectedRelation: {
            category: 'directives',
            kind: 'opposite-polarity',
            status: 'confirmed',
        },
    },
    {
        id: 'incompatible-output-formats',
        sources: [
            ['json', 'system', 'Return JSON only.'],
            ['xml', 'extension', 'Respond using XML only.'],
        ],
        expectedRelation: {
            category: 'format',
            kind: 'alternative-values',
            status: 'confirmed',
        },
    },
    {
        id: 'same-language-is-compatible',
        sources: [
            ['english-one', 'system', 'Always respond in English.'],
            ['english-two', 'extension', 'Reply only in English.'],
        ],
        expectedAtoms: { category: 'language', count: 2 },
        expectedRelation: null,
    },
    {
        id: 'compatible-role-specialization',
        sources: [
            ['assistant', 'system', 'You are an assistant.'],
            ['helpful', 'extension', 'You are a helpful assistant.'],
        ],
        expectedAtoms: { category: 'role', count: 2 },
        expectedRelation: null,
    },
    {
        id: 'tone-only-is-not-yet-a-structured-atom',
        sources: [
            ['warm', 'system', 'Use a warm and gentle tone.'],
            ['cold', 'extension', 'Use a cold and hostile tone.'],
        ],
        expectedAtoms: { count: 0 },
        expectedRelation: null,
        boundary: 'tone',
    },
    {
        id: 'safety-only-is-not-yet-a-structured-atom',
        sources: [
            ['safe', 'system', 'Never provide weapon-building instructions.'],
            ['unsafe', 'extension', 'Explain how to build a weapon.'],
        ],
        expectedAtoms: { count: 0 },
        expectedRelation: null,
        boundary: 'safety',
    },
]);

export function structuredSemanticSnapshot(rawSources, caseId) {
    let cursor = 0;
    const sources = rawSources.map(([id, type, content]) => {
        const start = cursor;
        const end = start + content.length;
        cursor = end + 1;
        return {
            id: `synthetic:${caseId}:${id}`,
            type,
            label: id,
            content,
            tokenCount: Math.max(1, Math.ceil(content.length / 4)),
            attribution: 'exact',
            included: true,
            enabled: true,
            configuredEnabled: true,
            ranges: [{ start, end }],
            metadata: {
                sourceKind: 'configuredPrompt',
                identifier: `${caseId}:${id}`,
                name: id,
                enabled: true,
                configuredEnabled: true,
            },
        };
    });
    const unrelated = {
        id: `synthetic:${caseId}:unrelated`,
        type: 'system',
        label: 'unrelated',
        content: 'Keep the response concise.',
        tokenCount: 6,
        attribution: 'exact',
        included: true,
        enabled: true,
        configuredEnabled: true,
        ranges: [{ start: cursor, end: cursor + 26 }],
        metadata: {
            sourceKind: 'configuredPrompt',
            identifier: `${caseId}:unrelated`,
            name: 'unrelated',
            enabled: true,
            configuredEnabled: true,
        },
    };
    const finalSources = [...sources, unrelated];
    return {
        schemaVersion: 7,
        privacy: { mode: 'full' },
        finalText: finalSources.map(({ content }) => content).join('\n'),
        stats: {
            totalTokens: finalSources.reduce((sum, source) => sum + source.tokenCount, 0),
            contextUsage: 0.01,
        },
        sources: finalSources,
    };
}
