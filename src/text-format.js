const EXAMPLE_PARAGRAPH_BOUNDARY = /\s+(?=(?:예(?:시)?\s*:|예를\s+들어(?:\s*[:,])?|ex\.\s|e\.g\.\s|example\s*:))/giu;
const PROTECTED_PERIOD_SUFFIX = /(?:^|[\s([{"'“‘])(?:(?:\p{L}\.){2,}|(?:ex|dr|mr|ms|prof|no|vs)\.)$/iu;
const SENTENCE_CLOSERS = new Set(['"', '\'', '’', '”', '»', ')', ']', '}']);

function sentenceParagraphs(block) {
    const normalized = String(block ?? '').replace(/\s+/gu, ' ').trim();
    if (!normalized) return [];

    const paragraphs = [];
    let paragraphStart = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        if (normalized[index] !== '.') continue;
        let sentenceEnd = index + 1;
        while (SENTENCE_CLOSERS.has(normalized[sentenceEnd])) sentenceEnd += 1;
        const nextCharacter = normalized[sentenceEnd];
        if (nextCharacter != null && !/\s/u.test(nextCharacter)) continue;

        const periodCandidate = normalized.slice(paragraphStart, index + 1).trim();
        if (PROTECTED_PERIOD_SUFFIX.test(periodCandidate)) continue;
        const candidate = normalized.slice(paragraphStart, sentenceEnd).trim();
        if (candidate) paragraphs.push(candidate);

        paragraphStart = sentenceEnd;
        while (/\s/u.test(normalized[paragraphStart] ?? '')) paragraphStart += 1;
        index = paragraphStart - 1;
    }

    const remainder = normalized.slice(paragraphStart).trim();
    if (remainder) paragraphs.push(remainder);
    return paragraphs;
}

export function descriptionParagraphs(text) {
    return String(text ?? '')
        .trim()
        .split(/\n\s*\n/gu)
        .flatMap((block) => block.split(EXAMPLE_PARAGRAPH_BOUNDARY))
        .flatMap(sentenceParagraphs)
        .filter(Boolean);
}
