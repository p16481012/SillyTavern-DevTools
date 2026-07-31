import { annotateSourcesWithPolicies } from './comparison-policy.js';
import { findingKey, sourceFingerprint } from './finding-review.js';
import { analyzeSnapshotDetailed } from './rules.js';

function policySignature(source) {
    const policy = source?.comparisonPolicy ?? source?.metadata?.comparisonPolicy ?? null;
    if (!policy) return 'none';
    return JSON.stringify({
        profileId: policy.profileId ?? null,
        groupDefinitionId: policy.groupDefinitionId ?? null,
        groupKey: policy.groupKey ?? null,
        option: policy.option ?? null,
        mode: policy.mode ?? null,
        categories: policy.categories ?? ['*'],
        origin: policy.origin ?? null,
    });
}

function findingMultiset(findings, sources) {
    const result = new Map();
    for (const finding of findings ?? []) {
        const key = findingKey(finding, sources);
        result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
}

function multisetDelta(before, after) {
    let added = 0;
    let removed = 0;
    let unchanged = 0;
    const keys = new Set([...before.keys(), ...after.keys()]);
    for (const key of keys) {
        const beforeCount = before.get(key) ?? 0;
        const afterCount = after.get(key) ?? 0;
        unchanged += Math.min(beforeCount, afterCount);
        added += Math.max(0, afterCount - beforeCount);
        removed += Math.max(0, beforeCount - afterCount);
    }
    return { added, removed, unchanged };
}

export function buildPolicyChangePreview(
    snapshot,
    beforeRuleSettings,
    beforePolicy,
    afterPolicy,
    afterRuleSettings = beforeRuleSettings,
) {
    const sources = snapshot?.sources ?? [];
    const beforeAnalysis = analyzeSnapshotDetailed(
        snapshot,
        beforeRuleSettings,
        beforePolicy,
    );
    const afterAnalysis = analyzeSnapshotDetailed(
        snapshot,
        afterRuleSettings,
        afterPolicy,
    );
    const findingDelta = multisetDelta(
        findingMultiset(beforeAnalysis.findings, sources),
        findingMultiset(afterAnalysis.findings, sources),
    );

    const beforeSources = annotateSourcesWithPolicies(sources, beforePolicy, snapshot);
    const afterSources = annotateSourcesWithPolicies(sources, afterPolicy, snapshot);
    const beforeByFingerprint = new Map(beforeSources.map(
        (source) => [sourceFingerprint(source), policySignature(source)],
    ));
    const assignmentChanges = [];
    for (const source of afterSources) {
        const fingerprint = sourceFingerprint(source);
        const before = beforeByFingerprint.get(fingerprint) ?? 'none';
        const after = policySignature(source);
        if (before === after) continue;
        assignmentChanges.push({
            sourceId: source.id,
            sourceFingerprint: fingerprint,
            label: source.label ?? source.metadata?.name ?? source.id,
            before,
            after,
        });
    }

    return {
        before: {
            findings: beforeAnalysis.findings.length,
            suppressed: beforeAnalysis.comparison?.suppressedComparisonCount
                ?? beforeAnalysis.comparison?.suppressedComparisons?.length
                ?? 0,
            warnings: beforeAnalysis.comparison?.groupWarnings?.length ?? 0,
        },
        after: {
            findings: afterAnalysis.findings.length,
            suppressed: afterAnalysis.comparison?.suppressedComparisonCount
                ?? afterAnalysis.comparison?.suppressedComparisons?.length
                ?? 0,
            warnings: afterAnalysis.comparison?.groupWarnings?.length ?? 0,
        },
        findingDelta,
        assignmentChanges,
        truncated: Boolean(
            beforeAnalysis.instructions?.stats?.atomsTruncated
            || beforeAnalysis.instructions?.stats?.relationsTruncated
            || beforeAnalysis.instructions?.stats?.alertsTruncated
            || afterAnalysis.instructions?.stats?.atomsTruncated
            || afterAnalysis.instructions?.stats?.relationsTruncated
            || afterAnalysis.instructions?.stats?.alertsTruncated
        ),
    };
}
