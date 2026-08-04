const freezeRows = (rows) => Object.freeze(rows.map((row) => Object.freeze(row)));

export const COMPARISON_POLICY_LAB_FIXTURE = Object.freeze({
    sources: freezeRows([
        {
            id: 'language-korean',
            name: '출력언어 | 한국어',
            group: '출력언어',
            option: '한국어',
            active: true,
            content: '모든 답변을 한국어로 작성하세요.',
        },
        {
            id: 'language-japanese',
            name: '출력언어 | 일본어',
            group: '출력언어',
            option: '일본어',
            active: false,
            content: 'すべての回答を日本語で書いてください。',
        },
        {
            id: 'language-english',
            name: '출력언어 | 영어',
            group: '출력언어',
            option: '영어',
            active: false,
            content: 'Write every response in English.',
        },
        {
            id: 'tone-polite',
            name: '말투 | 존댓말',
            group: '말투',
            option: '존댓말',
            active: true,
            content: '사용자에게 항상 존댓말로 답하세요.',
        },
    ]),
    matcher: '{group} | {option}',
    mode: 'alternative',
    before: Object.freeze({ internalPairs: 3, groupedSources: 0 }),
    after: Object.freeze({ internalPairs: 0, groupedSources: 3 }),
});

export const SEMANTIC_AI_LAB_FIXTURE = Object.freeze({
    finding: Object.freeze({
        id: 'language-conflict',
        severity: '경고',
        title: '서로 다른 출력 언어 지시가 함께 포함됨',
        sources: Object.freeze(['출력언어 | 한국어', '출력언어 | 영어']),
        reason: '두 지시가 같은 답변의 출력 언어를 서로 다르게 요구합니다.',
    }),
    preview: Object.freeze({
        profile: '연습용 시뮬레이션',
        model: '고정 응답',
        prompt: '선택한 두 소스의 의미 충돌 여부와 안전한 개선 방향을 근거와 함께 설명하세요.',
        sourceExcerpt: '한국어로 답하세요. / Write every response in English.',
    }),
    result: Object.freeze({
        conclusion: '두 지시는 동시에 만족할 수 없는 출력 언어 충돌입니다.',
        evidence: '한 소스는 한국어만, 다른 소스는 영어만 요구합니다.',
        suggestion: '두 프롬프트를 출력언어 대안 그룹으로 묶고 한 옵션만 활성화하세요.',
    }),
    rejected: Object.freeze({
        title: '근거가 맞지 않는 응답은 폐기됩니다',
        reason: '응답이 선택한 원문을 인용하지 않았거나 약속된 구조를 따르지 않으면 결과로 사용하지 않습니다.',
    }),
});
