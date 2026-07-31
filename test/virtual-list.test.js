import assert from 'node:assert/strict';
import test from 'node:test';

import {
    calculateFixedVirtualWindow,
    VirtualListMetrics,
} from '../src/virtual-list.js';

test('fixed virtual windows expose bounded spacers and accessibility positions', () => {
    const result = calculateFixedVirtualWindow({
        itemCount: 100,
        rowHeight: 20,
        scrollTop: 200,
        viewportHeight: 100,
        overscan: 2,
    });
    assert.deepEqual(result, {
        totalCount: 100,
        start: 8,
        end: 17,
        visibleCount: 9,
        topSpacer: 160,
        bottomSpacer: 1_660,
        totalHeight: 2_000,
        aria: {
            setSize: 100,
            firstPosition: 9,
            lastPosition: 17,
        },
    });
});

test('measured row heights update variable virtual windows without a full scan', () => {
    const metrics = new VirtualListMetrics({
        itemCount: 100,
        estimatedRowHeight: 20,
        overscan: 1,
    });
    assert.equal(metrics.updateMeasuredHeight(10, 100), true);
    assert.equal(metrics.updateMeasuredHeight(-1, 40), false);
    assert.equal(metrics.totalHeight(), 2_080);
    assert.equal(metrics.offsetForIndex(11), 300);

    const result = metrics.getWindow({
        scrollTop: 190,
        viewportHeight: 130,
    });
    assert.equal(result.start, 8);
    assert.equal(result.end >= 12, true);
    assert.equal(result.topSpacer, metrics.offsetForIndex(result.start));
    assert.equal(
        result.topSpacer + result.bottomSpacer <= result.totalHeight,
        true,
    );
});

test('a 5,000-item virtual list keeps the rendered window bounded', () => {
    const metrics = new VirtualListMetrics({
        itemCount: 5_000,
        estimatedRowHeight: 72,
        overscan: 6,
    });
    for (let index = 0; index < 5_000; index += 37) {
        metrics.updateMeasuredHeight(index, 48 + (index % 5));
    }
    const startedAt = performance.now();
    const result = metrics.getWindow({
        scrollTop: 280_000,
        viewportHeight: 900,
    });
    const duration = performance.now() - startedAt;
    assert.equal(result.totalCount, 5_000);
    assert.equal(result.visibleCount < 40, true);
    assert.equal(duration < 50, true);
});

test('variable-height offsets use a logarithmic Fenwick lower bound', () => {
    const metrics = new VirtualListMetrics({
        itemCount: 5_000,
        estimatedRowHeight: 40,
        overscan: 3,
    });
    for (let index = 0; index < 5_000; index += 11) {
        metrics.updateMeasuredHeight(index, 20 + (index % 91));
    }

    for (const index of [0, 1, 10, 11, 999, 2_500, 4_999, 5_000]) {
        const offset = metrics.offsetForIndex(index);
        assert.equal(metrics.indexAtOffset(offset), index);
        if (index < 5_000) {
            const next = metrics.offsetForIndex(index + 1);
            assert.equal(
                metrics.indexAtOffset(offset + ((next - offset) / 2)),
                index,
            );
        }
    }

    let prefixCalls = 0;
    const originalOffsetForIndex = metrics.offsetForIndex.bind(metrics);
    metrics.offsetForIndex = (...args) => {
        prefixCalls += 1;
        return originalOffsetForIndex(...args);
    };
    assert.equal(metrics.indexAtOffset(123_456) < 5_000, true);
    assert.equal(prefixCalls, 0);

    const window = metrics.getWindow({
        scrollTop: 123_456,
        viewportHeight: 640,
    });
    const renderedHeight = (
        originalOffsetForIndex(window.end)
        - originalOffsetForIndex(window.start)
    );
    assert.equal(
        window.topSpacer + renderedHeight + window.bottomSpacer,
        window.totalHeight,
    );
    assert.equal(window.aria.firstPosition, window.start + 1);
    assert.equal(window.aria.lastPosition, window.end);
});

test('empty virtual windows expose null accessibility positions', () => {
    const fixed = calculateFixedVirtualWindow({
        itemCount: 0,
        rowHeight: 20,
        viewportHeight: 100,
    });
    const variable = new VirtualListMetrics({ itemCount: 0 }).getWindow({
        viewportHeight: 100,
    });
    for (const result of [fixed, variable]) {
        assert.equal(result.visibleCount, 0);
        assert.deepEqual(result.aria, {
            setSize: 0,
            firstPosition: null,
            lastPosition: null,
        });
        assert.equal(result.topSpacer, 0);
        assert.equal(result.bottomSpacer, 0);
    }
});
