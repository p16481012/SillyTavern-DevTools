function positiveNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
}

function partDimensions(part) {
    return {
        width: positiveNumber(
            part?.width,
            part?.image_width,
            part?.metadata?.width,
            part?.image_url?.width,
            part?.image?.width,
        ),
        height: positiveNumber(
            part?.height,
            part?.image_height,
            part?.metadata?.height,
            part?.image_url?.height,
            part?.image?.height,
        ),
    };
}

function partDuration(part) {
    return positiveNumber(
        part?.duration_seconds,
        part?.durationSeconds,
        part?.duration,
        part?.metadata?.duration_seconds,
        part?.metadata?.duration,
        part?.audio_url?.duration,
        part?.video_url?.duration,
    );
}

function partDetail(part) {
    return String(
        part?.detail
        ?? part?.image_url?.detail
        ?? part?.image?.detail
        ?? 'auto',
    ).toLocaleLowerCase();
}

export function detectMultimodalProvider(contextState = {}, request = {}) {
    const body = request?.body ?? request ?? {};
    const settings = request?.settings ?? body;
    const source = [
        settings?.chat_completion_source,
        settings?.provider,
        settings?.api_type,
        body?.chat_completion_source,
        contextState?.mainApi,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    const model = String(settings?.model ?? contextState?.model ?? '').toLocaleLowerCase();
    const identity = `${source} ${model}`;

    if (/anthropic|claude/u.test(identity)) return 'anthropic';
    if (/google|gemini|makersuite|vertexai/u.test(identity)) return 'google';
    if (/openai|gpt-|o1(?:\b|-)|o3(?:\b|-)|o4(?:\b|-)|computer-use/u.test(identity)) return 'openai';
    return 'unknown';
}

function openAiTilePricing(model) {
    if (/gpt-4o-mini/u.test(model)) return { base: 2833, tile: 5667 };
    if (/gpt-4o|gpt-4\.1|gpt-4\.5/u.test(model)) return { base: 85, tile: 170 };
    if (/computer-use-preview/u.test(model)) return { base: 65, tile: 129 };
    if (/(?:^|[/:_-])o1(?:\b|-)|(?:^|[/:_-])o3(?:\b|-)/u.test(model)) {
        return { base: 75, tile: 150 };
    }
    if (/(?:^|[/:_-])gpt-5(?:\b|-)/u.test(model) && !/mini|nano|codex/u.test(model)) {
        return { base: 70, tile: 140 };
    }
    return null;
}

function openAiImageEstimate(part, model) {
    const detail = partDetail(part);
    const { width, height } = partDimensions(part);

    if (/gpt-5\.6/u.test(model) && width && height && ['auto', 'original'].includes(detail)) {
        return {
            tokens: Math.ceil(width / 32) * Math.ceil(height / 32),
            kind: 'estimate',
            method: 'openai-patch-32',
        };
    }
    if (/gpt-5\.6/u.test(model)) {
        return { tokens: null, kind: 'unavailable', method: 'openai-gpt56-detail-unsupported' };
    }

    const pricing = openAiTilePricing(model);
    if (!pricing) {
        return { tokens: null, kind: 'unavailable', method: 'openai-model-unsupported' };
    }
    if (detail === 'low') {
        return { tokens: pricing.base, kind: 'estimate', method: 'openai-low-detail-base' };
    }
    if (detail === 'auto') {
        return { tokens: pricing.base, kind: 'lower-bound', method: 'openai-auto-detail-lower-bound' };
    }
    if (!width || !height) {
        return { tokens: pricing.base, kind: 'lower-bound', method: 'openai-missing-dimensions' };
    }

    const fitScale = Math.min(1, 2048 / Math.max(width, height));
    const fittedWidth = width * fitScale;
    const fittedHeight = height * fitScale;
    const detailScale = 768 / Math.min(fittedWidth, fittedHeight);
    const scaledWidth = Math.round(fittedWidth * detailScale);
    const scaledHeight = Math.round(fittedHeight * detailScale);
    const tiles = Math.ceil(scaledWidth / 512) * Math.ceil(scaledHeight / 512);
    return {
        tokens: pricing.base + (tiles * pricing.tile),
        kind: 'estimate',
        method: 'openai-tile-512',
    };
}

function anthropicTier(model) {
    const version = model.match(/claude[^0-9]*(\d+)(?:[.-](\d+))?/u);
    const major = Number(version?.[1]);
    const minor = Number(version?.[2] ?? 0);
    if (major > 4 || (major === 4 && minor >= 7)) {
        return { maxLongEdge: 2576, maxTokens: 4784, method: 'anthropic-28px-high' };
    }
    return { maxLongEdge: 1568, maxTokens: 1568, method: 'anthropic-28px-standard' };
}

function anthropicImageEstimate(part, model) {
    const { width, height } = partDimensions(part);
    if (!width || !height) {
        return { tokens: null, kind: 'unavailable', method: 'anthropic-missing-dimensions' };
    }
    const tier = anthropicTier(model);
    const directTokens = Math.ceil(width / 28) * Math.ceil(height / 28);
    if (Math.max(width, height) <= tier.maxLongEdge && directTokens <= tier.maxTokens) {
        return { tokens: directTokens, kind: 'estimate', method: tier.method };
    }
    return {
        tokens: tier.maxTokens,
        kind: 'upper-bound',
        method: `${tier.method}-resized-cap`,
    };
}

function googleEstimate(part, type) {
    if (type === 'audio' || type === 'video') {
        const duration = partDuration(part);
        if (!duration) {
            return {
                tokens: null,
                kind: 'unavailable',
                method: `google-${type}-missing-duration`,
            };
        }
        const rate = type === 'audio' ? 32 : 263;
        return {
            tokens: Math.ceil(duration * rate),
            kind: 'estimate',
            method: `google-${type}-per-second`,
        };
    }
    if (type !== 'image') {
        return { tokens: null, kind: 'unavailable', method: 'google-file-unsupported' };
    }

    const { width, height } = partDimensions(part);
    if (!width || !height) {
        return { tokens: 258, kind: 'lower-bound', method: 'google-image-minimum' };
    }
    if (width <= 384 && height <= 384) {
        return { tokens: 258, kind: 'estimate', method: 'google-image-small' };
    }
    const tiles = Math.ceil(width / 768) * Math.ceil(height / 768);
    return {
        tokens: Math.max(1, tiles) * 258,
        kind: 'estimate',
        method: 'google-image-768-tiles',
    };
}

export function estimateMultimodalTokens({
    part,
    type,
    provider,
    model,
}) {
    const normalizedModel = String(model ?? '').toLocaleLowerCase();
    let estimate;
    if (provider === 'openai' && type === 'image') {
        estimate = openAiImageEstimate(part, normalizedModel);
    } else if (provider === 'anthropic' && type === 'image') {
        estimate = anthropicImageEstimate(part, normalizedModel);
    } else if (provider === 'google') {
        estimate = googleEstimate(part, type);
    } else {
        estimate = { tokens: null, kind: 'unavailable', method: 'provider-unsupported' };
    }
    return {
        provider,
        type,
        ...estimate,
    };
}
