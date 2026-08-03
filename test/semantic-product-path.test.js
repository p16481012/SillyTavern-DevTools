import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSnapshotDetailed } from '../src/rules.js';
import { SemanticInspector } from '../src/semantic-inspector.js';
import {
    STRUCTURED_SEMANTIC_PRODUCT_CASES,
    structuredSemanticSnapshot,
} from './fixtures/semantic-product-path-cases.js';

const RULE_SETTINGS = {
    enabled: {
        context: false,
        duplicates: false,
        language: true,
        format: true,
        role: true,
        directives: true,
        largeSource: false,
        unmatched: false,
    },
};

class PrepareOnlyAdapter {
    constructor() {
        this.calls = 0;
    }

    identity() {
        return {
            status: 'available',
            provider: 'synthetic-evaluation-provider',
            model: 'structured-product-path',
        };
    }

    async generate() {
        this.calls += 1;
        throw new Error('product-path fixtures must not call a provider');
    }
}

function matchingFinding(analysis, relation) {
    return analysis.findings.find(({ relationId }) => relationId === relation.id) ?? null;
}

function sorted(values) {
    return [...values].sort();
}

for (const fixture of STRUCTURED_SEMANTIC_PRODUCT_CASES) {
    test(`structured semantic product path: ${fixture.id}`, async () => {
        const snapshot = structuredSemanticSnapshot(fixture.sources, fixture.id);
        const analysis = analyzeSnapshotDetailed(snapshot, RULE_SETTINGS);
        const relations = analysis.instructions.relations;

        if (fixture.expectedRelation == null) {
            assert.equal(relations.length, 0, `${fixture.id}: unexpected relation`);
            if (fixture.expectedAtoms) {
                const atoms = fixture.expectedAtoms.category
                    ? analysis.instructions.atoms.filter(
                        ({ category }) => category === fixture.expectedAtoms.category,
                    )
                    : analysis.instructions.atoms;
                assert.equal(
                    atoms.length,
                    fixture.expectedAtoms.count,
                    `${fixture.id}: atom boundary changed`,
                );
            }
            assert.equal(
                analysis.findings.some(({ relationId }) => Boolean(relationId)),
                false,
                `${fixture.id}: a relation-backed provider target must not be invented`,
            );
            return;
        }

        assert.equal(relations.length, 1, `${fixture.id}: expected one product relation`);
        const relation = relations[0];
        assert.equal(relation.category, fixture.expectedRelation.category);
        assert.equal(relation.kind, fixture.expectedRelation.kind);
        assert.equal(relation.status, fixture.expectedRelation.status);
        assert.equal(relation.atomIds.length, 2);
        assert.equal(relation.sourceIds.length, 2);

        if (fixture.expectedRelation.condition) {
            assert.equal(
                relation.conditions.some((value) => fixture.expectedRelation.condition.test(value)),
                true,
                `${fixture.id}: condition was not preserved on the relation`,
            );
        }
        if (fixture.expectedRelation.exception) {
            assert.equal(
                relation.exceptions.some((value) => fixture.expectedRelation.exception.test(value)),
                true,
                `${fixture.id}: exception was not preserved on the relation`,
            );
        }

        const finding = matchingFinding(analysis, relation);
        assert.ok(finding, `${fixture.id}: relation-backed finding missing`);
        assert.equal(finding.clusterId, relation.clusterId);
        assert.deepEqual(sorted(finding.atomIds), sorted(relation.atomIds));
        assert.deepEqual(sorted(finding.sourceIds), sorted(relation.sourceIds));

        const adapter = new PrepareOnlyAdapter();
        const inspector = new SemanticInspector({ adapter });
        const prepared = await inspector.prepare({
            snapshot,
            analysis,
            targetIds: [`finding:${finding.id}`],
            responseTokenCap: 256,
        });

        assert.equal(adapter.calls, 0);
        assert.equal(prepared.request.targets.length, 1);
        assert.equal(prepared.request.targets[0].id, finding.id);
        assert.deepEqual(
            sorted(prepared.request.targets[0].sourceIds),
            sorted(relation.sourceIds),
        );
        assert.deepEqual(
            sorted(prepared.request.targets[0].atomIds),
            sorted(relation.atomIds),
        );
        assert.deepEqual(prepared.request.targets[0].relationIds, [relation.id]);
        assert.deepEqual(
            sorted(prepared.request.sources.map(({ id }) => id)),
            sorted(relation.sourceIds),
        );
        assert.deepEqual(
            sorted(prepared.request.atoms.map(({ id }) => id)),
            sorted(relation.atomIds),
        );
        assert.deepEqual(prepared.request.relations.map(({ id }) => id), [relation.id]);
        assert.equal(
            prepared.request.sources.some(({ id }) => id.endsWith(':unrelated')),
            false,
            `${fixture.id}: unrelated source escaped the selected closure`,
        );

        const preparedRelation = prepared.request.relations[0];
        assert.deepEqual(sorted(preparedRelation.atomIds), sorted(relation.atomIds));
        assert.deepEqual(sorted(preparedRelation.sourceIds), sorted(relation.sourceIds));
        assert.deepEqual(preparedRelation.conditions, relation.conditions);
        assert.deepEqual(preparedRelation.exceptions, relation.exceptions);

        const productAtoms = new Map(
            analysis.instructions.atoms.map((atom) => [atom.id, atom]),
        );
        for (const atom of prepared.request.atoms) {
            const productAtom = productAtoms.get(atom.id);
            assert.ok(productAtom, `${fixture.id}: prepared atom was not product-generated`);
            assert.equal(atom.sourceId, productAtom.sourceId);
            assert.equal(atom.category, productAtom.category);
            assert.equal(atom.property, productAtom.property);
            assert.equal(atom.value, productAtom.value);
            assert.equal(atom.polarity, productAtom.polarity);
            assert.equal(atom.condition, productAtom.condition ?? '');
            assert.equal(atom.exception, productAtom.exception ?? '');
            assert.deepEqual(atom.localRange, productAtom.localRange);
        }

        const cluster = analysis.instructions.clusters.find(
            ({ id }) => id === relation.clusterId,
        );
        assert.ok(cluster, `${fixture.id}: product cluster missing`);
        const clusterPrepared = await inspector.prepare({
            snapshot,
            analysis,
            targetIds: [`cluster:${cluster.id}`],
            responseTokenCap: 256,
        });
        assert.deepEqual(
            sorted(clusterPrepared.request.relations.map(({ id }) => id)),
            sorted(cluster.relationIds),
        );
        assert.deepEqual(
            sorted(clusterPrepared.request.atoms.map(({ id }) => id)),
            sorted(cluster.atomIds),
        );
        assert.deepEqual(
            sorted(clusterPrepared.request.sources.map(({ id }) => id)),
            sorted(cluster.sourceIds),
        );
    });
}

