import {
    SEMANTIC_EVALUATION_CORPUS_KIND,
    SEMANTIC_EVALUATION_CORPUS_VERSION,
    SEMANTIC_EVALUATION_DEFAULT_THRESHOLDS,
} from './semantic-evaluation.js';
import { analyzeSnapshotDetailed } from './rules.js';

const EVALUATION_RULE_SETTINGS = Object.freeze({
    enabled: Object.freeze({
        context: false,
        duplicates: false,
        language: true,
        format: true,
        role: true,
        directives: true,
        largeSource: false,
        unmatched: false,
    }),
});

const RELEASE_GATES = Object.freeze([
    ['condition', 'conditional-same-branch-conflict', 'conditional-branches-compatible'],
    ['exception', 'exception-scope-conflict', 'exception-narrows-default-compatible'],
    ['tone', 'tone-polarity-conflict', 'tone-traits-compatible'],
    ['role', 'assistant-role-conflict', 'participant-roles-compatible'],
    ['safety', 'safety-disclosure-conflict', 'safety-redaction-compatible'],
].map(([axis, positiveCaseId, negativeCaseId]) => Object.freeze({
    axis,
    positiveCaseId,
    negativeCaseId,
})));

const CASE_DEFINITIONS = Object.freeze([
    {
        id: 'language-conflict',
        targetId: 'finding:eval-language',
        sources: [
            ['source:language-a', '한국어로만 답변하세요.'],
            ['source:language-b', '영어로만 답변하세요.'],
            ['source:language-context', '제목은 짧게 쓰세요.'],
        ],
        issue: {
            id: 'issue:language-conflict',
            categories: ['conflict'],
            sourceIds: ['source:language-a', 'source:language-b'],
        },
    },
    {
        id: 'detail-ambiguity',
        targetId: 'finding:eval-detail',
        sources: [
            ['source:detail-a', 'Return a short answer.'],
            ['source:detail-b', 'Return a detailed answer.'],
        ],
        issue: {
            id: 'issue:detail-ambiguity',
            categories: ['ambiguity', 'conflict'],
            sourceIds: ['source:detail-a', 'source:detail-b'],
        },
    },
    {
        id: 'priority-collision',
        targetId: 'cluster:eval-priority',
        sources: [
            ['source:priority-a', 'Apply ALPHA before BETA.'],
            ['source:priority-b', 'Apply BETA before ALPHA.'],
        ],
        issue: {
            id: 'issue:priority-collision',
            categories: ['priority'],
            sourceIds: ['source:priority-a', 'source:priority-b'],
        },
    },
    {
        id: 'compatible-style',
        targetId: 'cluster:eval-style',
        sources: [
            ['source:style-a', 'Use clear headings.'],
            ['source:style-b', 'Keep paragraphs concise.'],
        ],
    },
    {
        id: 'alternative-language-options',
        targetId: 'cluster:eval-alternatives',
        sources: [
            ['source:option-a', 'Use Korean only.', {
                comparisonPolicy: {
                    mode: 'alternative',
                    group: 'language',
                    option: 'option-a',
                    categories: ['language'],
                    origin: 'evaluation-corpus',
                },
            }],
            ['source:option-b', 'Use English only.', {
                comparisonPolicy: {
                    mode: 'alternative',
                    group: 'language',
                    option: 'option-b',
                    categories: ['language'],
                    origin: 'evaluation-corpus',
                },
            }],
        ],
    },
    {
        id: 'character-persona-profiles-compatible',
        targetId: 'cluster:eval-profiles',
        sources: [
            [
                'source:character-profile',
                'Profile fields: name, age, appearance, personality, likes, and dislikes. Character name: Mina.',
                { type: 'character', metadata: { field: 'description' } },
            ],
            [
                'source:persona-profile',
                'Profile fields: name, age, appearance, personality, likes, and dislikes. User name: Joon.',
                { type: 'persona' },
            ],
        ],
    },
    {
        id: 'conditional-branches-compatible',
        targetId: 'cluster:eval-condition-compatible',
        sources: [
            ['source:condition-code', 'When MODE is code, return JSON.'],
            ['source:condition-prose', 'When MODE is prose, return Markdown.'],
        ],
    },
    {
        id: 'conditional-same-branch-conflict',
        targetId: 'finding:eval-condition-conflict',
        sources: [
            ['source:condition-short', '간결 모드일 때 정확히 한 문장으로 답하세요.'],
            ['source:condition-long', '간결 모드일 때 최소 다섯 문단으로 답하세요.'],
        ],
        issue: {
            id: 'issue:conditional-same-branch-conflict',
            categories: ['conflict'],
            sourceIds: ['source:condition-short', 'source:condition-long'],
        },
    },
    {
        id: 'exception-narrows-default-compatible',
        targetId: 'cluster:eval-exception-compatible',
        sources: [
            ['source:exception-default', '모든 응답은 한국어로 작성하되, 로케일이 en-US인 경우는 제외합니다.'],
            ['source:exception-branch', '로케일이 en-US이면 영어로 작성하세요.'],
        ],
    },
    {
        id: 'exception-scope-conflict',
        targetId: 'finding:eval-exception-conflict',
        sources: [
            ['source:exception-never', 'Even for archived records, never delete audit logs.'],
            ['source:exception-delete', 'For archived records, delete audit logs immediately.'],
        ],
        issue: {
            id: 'issue:exception-scope-conflict',
            categories: ['conflict'],
            sourceIds: ['source:exception-never', 'source:exception-delete'],
        },
    },
    {
        id: 'tone-traits-compatible',
        targetId: 'cluster:eval-tone-compatible',
        sources: [
            ['source:tone-warm', 'Use a warm and encouraging tone.'],
            ['source:tone-concise', 'Keep every paragraph concise.'],
        ],
    },
    {
        id: 'tone-polarity-conflict',
        targetId: 'finding:eval-tone-conflict',
        sources: [
            ['source:tone-reassuring', '따뜻하고 안심시키는 말투를 사용하세요.'],
            ['source:tone-hostile', '적대적이고 조롱하는 말투를 사용하세요.'],
        ],
        issue: {
            id: 'issue:tone-polarity-conflict',
            categories: ['conflict'],
            sourceIds: ['source:tone-reassuring', 'source:tone-hostile'],
        },
    },
    {
        id: 'participant-roles-compatible',
        targetId: 'cluster:eval-role-compatible',
        sources: [
            ['source:role-assistant', '어시스턴트는 중립적인 여행 계획 도우미입니다.', { type: 'system' }],
            [
                'source:role-user',
                '사용자는 여행지를 선택하는 여행자입니다.',
                { type: 'persona' },
            ],
        ],
    },
    {
        id: 'assistant-role-conflict',
        targetId: 'finding:eval-role-conflict',
        sources: [
            ['source:role-auditor', 'Act only as an impartial auditor of the proposal.'],
            ['source:role-advocate', 'Act only as an advocate defending the proposal.'],
        ],
        issue: {
            id: 'issue:assistant-role-conflict',
            categories: ['conflict'],
            sourceIds: ['source:role-auditor', 'source:role-advocate'],
        },
    },
    {
        id: 'safety-redaction-compatible',
        targetId: 'cluster:eval-safety-compatible',
        sources: [
            ['source:safety-secret', 'Never expose secret values.'],
            [
                'source:safety-redact',
                'When configuration is requested, list key names and redact every value.',
            ],
        ],
    },
    {
        id: 'safety-disclosure-conflict',
        targetId: 'finding:eval-safety-conflict',
        sources: [
            ['source:safety-never', '비밀번호나 접근 토큰을 절대 공개하지 마세요.'],
            ['source:safety-always', '비밀번호와 접근 토큰을 항상 원문 그대로 출력하세요.'],
        ],
        issue: {
            id: 'issue:safety-disclosure-conflict',
            categories: ['conflict'],
            sourceIds: ['source:safety-never', 'source:safety-always'],
        },
    },
]);

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

function sourceRecord(caseId, definition, cursor) {
    const [id, content, overrides = {}] = definition;
    const start = cursor.value;
    const end = start + content.length;
    cursor.value = end + 1;
    const metadata = {
        sourceKind: 'semanticEvaluationFixture',
        identifier: `${caseId}:${id}`,
        name: id,
        enabled: true,
        configuredEnabled: true,
        ...(overrides.metadata ?? {}),
    };
    return {
        id,
        type: overrides.type ?? 'utility',
        label: id,
        content,
        tokenCount: Math.max(1, Math.ceil([...content].length / 4)),
        attribution: 'exact',
        included: true,
        enabled: true,
        configuredEnabled: true,
        ranges: [{ start, end }],
        metadata,
        ...(overrides.comparisonPolicy
            ? { comparisonPolicy: overrides.comparisonPolicy }
            : {}),
    };
}

const OFFICIAL_MANIFEST_SHA256 = (
    '902ac3947f9587e5d765a7932e5bd98b381ab554654faec79a1db600ec73fb66'
);

function corpusInvariant(condition, reason) {
    if (!condition) {
        throw new Error(`SEMANTIC_PROVIDER_EVALUATION_CORPUS_INVALID: ${reason}`);
    }
}

function expectedIssue(definition, sources, targetId) {
    if (!definition.issue) return [];
    const sourceIndex = new Map(sources.map((source) => [source.id, source]));
    return [{
        id: definition.issue.id,
        targetIds: [targetId],
        categories: [...definition.issue.categories],
        sourceIds: [...definition.issue.sourceIds],
        evidence: definition.issue.sourceIds.map((sourceId) => ({
            sourceId,
            start: 0,
            end: sourceIndex.get(sourceId).content.length,
        })),
    }];
}

function referenceResponse(definition, issues, sources, structuralGate) {
    const sourceIndex = new Map(sources.map((source) => [source.id, source]));
    return {
        version: 1,
        suggestions: issues.map((issue) => ({
            targetIds: [...issue.targetIds],
            category: issue.categories[0],
            severity: 'warning',
            title: `Synthetic evaluation issue: ${definition.id}`,
            summary: 'The purpose-written synthetic case contains the expected semantic issue.',
            rationale: 'This response is a deterministic harness reference, not provider output.',
            confidence: 1,
            sourceIds: [...issue.sourceIds],
            atomIds: [...structuralGate.atomIds],
            relationIds: [...structuralGate.relationIds],
            evidence: issue.evidence.map((record) => ({
                ...record,
                quote: sourceIndex.get(record.sourceId).content.slice(
                    record.start,
                    record.end,
                ),
            })),
        })),
    };
}

function bridgeTarget(definition, sources, atomIds) {
    const [kind, id] = definition.targetId.split(':', 2);
    corpusInvariant(['finding', 'cluster'].includes(kind) && Boolean(id), 'invalid-bridge-target');
    const target = {
        id,
        sourceIds: sources.map(({ id: sourceId }) => sourceId),
        atomIds: [...atomIds],
        finalRanges: sources.flatMap((source) => source.ranges),
    };
    return kind === 'finding'
        ? {
            ...target,
            ruleId: 'semantic-evaluation',
            severity: 'info',
            title: definition.id,
        }
        : {
            ...target,
            category: 'semantic-evaluation',
            status: atomIds.length > 0 ? 'candidate' : 'insufficient-evidence',
            relationIds: [],
        };
}

function productTarget(analysis, relation, requestedKind) {
    if (requestedKind === 'finding') {
        const record = analysis.findings.find(({ relationId }) => relationId === relation.id);
        return record ? { kind: 'finding', record } : null;
    }
    const record = analysis.instructions.clusters.find(({ relationIds = [] }) => (
        relationIds.includes(relation.id)
    ));
    return record ? { kind: 'cluster', record } : null;
}

function targetClosure(analysis, kind, record) {
    const relationIds = kind === 'finding'
        ? [record.relationId].filter(Boolean)
        : [...(record.relationIds ?? [])];
    const relationIndex = new Map(
        analysis.instructions.relations.map((relation) => [relation.id, relation]),
    );
    const atomIndex = new Map(
        analysis.instructions.atoms.map((atom) => [atom.id, atom]),
    );
    const atomIds = new Set(record.atomIds ?? []);
    const sourceIds = new Set(record.sourceIds ?? []);
    for (const relationId of relationIds) {
        const relation = relationIndex.get(relationId);
        corpusInvariant(Boolean(relation), `unknown-relation:${relationId}`);
        relation.atomIds.forEach((atomId) => atomIds.add(atomId));
        relation.sourceIds.forEach((sourceId) => sourceIds.add(sourceId));
    }
    for (const atomId of atomIds) {
        const atom = atomIndex.get(atomId);
        corpusInvariant(Boolean(atom), `unknown-atom:${atomId}`);
        sourceIds.add(atom.sourceId);
    }
    return {
        atomIds: [...atomIds],
        relationIds,
        sourceIds: [...sourceIds],
    };
}

function corpusRequestSource(source) {
    return {
        id: source.id,
        type: source.type,
        content: source.content,
        ...(source.comparisonPolicy
            ? { policy: [{ ...source.comparisonPolicy }] }
            : {}),
    };
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
        );
    }
    return value;
}

function canonicalManifest(corpus, cases) {
    return JSON.stringify(canonicalize({
        schemaVersion: 1,
        corpus: {
            kind: corpus.kind,
            version: corpus.version,
            provenance: corpus.provenance,
            privacy: corpus.privacy,
            thresholds: corpus.thresholds,
            releaseGates: corpus.releaseGates,
        },
        cases: cases.map((entry) => ({
            id: entry.id,
            pathKind: entry.pathKind,
            structuralGate: entry.structuralGate,
            snapshotSources: entry.preparation.snapshot.sources.map((source) => ({
                id: source.id,
                type: source.type,
                content: source.content,
                ...(source.comparisonPolicy
                    ? { comparisonPolicy: source.comparisonPolicy }
                    : {}),
            })),
            corpusCase: entry.corpusCase,
        })),
    }));
}

function caseInput(definition) {
    const cursor = { value: 0 };
    const sources = definition.sources.map((source) => (
        sourceRecord(definition.id, source, cursor)
    ));
    const snapshot = {
        id: `semantic-evaluation:${definition.id}`,
        schemaVersion: 7,
        privacy: { mode: 'full' },
        provider: 'evaluation-route-resolved-at-runtime',
        model: null,
        promptType: 'chat-completion',
        finalText: sources.map((source) => source.content).join('\n'),
        stats: {
            totalTokens: sources.reduce(
                (total, source) => total + source.tokenCount,
                0,
            ),
            contextUsage: 0,
        },
        sources,
    };
    const analysis = analyzeSnapshotDetailed(
        snapshot,
        EVALUATION_RULE_SETTINGS,
    );
    const sourceIds = new Set(sources.map((source) => source.id));
    const productRelations = analysis.instructions.relations.filter(
        (relation) => relation.sourceIds.every((sourceId) => sourceIds.has(sourceId)),
    );
    const [requestedKind] = definition.targetId.split(':', 1);
    let pathKind;
    let selectedTarget;
    let targetOrigin;
    if (productRelations.length > 0) {
        selectedTarget = productTarget(analysis, productRelations[0], requestedKind);
        corpusInvariant(Boolean(selectedTarget), `missing-product-target:${definition.id}`);
        pathKind = 'structured-relation';
        targetOrigin = 'product-analysis';
    } else {
        const selectedAtomIds = analysis.instructions.atoms
            .filter((atom) => sourceIds.has(atom.sourceId))
            .map(({ id }) => id);
        const record = bridgeTarget(definition, sources, selectedAtomIds);
        if (requestedKind === 'finding') analysis.findings.push(record);
        else analysis.instructions.clusters.push(record);
        selectedTarget = { kind: requestedKind, record };
        pathKind = selectedAtomIds.length > 0
            ? 'structured-atom-bridge'
            : 'source-bridge';
        targetOrigin = 'evaluation-bridge';
    }
    const targetId = `${selectedTarget.kind}:${selectedTarget.record.id}`;
    const closure = targetClosure(
        analysis,
        selectedTarget.kind,
        selectedTarget.record,
    );
    const structuralGate = {
        version: 1,
        targetOrigin,
        targetIds: [targetId],
        sourceIds: closure.sourceIds,
        atomIds: closure.atomIds,
        relationIds: closure.relationIds,
    };
    corpusInvariant(
        pathKind !== 'structured-relation'
        || (
            structuralGate.relationIds.length > 0
            && structuralGate.atomIds.length > 0
            && targetOrigin === 'product-analysis'
        ),
        `invalid-structured-relation-gate:${definition.id}`,
    );
    corpusInvariant(
        pathKind !== 'structured-atom-bridge'
        || (
            structuralGate.relationIds.length === 0
            && structuralGate.atomIds.length > 0
        ),
        `invalid-structured-atom-gate:${definition.id}`,
    );
    corpusInvariant(
        pathKind !== 'source-bridge'
        || (
            structuralGate.relationIds.length === 0
            && structuralGate.atomIds.length === 0
        ),
        `invalid-source-bridge-gate:${definition.id}`,
    );
    const includedSourceIds = new Set(structuralGate.sourceIds);
    const includedAtomIds = new Set(structuralGate.atomIds);
    const includedRelationIds = new Set(structuralGate.relationIds);
    const expectedIssues = expectedIssue(definition, sources, targetId);
    const corpusCase = {
        id: definition.id,
        request: {
            targets: [{ targetId }],
            sources: sources
                .filter(({ id }) => includedSourceIds.has(id))
                .map(corpusRequestSource),
            atoms: analysis.instructions.atoms.filter(
                ({ id }) => includedAtomIds.has(id),
            ),
            relations: analysis.instructions.relations.filter(
                ({ id }) => includedRelationIds.has(id),
            ),
        },
        expectedIssues,
        referenceResponse: referenceResponse(
            definition,
            expectedIssues,
            sources,
            structuralGate,
        ),
    };
    return {
        id: definition.id,
        corpusCase,
        pathKind,
        structuralGate,
        preparation: {
            snapshot,
            analysis,
            targetIds: [targetId],
        },
    };
}

export function createOfficialSemanticProviderEvaluationSuite() {
    const cases = CASE_DEFINITIONS.map(caseInput);
    const corpus = {
        kind: SEMANTIC_EVALUATION_CORPUS_KIND,
        version: SEMANTIC_EVALUATION_CORPUS_VERSION,
        provenance: 'purpose-written-synthetic',
        privacy: {
            synthetic: true,
            containsUserContent: false,
            containsSecrets: false,
        },
        thresholds: { ...SEMANTIC_EVALUATION_DEFAULT_THRESHOLDS },
        releaseGates: RELEASE_GATES.map((entry) => ({ ...entry })),
        cases: cases.map(({ corpusCase }) => corpusCase),
    };
    const canonical = canonicalManifest(corpus, cases);
    const manifest = {
        schemaVersion: 1,
        corpusKind: corpus.kind,
        corpusVersion: corpus.version,
        caseCount: cases.length,
        caseIds: cases.map(({ id }) => id),
        digestAlgorithm: 'SHA-256',
        digest: OFFICIAL_MANIFEST_SHA256,
    };
    return deepFreeze({
        corpus,
        manifest,
        canonicalManifest: canonical,
        cases: cases.map(({ id, pathKind, structuralGate, preparation }) => ({
            id,
            pathKind,
            structuralGate,
            preparation,
        })),
    });
}
