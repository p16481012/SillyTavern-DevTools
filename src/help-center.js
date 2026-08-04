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

const visualItem = (label, { detail = null, state = 'neutral' } = {}) => (
    Object.freeze({
        label,
        ...(detail ? { detail } : {}),
        ...(state === 'neutral' ? {} : { state }),
    })
);

const visualLane = (label, items, { relation = 'sequence' } = {}) => (
    Object.freeze({
        label,
        relation,
        items: Object.freeze([...items]),
    })
);

const topicVisual = (id, type, ariaLabel, caption, lanes) => Object.freeze({
    id,
    type,
    ariaLabel,
    caption,
    lanes: Object.freeze([...lanes]),
});

const HELP_TOPIC_VISUAL_LIST = Object.freeze([
    topicVisual(
        'capture-status',
        'flow',
        '캡처 상태가 대기에서 저장 중을 거쳐 저장 완료로 바뀌며 실패하면 오류 확인과 재시도로 이어지는 흐름',
        '확장 이름 옆 상태 점은 현재 요청이 어느 단계에 있는지 보여줍니다.',
        [
            visualLane('정상 흐름', [
                visualItem('대기', { detail: '일반 요청을 기다림' }),
                visualItem('저장 중', { detail: '정리 · 보호 · 기록', state: 'info' }),
                visualItem('저장됨', { detail: '스냅샷 확인 가능', state: 'success' }),
            ]),
            visualLane('문제가 생긴 경우', [
                visualItem('실패', { detail: '오류 카드 확인', state: 'danger' }),
                visualItem('다시 시도', { detail: '또는 새 일반 메시지 전송', state: 'warning' }),
            ], { relation: 'branch' }),
        ],
    ),
    topicVisual(
        'prompt-overview',
        'flow',
        '프리셋과 캐릭터 및 로어북 소스가 최종 프롬프트를 거쳐 전송 payload로 이어지는 구조',
        '왼쪽의 원본 소스가 최종 배치와 provider 요청으로 이어지는 경로를 따라갑니다.',
        [
            visualLane('원본에서 전송까지', [
                visualItem('프리셋 · 캐릭터 · 로어북', { detail: '원본 소스' }),
                visualItem('연결 근거', { detail: '정확 · 파생 · 추정', state: 'info' }),
                visualItem('최종 프롬프트', { detail: '실제 배치 순서' }),
                visualItem('요청 payload', { detail: '역할별 메시지 배열', state: 'success' }),
            ]),
        ],
    ),
    topicVisual(
        'prompt-included-filter',
        'comparison',
        '전체 프리셋 목록과 이번 요청에 포함된 프리셋 목록을 나란히 비교한 예시',
        '필터는 프롬프트를 켜거나 끄지 않고 현재 화면의 표시 범위만 바꿉니다.',
        [
            visualLane('전체 프리셋', [
                visualItem('메인 지시', { state: 'success' }),
                visualItem('출력 언어', { state: 'success' }),
                visualItem('보조 예시', { detail: '비활성' }),
                visualItem('템플릿 후보', { detail: '미확인', state: 'warning' }),
            ], { relation: 'contrast' }),
            visualLane('포함 프리셋', [
                visualItem('메인 지시', { state: 'success' }),
                visualItem('출력 언어', { state: 'success' }),
            ], { relation: 'contrast' }),
        ],
    ),
    topicVisual(
        'prompt-final-position',
        'lanes',
        '원본 소스 하나가 최종 프롬프트의 한 곳 또는 여러 곳에 연결되는 예시',
        '위치 아이콘은 원본을 편집하지 않고 연결된 최종 위치를 찾아갑니다.',
        [
            visualLane('원본 소스', [
                visualItem('출력 형식 지시', { detail: '읽기 전용 원문' }),
            ]),
            visualLane('연결된 최종 위치', [
                visualItem('system · 4번 위치', { state: 'info' }),
                visualItem('user · 2번 위치', { detail: '여러 위치일 때 함께 표시' }),
            ], { relation: 'mapping' }),
        ],
    ),
    topicVisual(
        'rules-overview',
        'flow',
        '규칙 검사 후보의 심각도에서 원문 근거와 검토 결정으로 이어지는 흐름',
        '결과 제목만으로 판단하지 말고 근거와 원문을 확인한 뒤 검토 결정을 남깁니다.',
        [
            visualLane('검토 순서', [
                visualItem('심각도', { detail: '치명적 · 경고 · 정보', state: 'warning' }),
                visualItem('원문 근거', { detail: '관련 소스와 인용 범위', state: 'info' }),
                visualItem('사람의 판단', { detail: '실제 충돌인지 확인' }),
                visualItem('검토 결정', { detail: '유효 · 오탐 · 항상 무시', state: 'success' }),
            ]),
        ],
    ),
    topicVisual(
        'comparison-policy',
        'comparison',
        '출력 언어 프롬프트에 비교 정책을 적용하기 전과 대안 그룹으로 묶은 후의 비교 관계',
        '대안 그룹은 같은 그룹 내부 비교만 제외하며 다른 그룹과의 비교와 동시 활성 경고는 유지합니다.',
        [
            visualLane('적용 전', [
                visualItem('출력언어 | 한국어'),
                visualItem('출력언어 | 영어'),
                visualItem('내부 비교 1건', { detail: '서로 충돌 후보가 됨', state: 'warning' }),
                visualItem('말투 | 존댓말과 비교', { detail: '그룹 밖 비교' }),
            ], { relation: 'contrast' }),
            visualLane('대안 그룹 적용 후', [
                visualItem('그룹: 출력언어', { detail: '옵션: 한국어 · 영어', state: 'info' }),
                visualItem('내부 비교 0건', { detail: '선택지끼리 비교 제외', state: 'success' }),
                visualItem('말투 그룹과 비교 유지'),
                visualItem('동시 활성 시 그룹 경고', { detail: '수동 지정이 이름 규칙보다 우선', state: 'warning' }),
            ], { relation: 'contrast' }),
        ],
    ),
    topicVisual(
        'semantic-ai',
        'lanes',
        '선택한 로컬 검사 후보를 전송 미리보기와 동의를 거쳐 AI에 보내고 응답을 검증해 표시하거나 폐기하는 흐름',
        'AI 결과는 검증을 통과해도 자동 적용하거나 저장하지 않습니다.',
        [
            visualLane('전송과 검증', [
                visualItem('로컬 후보 선택', { detail: '필요한 후보만 선택' }),
                visualItem('전송 미리보기', { detail: '원문 · 모델 · 응답 상한', state: 'info' }),
                visualItem('매회 동의', { detail: '외부 전송 범위 확인', state: 'warning' }),
                visualItem('AI provider 호출'),
                visualItem('응답 검증', { detail: '구조 · 식별자 · 인용 근거' }),
            ]),
            visualLane('검증 통과', [
                visualItem('판정 · 근거 · 개선 방향', { state: 'success' }),
                visualItem('복사 후 사람이 검토', { detail: '저장 · 자동 적용 안 함' }),
            ], { relation: 'branch' }),
            visualLane('검증 실패', [
                visualItem('안전 폐기', { detail: '화면 결과로 사용하지 않음', state: 'danger' }),
            ], { relation: 'branch' }),
        ],
    ),
    topicVisual(
        'timeline-overview',
        'lanes',
        '채팅 식별자별로 스냅샷이 분리되고 새 식별자의 분기는 별도 기록으로 이어지는 예시',
        '스냅샷은 요청 한 번이며 같은 채팅 식별자 안에서 시간순으로 쌓입니다.',
        [
            visualLane('채팅 A', [
                visualItem('요청 1'),
                visualItem('요청 2'),
                visualItem('요청 3', { state: 'success' }),
            ]),
            visualLane('분기된 채팅 B', [
                visualItem('요청 2에서 분기', { detail: '새 채팅 식별자', state: 'info' }),
                visualItem('분기 요청 1'),
            ], { relation: 'branch' }),
        ],
    ),
    topicVisual(
        'timeline-growth',
        'comparison',
        '비슷한 토큰 값은 확대해 보여주고 큰 격차가 생기면 전체 범위에 맞추는 성장 그래프 축 예시',
        '그래프의 점을 선택하면 해당 요청의 정확한 토큰 수를 확인할 수 있습니다.',
        [
            visualLane('값이 비슷할 때', [
                visualItem('1,080'),
                visualItem('1,092'),
                visualItem('1,105', { detail: '작은 차이를 확대', state: 'info' }),
            ], { relation: 'trend' }),
            visualLane('큰 격차가 생긴 뒤', [
                visualItem('1,080'),
                visualItem('1,105'),
                visualItem('2,430', { detail: '전체 범위로 축 조정', state: 'warning' }),
            ], { relation: 'trend' }),
        ],
    ),
    topicVisual(
        'diff-overview',
        'flow',
        '기준 스냅샷에서 비교 대상 스냅샷으로 향하는 변경 비교 방향',
        '선택 순서를 바꾸면 추가와 삭제의 방향도 반대로 바뀝니다.',
        [
            visualLane('비교 방향', [
                visualItem('기준', { detail: '변경 전 · 요청 2' }),
                visualItem('변경 계산', { detail: '기준에서 대상으로', state: 'info' }),
                visualItem('비교 대상', { detail: '변경 후 · 요청 3' }),
                visualItem('전체 문자열 차이', { detail: '소스 연결과 별도' }),
            ]),
        ],
    ),
    topicVisual(
        'diff-statuses',
        'lanes',
        '두 요청 사이에서 추가 삭제 수정 교체가 각각 판정되는 조건의 대조',
        '같은 식별자는 수정을 우선하며 교체는 같은 대안 그룹의 서로 다른 옵션일 때만 사용합니다.',
        [
            visualLane('추가 · 삭제', [
                visualItem('추가', { detail: '비교 대상에만 있음', state: 'success' }),
                visualItem('삭제', { detail: '기준에만 있음', state: 'danger' }),
            ], { relation: 'contrast' }),
            visualLane('수정', [
                visualItem('같은 식별자 유지', { detail: '내용 · 역할 · 위치 · 순서 변화', state: 'warning' }),
            ], { relation: 'contrast' }),
            visualLane('교체', [
                visualItem('출력언어 | 한국어'),
                visualItem('출력언어 | 영어', { detail: '같은 대안 그룹의 옵션 전환', state: 'info' }),
            ], { relation: 'replacement' }),
        ],
    ),
    topicVisual(
        'search-overview',
        'flow',
        '선택한 스냅샷에서 문구를 검색하고 결과 문맥을 거쳐 원본 프롬프트 카드로 이동하는 흐름',
        '검색은 선택한 스냅샷의 소스 원문을 대상으로 하며 데이터를 수정하지 않습니다.',
        [
            visualLane('검색 흐름', [
                visualItem('스냅샷 선택'),
                visualItem('검색어 입력', { detail: '일반 · 정규식 · 대소문자', state: 'info' }),
                visualItem('일치 문맥 확인'),
                visualItem('원본 소스로 이동', { state: 'success' }),
            ]),
        ],
    ),
    topicVisual(
        'settings-storage',
        'comparison',
        '채팅에 보관하는 스냅샷 수와 화면에 불러오는 스냅샷 수가 서로 독립적인 예시',
        '불러올 수를 줄여도 보관 한도 안의 나머지 스냅샷은 삭제되지 않습니다.',
        [
            visualLane('브라우저 저장소', [
                visualItem('채팅별 보관 100개', { detail: '최신 기록을 유지' }),
            ], { relation: 'contrast' }),
            visualLane('현재 패널', [
                visualItem('최근 20개 불러오기', { detail: '나머지 80개도 보관됨', state: 'info' }),
            ], { relation: 'contrast' }),
        ],
    ),
    topicVisual(
        'settings-privacy',
        'comparison',
        '같은 요청 원문을 전체 가림 메타데이터 저장 모드로 각각 보존한 결과',
        '보호 수준이 높아질수록 원문 검색과 규칙 검사의 범위는 줄어듭니다.',
        [
            visualLane('전체', [
                visualItem('사용자 이름: 민수', { detail: '원문 유지' }),
            ], { relation: 'contrast' }),
            visualLane('가림', [
                visualItem('사용자 이름: [가림]', { detail: '선택 문자열 대체', state: 'warning' }),
            ], { relation: 'contrast' }),
            visualLane('메타데이터', [
                visualItem('시각 · 모델 · 토큰', { detail: '원문 저장 안 함', state: 'info' }),
            ], { relation: 'contrast' }),
        ],
    ),
    topicVisual(
        'request-details',
        'lanes',
        '생성 설정 값과 역할별 프롬프트 payload 배열을 나란히 보여주는 요청 상세 구조',
        '요청 상세는 provider에 전달된 값을 읽는 화면이며 비어 있는 필드를 추측해 채우지 않습니다.',
        [
            visualLane('생성 설정', [
                visualItem('temperature 0.8'),
                visualItem('top_p 0.95'),
                visualItem('최대 응답 2,048 토큰'),
            ]),
            visualLane('프롬프트 payload', [
                visualItem('system', { detail: '메인 지시' }),
                visualItem('user', { detail: '현재 요청' }),
                visualItem('assistant', { detail: '프리필 또는 이력' }),
            ], { relation: 'parallel' }),
        ],
    ),
    topicVisual(
        'rule-v3-structure',
        'flow',
        '긴 원문이 여러 atom으로 나뉘고 atom 사이 relation을 거쳐 검사 후보가 되는 구조',
        '구조 정보는 원문을 대체하는 판정이 아니라 검토할 근거 범위를 좁혀 줍니다.',
        [
            visualLane('구조 분석', [
                visualItem('원문', { detail: '한국어로 답하고 JSON만 출력하세요' }),
                visualItem('Atom', { detail: '언어 · 형식 지시', state: 'info' }),
                visualItem('Relation', { detail: '동시 적용 · 대안 · 우선순위' }),
                visualItem('검사 후보', { detail: '확정 · 후보 · 근거 부족', state: 'warning' }),
                visualItem('원문 재검토', { state: 'success' }),
            ]),
        ],
    ),
    topicVisual(
        'semantic-provider-evaluation',
        'flow',
        '고정 corpus를 실제 provider에 반복 전송하고 응답 검증과 품질 지표를 계산하는 평가 경로',
        'Provider 평가는 특정 모델 경로의 품질 점검이며 개별 프롬프트 AI 검사와 별개입니다.',
        [
            visualLane('평가 경로', [
                visualItem('고정 corpus', { detail: '조건 · 예외 · 말투 · 역할 · 안전' }),
                visualItem('반복 provider 호출', { detail: '호출 수와 토큰 상한 확인', state: 'warning' }),
                visualItem('응답 검증', { detail: 'JSON · 식별자 · 인용 근거' }),
                visualItem('평가 지표', { detail: '통과율 · 근거 정확도 · 오탐률', state: 'success' }),
            ]),
        ],
    ),
    topicVisual(
        'storage-data-tools',
        'lanes',
        '저장 데이터를 바꾸는 백업 복원 삭제 작업과 읽기 전용 진단 및 무결성 검사를 구분한 구조',
        '복원과 삭제는 데이터에 영향을 주지만 진단 자료와 무결성 검사는 먼저 상태만 확인합니다.',
        [
            visualLane('데이터 변경 작업', [
                visualItem('백업 내보내기', { state: 'success' }),
                visualItem('복원 미리보기', { detail: '확인 뒤 적용', state: 'warning' }),
                visualItem('현재 채팅 · 전체 삭제', { detail: '확인 필요', state: 'danger' }),
            ]),
            visualLane('읽기 전용 점검', [
                visualItem('진단 자료', { detail: '저장소 상태 · 오류 코드', state: 'info' }),
                visualItem('무결성 검사', { detail: '손상 여부만 확인' }),
            ], { relation: 'contrast' }),
        ],
    ),
    topicVisual(
        'faq-common',
        'flow',
        '문제가 생겼을 때 캡처 상태와 요청 정보 및 AI 안전 경계를 순서대로 확인하는 기본 진단 흐름',
        '증상에 따라 관련 기능 설명서를 확인하면 원인과 다음 행동을 빠르게 찾을 수 있습니다.',
        [
            visualLane('확인 순서', [
                visualItem('증상 확인', { detail: '저장 없음 · 알 수 없음 · AI 폐기' }),
                visualItem('상태와 오류 카드 확인', { state: 'info' }),
                visualItem('관련 설명서 확인'),
                visualItem('안전한 다시 시도', { state: 'success' }),
            ]),
        ],
    ),
]);

export const HELP_TOPIC_VISUALS = Object.freeze(Object.fromEntries(
    HELP_TOPIC_VISUAL_LIST.map((visual) => [visual.id, visual]),
));

export function helpTopicVisualById(id) {
    return HELP_TOPIC_VISUALS[String(id ?? '')] ?? null;
}

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
