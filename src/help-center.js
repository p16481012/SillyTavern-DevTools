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
    { id: 'faq', label: '자주 묻는 질문' },
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
    topic(
        'request-details',
        'prompt',
        'explorer',
        '생성 설정과 프롬프트 payload',
        '최종 문자열만으로 알 수 없는 요청 구조와 모델 생성 설정을 읽습니다.',
        [
            ['생성 설정', 'temperature, top_p, 최대 응답 토큰처럼 모델의 생성 방식에 영향을 주는 값을 보여줍니다. 값이 없으면 해당 provider 경로에서 캡처하지 못했거나 보내지 않은 항목입니다.'],
            ['프롬프트 payload', 'provider에 전달된 메시지 배열을 역할과 순서대로 표시합니다. 원문을 수정하는 곳이 아니라 실제 전송 구조를 확인하는 읽기 전용 화면입니다.'],
            ['표시되지 않는 데이터', 'SillyTavern 또는 provider 어댑터가 요청 경계에서 제공하지 않은 필드는 ST DevTools가 추측해 채우지 않고 알 수 없음으로 남깁니다.'],
        ],
        { keywords: ['payload', '생성 설정', 'temperature', 'top_p', '메시지 역할'] },
    ),
    topic(
        'rule-v3-structure',
        'rules',
        'rules',
        '지시 구조 atom과 relation 읽기',
        '긴 프롬프트를 작은 의미 단위와 관계로 나눠 충돌 후보가 만들어진 경로를 확인합니다.',
        [
            ['Atom', '조건, 역할, 말투, 형식, 안전 지시처럼 독립적으로 검토할 수 있는 최소 의미 단위입니다. 원문을 임의로 다시 쓰지 않고 출처 범위를 함께 보존합니다.'],
            ['Relation', '두 atom이 동시에 적용되는지, 서로 대안인지, 우선순위나 예외 관계가 있는지를 나타냅니다. 관계는 확정 판정이 아니라 근거를 좁히는 구조 정보입니다.'],
            ['확정과 후보', '구조와 원문 근거가 충분하면 확정, 일부만 연결되면 후보, 판단할 근거가 모자라면 근거 부족으로 표시합니다. 최종 판단은 원문 문맥을 함께 읽어야 합니다.'],
        ],
        { keywords: ['atom', 'relation', '구조', '확정', '후보', '근거 부족'] },
    ),
    topic(
        'semantic-provider-evaluation',
        'rules',
        'rules',
        'AI 연결 평가와 안전 경계',
        '실제 provider를 사용할 때 전송 범위, 비용, 응답 검증과 평가 결과를 구분합니다.',
        [
            ['수동 평가', '고정 corpus를 여러 번 보내 구조 통과율, 근거 정확도와 오탐률을 확인합니다. 실제 제공자 호출이므로 실행 전에 예상 호출 수와 응답 토큰 상한을 확인해야 합니다.'],
            ['응답 검증', '필수 JSON 구조, 선택한 원문과의 근거 연결, 허용된 식별자를 모두 확인합니다. 하나라도 맞지 않으면 화면 결과로 사용하지 않습니다.'],
            ['평가와 일반 검사', 'provider 평가 결과는 해당 모델·경로의 품질 점검 자료이며 개별 프롬프트에 대한 AI 의미 검사 결과와는 별개입니다.'],
        ],
        { keywords: ['provider', '평가', 'corpus', '응답 검증', '비용'] },
    ),
    topic(
        'storage-data-tools',
        'settings',
        null,
        '저장 데이터 도구와 진단 자료',
        '백업·복원·삭제처럼 데이터를 바꾸는 작업과 문제 원인을 확인하는 진단 자료를 구분합니다.',
        [
            ['저장 데이터 도구', '스냅샷 보관 현황 확인, 백업 내보내기, 복원 미리보기, 현재 채팅 또는 전체 데이터 삭제를 처리합니다. 삭제와 복원은 확인 절차를 거칩니다.'],
            ['진단 자료', '저장소 상태와 오류 코드 등 문제 해결에 필요한 정보를 읽기 전용 보고서로 만듭니다. 진단 내보내기는 스냅샷 원문 포함 범위를 먼저 확인해야 합니다.'],
            ['무결성 검사', '저장된 레코드를 다시 읽어 손상 여부를 확인합니다. 손상 항목을 찾는 것과 실제 삭제하는 것은 분리되어 있습니다.'],
        ],
        { keywords: ['백업', '복원', '진단', '무결성', '삭제'] },
    ),
    topic(
        'faq-common',
        'faq',
        null,
        '자주 묻는 문제',
        '처음 사용할 때 자주 마주치는 상태의 원인과 확인 순서를 모았습니다.',
        [
            ['메시지를 보냈는데 스냅샷이 없어요', '확장 이름 옆 캡처 상태를 먼저 확인하세요. AI 의미 검사 요청은 일반 기록과 섞이지 않도록 저장하지 않습니다. 실패 상태라면 오류 카드의 다시 시도를 사용한 뒤 새 일반 메시지를 보내세요.'],
            ['컨텍스트 사용률이 알 수 없음이에요', 'provider 응답이나 SillyTavern 요청 정보에 컨텍스트 최대치가 없으면 정확한 비율을 계산할 수 없습니다. ST DevTools는 모델 이름만으로 임의의 한도를 추정하지 않습니다.'],
            ['AI 결과가 안전 검사에서 폐기됐어요', '응답 형식이 맞지 않거나 인용 근거가 선택한 원문과 연결되지 않은 경우입니다. 프롬프트·프리필과 연결 모델을 확인하고 다시 실행하되, 폐기된 원문 응답은 결과로 사용하지 않습니다.'],
        ],
        { keywords: ['FAQ', '스냅샷 없음', '알 수 없음', '안전 검사', '폐기'] },
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
