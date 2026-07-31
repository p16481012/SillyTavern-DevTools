const MAX_VIRTUAL_ITEMS = 100_000;

function nonNegativeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function normalizedItemCount(value) {
    return Math.min(
        MAX_VIRTUAL_ITEMS,
        Math.max(0, Math.trunc(Number(value) || 0)),
    );
}

function windowResult({
    itemCount,
    start,
    end,
    topSpacer,
    totalHeight,
}) {
    const boundedStart = Math.min(itemCount, Math.max(0, start));
    const boundedEnd = Math.min(itemCount, Math.max(boundedStart, end));
    const boundedTop = Math.min(totalHeight, Math.max(0, topSpacer));
    return {
        totalCount: itemCount,
        start: boundedStart,
        end: boundedEnd,
        visibleCount: boundedEnd - boundedStart,
        topSpacer: boundedTop,
        bottomSpacer: Math.max(0, totalHeight - boundedTop),
        totalHeight,
        aria: {
            setSize: itemCount,
            firstPosition: boundedStart < boundedEnd ? boundedStart + 1 : null,
            lastPosition: boundedStart < boundedEnd ? boundedEnd : null,
        },
    };
}

export function calculateFixedVirtualWindow({
    itemCount,
    rowHeight,
    scrollTop = 0,
    viewportHeight = 0,
    overscan = 4,
} = {}) {
    const count = normalizedItemCount(itemCount);
    const height = Math.max(1, nonNegativeNumber(rowHeight, 1));
    const top = nonNegativeNumber(scrollTop);
    const viewport = nonNegativeNumber(viewportHeight);
    const extra = Math.min(100, Math.max(0, Math.trunc(Number(overscan) || 0)));
    const firstVisible = Math.min(count, Math.floor(top / height));
    const visibleRows = Math.max(1, Math.ceil(viewport / height));
    const start = Math.max(0, firstVisible - extra);
    const end = Math.min(count, firstVisible + visibleRows + extra);
    const totalHeight = count * height;
    const result = windowResult({
        itemCount: count,
        start,
        end,
        topSpacer: start * height,
        totalHeight,
    });
    result.bottomSpacer = Math.max(0, totalHeight - (end * height));
    return result;
}

export class VirtualListMetrics {
    constructor({
        itemCount = 0,
        estimatedRowHeight = 64,
        overscan = 4,
    } = {}) {
        this.itemCount = normalizedItemCount(itemCount);
        this.estimatedRowHeight = Math.max(
            1,
            nonNegativeNumber(estimatedRowHeight, 64),
        );
        this.overscan = Math.min(
            100,
            Math.max(0, Math.trunc(Number(overscan) || 0)),
        );
        this.measuredHeights = new Map();
        this.deltaTree = new Float64Array(this.itemCount + 1);
    }

    updateMeasuredHeight(index, height) {
        const normalizedIndex = Math.trunc(Number(index));
        const normalizedHeight = nonNegativeNumber(height);
        if (
            !Number.isInteger(normalizedIndex)
            || normalizedIndex < 0
            || normalizedIndex >= this.itemCount
            || normalizedHeight < 1
        ) {
            return false;
        }
        const previous = this.measuredHeights.get(normalizedIndex)
            ?? this.estimatedRowHeight;
        if (previous === normalizedHeight) return true;
        this.measuredHeights.set(normalizedIndex, normalizedHeight);
        this.addDelta(
            normalizedIndex,
            normalizedHeight - previous,
        );
        return true;
    }

    addDelta(index, delta) {
        for (let cursor = index + 1; cursor < this.deltaTree.length; cursor += cursor & -cursor) {
            this.deltaTree[cursor] += delta;
        }
    }

    deltaBefore(count) {
        let total = 0;
        for (let cursor = Math.min(this.itemCount, Math.max(0, count)); cursor > 0; cursor -= cursor & -cursor) {
            total += this.deltaTree[cursor];
        }
        return total;
    }

    offsetForIndex(index) {
        const bounded = Math.min(
            this.itemCount,
            Math.max(0, Math.trunc(Number(index) || 0)),
        );
        return (bounded * this.estimatedRowHeight) + this.deltaBefore(bounded);
    }

    totalHeight() {
        return this.offsetForIndex(this.itemCount);
    }

    indexAtOffset(offset) {
        const target = nonNegativeNumber(offset);
        if (this.itemCount === 0) return 0;

        // Fenwick lower-bound search. Each selected tree block contains its
        // estimated base height plus the measured-height delta, keeping the
        // lookup O(log n) rather than binary-searching O(log n) prefix sums.
        let index = 0;
        let height = 0;
        let step = 2 ** Math.floor(Math.log2(this.itemCount));
        while (step > 0) {
            const next = index + step;
            if (next <= this.itemCount) {
                const blockSize = next & -next;
                const blockHeight = (
                    blockSize * this.estimatedRowHeight
                ) + this.deltaTree[next];
                if (height + blockHeight <= target) {
                    index = next;
                    height += blockHeight;
                }
            }
            step = Math.floor(step / 2);
        }
        return Math.min(this.itemCount, index);
    }

    getWindow({
        scrollTop = 0,
        viewportHeight = 0,
        overscan = this.overscan,
    } = {}) {
        const viewport = nonNegativeNumber(viewportHeight);
        const firstVisible = this.indexAtOffset(scrollTop);
        const lastVisible = this.indexAtOffset(
            nonNegativeNumber(scrollTop) + viewport,
        );
        const extra = Math.min(
            100,
            Math.max(0, Math.trunc(Number(overscan) || 0)),
        );
        const start = Math.max(0, firstVisible - extra);
        const end = Math.min(
            this.itemCount,
            Math.max(firstVisible + 1, lastVisible + 1) + extra,
        );
        const totalHeight = this.totalHeight();
        const result = windowResult({
            itemCount: this.itemCount,
            start,
            end,
            topSpacer: this.offsetForIndex(start),
            totalHeight,
        });
        result.bottomSpacer = Math.max(
            0,
            totalHeight - this.offsetForIndex(end),
        );
        return result;
    }
}
