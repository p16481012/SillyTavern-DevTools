const topic = (id, category, tabId, title, summary, sections, options = {}) => (
    Object.freeze({
        id,
        category,
        tabId,
        title,
        summary,
        sections: Object.freeze(sections.map((section) => Object.freeze([...section]))),
        keywords: Object.freeze([...(options.keywords ?? [])]),
        labId: options.labId ?? null,
    })
);

export const HELP_CATEGORIES = Object.freeze([
    { id: 'start', label: '처음 사용' },
    { id: 'prompt', label: '전송 프롬프트' },
    { id: 'rules', label: '규칙 검사' },
    { id: 'history', label: '기록' },
    { id: 'diff', label: '변경 비교' },
    { id: 'search', label: '검색' },
    { id: 'settings', label: '설정과 저장' },
].map((entry) => Object.freeze(entry)));

export const HELP_TOPICS = Object.freeze([
    topic(
        'capture-status',
        'start',
        'explorer',
        '캡처 상태 읽기',
        '확장 이름 옆 상태 점으로 요청 감지부터 저장 완료까지 확인합니다.',
        [
            ['대기', '일반 채팅 요청을 기다리는 정상 상태입니다.'],
            ['저장 중', '요청 본문 정리, 개인정보 보호 처리, 브라우저 저장소 기록을 순서대로 진행합니다.'],
            ['실패', '상태 문구와 오류 카드를 확인한 뒤 다시 시도하거나 새 일반 메시지를 보내세요.'],
        ],
        { keywords: ['스냅샷', '저장', '실패', '상태'] },
    ),
    topic(
        'prompt-overview',
        'prompt',
        'explorer',
        '전송 프롬프트 화면',
        '모델이 실제 요청에서 받은 소스를 최종 배치 순서대로 살펴봅니다.',
        [
            ['프리셋과 실제 요청', '프리셋 전체 보기와 이번 요청에 포함된 항목만 보기를 전환할 수 있습니다.'],
            ['연결 방식', '정확·파생·추정은 원본 소스가 최종 문자열과 어떻게 연결됐는지 나타냅니다.'],
            ['확인 순서', '토큰이 큰 항목부터 보는 대신 최종 순서를 따라가면 지시 우선순위를 이해하기 쉽습니다.'],
        ],
        { keywords: ['프롬프트', '순서', '소스', '연결'] },
    ),
    topic(
        'prompt-included-filter',
        'prompt',
        'explorer',
        '이번 요청에 포함된 프롬프트만 보기',
        '비활성 프롬프트와 실제 요청에 들어간 프롬프트를 구분해서 봅니다.',
        [
            ['포함 프리셋', '현재 요청 문자열에 포함된 것으로 확인된 프리셋 항목만 표시합니다.'],
            ['전체 프리셋', '비활성 항목을 포함해 현재 프리셋에 설정된 모든 항목을 표시합니다.'],
            ['주의', '템플릿 변환이나 매크로 때문에 연결을 확정하지 못한 항목은 미확인으로 남을 수 있습니다.'],
        ],
        { keywords: ['포함 프리셋', '전체 프리셋', '비활성'] },
    ),
    topic(
        'prompt-final-position',
        'prompt',
        'explorer',
        '최종 위치와 근거 확인',
        '소스 카드가 최종 프롬프트의 어느 위치에 연결됐는지 바로 확인합니다.',
        [
            ['위치 아이콘', '구조 위치 옆 아이콘을 누르면 필요한 묶음을 열고 해당 최종 위치로 이동합니다.'],
            ['여러 위치', '같은 소스가 여러 메시지나 문자열 위치에 사용되면 위치 개수가 함께 표시됩니다.'],
            ['복사', '읽기 전용 원문을 복사해 SillyTavern의 원래 편집 화면에서 수정할 수 있습니다.'],
        ],
        { keywords: ['최종 위치', '근거', '복사'] },
    ),
    topic(
        'rules-overview',
        'rules',
        'rules',
        '로컬 규칙 검사 결과 읽기',
        '치명적·경고·정보 결과를 근거와 함께 확인하고 실제 문제인지 판단합니다.',
        [
            ['심각도', '치명적은 함께 지키기 어려운 지시, 경고는 검토가 필요한 후보, 정보는 구조상 참고할 내용을 뜻합니다.'],
            ['근거', '결과 제목만 보지 말고 펼쳐진 소스 이름과 원문 근거를 함께 확인하세요.'],
            ['검토 결정', '유효·오탐·항상 무시 결정을 남기면 같은 결과를 다시 검토하는 부담을 줄일 수 있습니다.'],
        ],
        { keywords: ['충돌', '반복', '심각도', '근거'] },
    ),
    topic(
        'comparison-policy',
        'rules',
        'rules',
        '비교 정책과 대안 그룹',
        '서로 대안인 프롬프트를 같은 그룹으로 묶어 그룹 내부의 불필요한 비교를 건너뜁니다.',
        [
            ['대안 그룹', '한 요청에서 여러 옵션이 보이더라도 같은 목적의 선택지라면 내부 비교를 제외합니다.'],
            ['내부 무시 그룹', '서로 비교할 필요가 없는 보조 조각을 묶지만 옵션 교체 관계로 해석하지는 않습니다.'],
            ['우선순위', '수동 지정이 이름 규칙보다 우선하며, 이름 규칙은 위에서 처음 일치한 하나만 사용합니다.'],
            ['이름 규칙 예시', '출력언어 | 한국어는 {group} | {option} 규칙으로 출력언어 그룹의 한국어 옵션이 됩니다.'],
        ],
        {
            keywords: ['대안 그룹', '내부 무시', '이름 규칙', '수동 지정'],
            labId: 'comparison-policy',
        },
    ),
    topic(
        'semantic-ai',
        'rules',
        'rules',
        'AI로 더 자세히 보기',
        '선택한 로컬 검사 후보만 AI에 보내 의미 충돌과 개선 방향을 추가로 검토합니다.',
        [
            ['로컬과 AI 분리', 'AI 모드를 켜도 로컬 결과와 섞지 않고 AI가 반환한 결과만 별도로 표시합니다.'],
            ['매회 동의', '전송 대상과 연결 프로필을 미리 본 뒤 실행할 때마다 동의해야 합니다.'],
            ['결과 범위', 'AI 제안은 자동 적용하거나 저장하지 않습니다. 근거를 확인한 뒤 복사해서 원래 편집 화면에서 사용하세요.'],
            ['안전 폐기', '요청과 응답의 형식이나 근거가 검증되지 않으면 결과를 화면에 사용하지 않습니다.'],
        ],
        {
            keywords: ['AI', '의미 검사', '동의', '연결 프로필', '안전'],
            labId: 'semantic-ai',
        },
    ),
    topic(
        'timeline-overview',
        'history',
        'timeline',
        '스냅샷과 채팅 기록',
        '스냅샷은 한 번의 모델 요청이며 현재 채팅 ID별로 따로 보관됩니다.',
        [
            ['채팅 기준', '캐릭터 이름만이 아니라 SillyTavern이 제공한 현재 채팅 식별자를 기준으로 기록을 나눕니다.'],
            ['분기와 체크포인트', '새 채팅 식별자로 저장되는 분기는 별도 기록으로 보이며, 같은 식별자를 유지하면 같은 기록 안에 이어집니다.'],
            ['목록', '스냅샷 묶음을 접고 필요한 시점만 선택해 삭제하거나 비교할 수 있습니다.'],
        ],
        { keywords: ['스냅샷', '채팅', '분기', '체크포인트'] },
    ),
    topic(
        'timeline-growth',
        'history',
        'timeline',
        '프롬프트 성장 그래프',
        '최근 요청의 프롬프트 토큰 변화를 같은 채팅 안에서 확인합니다.',
        [
            ['점 확인', '그래프 점을 가리키거나 선택하면 해당 요청의 토큰 수를 확인할 수 있습니다.'],
            ['작은 편차', '값이 비슷할 때는 차이를 볼 수 있도록 확대하고 큰 격차가 생기면 전체 범위에 맞춰 축을 조절합니다.'],
            ['해석', '급격한 증가는 채팅 이력, 로어북, 프리셋 변경이나 새 소스 추가를 함께 확인해야 합니다.'],
        ],
        { keywords: ['그래프', '토큰', '성장'] },
    ),
    topic(
        'diff-overview',
        'diff',
        'diff',
        '변경 비교 방향',
        '기준에서 비교 대상으로 이동하면서 무엇이 달라졌는지 읽습니다.',
        [
            ['기준', '변경 전으로 간주할 스냅샷입니다.'],
            ['비교 대상', '변경 후로 간주할 스냅샷입니다. 선택 순서를 바꾸면 추가와 삭제도 반대로 바뀝니다.'],
            ['전체 차이', '소스 연결과 별개로 최종 문자열 전체의 줄 단위 차이를 확인합니다.'],
        ],
        { keywords: ['기준', '비교 대상', '방향', '전체 차이'] },
    ),
    topic(
        'diff-statuses',
        'diff',
        'diff',
        '추가·삭제·수정·교체 구분',
        '소스 자체의 변화와 같은 대안 그룹 안의 옵션 전환을 구분합니다.',
        [
            ['추가', '비교 대상에만 포함된 새 소스입니다.'],
            ['삭제', '기준에는 있었지만 비교 대상에서 빠진 소스입니다.'],
            ['수정', '두 요청 모두에 포함된 같은 식별자의 소스가 유지되면서 내용이나 역할·깊이·위치·순서가 달라졌습니다.'],
            ['교체', '같은 대안 그룹에서 활성 옵션이 1개에서 다른 1개로 바뀌었습니다. 정책이 없거나 모호하면 안전하게 추가와 삭제로 표시합니다.'],
            ['식별자 우선', '같은 식별자의 소스가 대안 그룹이나 옵션만 바뀐 경우에는 서로 다른 소스의 교체로 추측하지 않고 수정으로 표시합니다.'],
        ],
        { keywords: ['추가', '삭제', '수정', '교체', '옵션'] },
    ),
    topic(
        'search-overview',
        'search',
        'search',
        '프롬프트 원문 검색',
        '선택한 스냅샷의 모든 프롬프트 소스에서 단어나 문장을 찾습니다.',
        [
            ['일반 검색', '입력한 문자열이 포함된 원문과 주변 문맥을 보여줍니다.'],
            ['정규식', '패턴 검색이 필요할 때만 켜세요. 잘못된 정규식은 실행하지 않고 오류로 안내합니다.'],
            ['대소문자', '영문 고유명사처럼 대소문자를 구분해야 할 때 사용합니다.'],
            ['원본 이동', '검색 결과에서 소스 보기를 누르면 전송 프롬프트의 해당 카드로 이동합니다.'],
        ],
        { keywords: ['검색', '정규식', '대소문자', '원본'] },
    ),
    topic(
        'settings-storage',
        'settings',
        null,
        '읽기 수와 보관 수',
        '저장되는 스냅샷 수와 화면에 불러오는 수를 따로 조절합니다.',
        [
            ['채팅별 보관 수', '각 채팅 ID에 남길 최신 스냅샷의 최대 개수입니다.'],
            ['불러올 스냅샷 수', '현재 패널에서 읽어올 최신 기록 수입니다. 보관 수보다 작게 설정해도 나머지는 삭제되지 않습니다.'],
            ['기간과 용량', '고급 제한을 사용하면 오래되거나 전체 용량을 넘은 항목을 정리할 수 있습니다.'],
        ],
        { keywords: ['보관 수', '읽기 수', '용량', '기간'] },
    ),
    topic(
        'settings-privacy',
        'settings',
        null,
        '개인정보 보호 저장 모드',
        '원문 보존 범위를 전체·가림·메타데이터 중에서 선택합니다.',
        [
            ['전체', '분석과 검색에 필요한 원문을 저장합니다.'],
            ['가림', '선택한 민감 문자열을 저장 전에 대체하며 일부 분석 정확도가 낮아질 수 있습니다.'],
            ['메타데이터', '원문 없이 요청 시각·모델·토큰 같은 정보만 남겨 검색과 규칙 검사가 제한됩니다.'],
        ],
        { keywords: ['개인정보', '가림', '메타데이터', '원문'] },
    ),
]);

export const HELP_LABS = Object.freeze([
    {
        id: 'comparison-policy',
        title: '비교 정책 연습',
        description: '출력 언어 옵션을 직접 묶고 그룹 내부 비교가 사라지는 과정을 연습합니다.',
        duration: '약 2분',
    },
    {
        id: 'semantic-ai',
        title: 'AI 의미 검사 연습',
        description: '전송 미리보기와 동의부터 근거·개선안 확인까지 연습용 고정 AI 결과로 체험합니다.',
        duration: '약 2분',
    },
].map((entry) => Object.freeze(entry)));

const normalizeQuery = (value) => String(value ?? '')
    .trim()
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/gu, ' ');

export function helpTopicById(id) {
    return HELP_TOPICS.find((entry) => entry.id === id) ?? null;
}

export function helpTopicsFor({ tabId = null, query = '' } = {}) {
    const normalized = normalizeQuery(query);
    return HELP_TOPICS.filter((entry) => {
        if (tabId && entry.tabId !== tabId) return false;
        if (!normalized) return true;
        const haystack = normalizeQuery([
            entry.title,
            entry.summary,
            ...entry.keywords,
            ...entry.sections.flat(),
        ].join(' '));
        return haystack.includes(normalized);
    });
}

export const HELP_RECENT_LIMIT = 3;

export function normalizeRecentHelpTopics(value) {
    const validIds = new Set(HELP_TOPICS.map(({ id }) => id));
    const values = Array.isArray(value) ? value : [];
    return [...new Set(values
        .map((id) => String(id ?? '').trim())
        .filter((id) => validIds.has(id)))]
        .slice(0, HELP_RECENT_LIMIT);
}

export function rememberHelpTopic(value, topicId) {
    return normalizeRecentHelpTopics([
        topicId,
        ...normalizeRecentHelpTopics(value).filter((id) => id !== topicId),
    ]);
}

const LAB_ISOLATION = Object.freeze({
    dummyData: true,
    writesStorage: false,
    sendsProviderRequest: false,
    incursCost: false,
});

export function createHelpLabSession(labId) {
    if (labId === 'comparison-policy') {
        return {
            labId,
            step: 0,
            matcher: null,
            mode: null,
            status: 'ready',
            completed: false,
            isolation: LAB_ISOLATION,
        };
    }
    if (labId === 'semantic-ai') {
        return {
            labId,
            step: 0,
            findingId: null,
            consented: false,
            status: 'ready',
            completed: false,
            isolation: LAB_ISOLATION,
        };
    }
    return null;
}

export function updateHelpLabSession(session, action = {}) {
    if (!session || action.type === 'reset') {
        return createHelpLabSession(session?.labId ?? action.labId);
    }
    if (session.labId === 'comparison-policy') {
        if (action.type === 'choose-matcher') {
            return { ...session, matcher: action.value, step: 1 };
        }
        if (action.type === 'choose-mode' && session.matcher) {
            return { ...session, mode: action.value, step: 2 };
        }
        if (
            action.type === 'preview'
            && session.matcher === '{group} | {option}'
            && session.mode === 'alternative'
        ) {
            return { ...session, status: 'previewed', step: 3 };
        }
        if (action.type === 'finish' && session.status === 'previewed') {
            return { ...session, status: 'complete', step: 4, completed: true };
        }
        return session;
    }
    if (session.labId === 'semantic-ai') {
        if (action.type === 'select-finding') {
            return { ...session, findingId: action.value, step: 1 };
        }
        if (action.type === 'preview' && session.findingId) {
            return { ...session, status: 'previewed', step: 2 };
        }
        if (action.type === 'consent' && session.status === 'previewed') {
            return { ...session, consented: Boolean(action.value) };
        }
        if (action.type === 'run' && session.status === 'previewed' && session.consented) {
            return { ...session, status: 'running', step: 3 };
        }
        if (action.type === 'complete' && session.status === 'running') {
            return { ...session, status: 'complete', step: 4, completed: true };
        }
        return session;
    }
    return session;
}
