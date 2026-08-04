export const ONBOARDING_VERSION = 5;
export const ONBOARDING_STORAGE_KEY = 'st-devtools:onboarding:v5';

const VALID_STATUSES = new Set(['new', 'skipped', 'completed']);
const SCHEMA_VERSION = 1;

export const ONBOARDING_GROUPS = Object.freeze([
    Object.freeze({ id: 'capture', tabId: 'explorer', icon: 'fa-circle-dot' }),
    Object.freeze({ id: 'explorer', tabId: 'explorer', icon: 'fa-layer-group' }),
    Object.freeze({ id: 'rules', tabId: 'rules', icon: 'fa-shield-halved' }),
    Object.freeze({ id: 'timeline', tabId: 'timeline', icon: 'fa-clock-rotate-left' }),
    Object.freeze({ id: 'diff', tabId: 'diff', icon: 'fa-code-compare' }),
    Object.freeze({ id: 'search', tabId: 'search', icon: 'fa-magnifying-glass' }),
]);

const GROUP_BY_ID = new Map(ONBOARDING_GROUPS.map((group) => [group.id, group]));

function defineInteraction(event, selector, { value, state } = {}) {
    return Object.freeze({
        event,
        selector,
        ...(value === undefined ? {} : { value }),
        ...(state === undefined ? {} : { state }),
    });
}

function defineStep(groupId, id, target, interaction) {
    const group = GROUP_BY_ID.get(groupId);
    return Object.freeze({
        id,
        group: group.id,
        tabId: group.tabId,
        target,
        icon: group.icon,
        ...(interaction ? { interaction } : {}),
    });
}

export const ONBOARDING_STEPS = Object.freeze([
    // 캡처가 무엇인지 이해하고, 안전한 연습 요청을 캡처한 뒤 결과를 확인합니다.
    defineStep('capture', 'capture-purpose', '[data-tour-id="capture-status"]'),
    defineStep(
        'capture',
        'capture-practice',
        '[data-tour-id="capture-status"]',
        defineInteraction('panel', '[data-onboarding-action="run-capture-demo"]', { value: 'run' }),
    ),
    defineStep('capture', 'capture-result', '[data-tour-id="capture-status"]'),

    // 캡처된 요청이 원본 소스에서 최종 payload까지 이어지는 흐름을 살펴봅니다.
    defineStep(
        'explorer',
        'explorer-tab',
        '.st-devtools-app-nav-item[data-tab="explorer"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="explorer"]'),
    ),
    defineStep(
        'explorer',
        'explorer-snapshot-3',
        '[data-tour-id="snapshot-picker"] select',
        defineInteraction('change', '[data-tour-id="snapshot-picker"] select', {
            value: 'tutorial:snapshot:3',
        }),
    ),
    defineStep('explorer', 'explorer-overview', '.st-devtools-overview-card'),
    defineStep(
        'explorer',
        'explorer-included-filter',
        '.st-devtools-explorer-filter .st-devtools-switch-button',
        defineInteraction('click', '.st-devtools-explorer-filter .st-devtools-switch-button', {
            state: 'checked',
        }),
    ),
    defineStep(
        'explorer',
        'explorer-configured-group',
        '.st-devtools-source-group[data-group="configured"] > summary',
        defineInteraction('toggle', '.st-devtools-source-group[data-group="configured"]', {
            state: 'open',
        }),
    ),
    defineStep(
        'explorer',
        'explorer-format-source',
        '.st-devtools-source[data-source-id="tutorial:source:output"] > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-source[data-source-id="tutorial:source:output"]',
            { state: 'open' },
        ),
    ),
    defineStep(
        'explorer',
        'explorer-provenance',
        '.st-devtools-source[data-source-id="tutorial:source:output"] .st-devtools-provenance-details > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-source[data-source-id="tutorial:source:output"] .st-devtools-provenance-details',
            { state: 'open' },
        ),
    ),
    defineStep(
        'explorer',
        'explorer-final-group',
        '.st-devtools-source-group[data-group="final"] > summary',
        defineInteraction('toggle', '.st-devtools-source-group[data-group="final"]', { state: 'open' }),
    ),
    defineStep(
        'explorer',
        'explorer-final-source',
        '.st-devtools-source[data-source-id="tutorial:source:final:3"] > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-source[data-source-id="tutorial:source:final:3"]',
            { state: 'open' },
        ),
    ),
    defineStep(
        'explorer',
        'explorer-payload',
        '.st-devtools-prompt-request-data > summary',
        defineInteraction('toggle', '.st-devtools-prompt-request-data', { state: 'open' }),
    ),

    // 로컬 규칙 결과에서 근거와 관련 소스로 이동하는 경로를 연습합니다.
    defineStep(
        'rules',
        'rules-tab',
        '.st-devtools-app-nav-item[data-tab="rules"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="rules"]'),
    ),
    defineStep('rules', 'rules-summary', '.st-devtools-rule-summary'),
    defineStep('rules', 'rules-finding', '.st-devtools-rule-card[data-rule-id="format"]'),
    defineStep(
        'rules',
        'rules-evidence',
        '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-evidence > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-evidence',
            { state: 'open' },
        ),
    ),
    defineStep(
        'rules',
        'rules-related-sources',
        '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-actions button:first-child',
        defineInteraction(
            'click',
            '.st-devtools-rule-card[data-rule-id="format"] .st-devtools-rule-actions button:first-child',
        ),
    ),
    defineStep(
        'rules',
        'rules-return',
        '.st-devtools-app-nav-item[data-tab="rules"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="rules"]'),
    ),
    defineStep('rules', 'rules-ai-explanation', '.st-devtools-ai-mode-button'),

    // 성장 그래프와 목록을 오가며 스냅샷의 시계열 맥락을 확인합니다.
    defineStep(
        'timeline',
        'timeline-tab',
        '.st-devtools-app-nav-item[data-tab="timeline"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="timeline"]'),
    ),
    defineStep('timeline', 'timeline-growth', '.st-devtools-growth'),
    defineStep(
        'timeline',
        'timeline-point-snapshot-2',
        '.st-devtools-growth-hit[data-snapshot-id="tutorial:snapshot:2"]',
        defineInteraction(
            'click',
            '.st-devtools-growth-hit[data-snapshot-id="tutorial:snapshot:2"]',
        ),
    ),
    defineStep(
        'timeline',
        'timeline-open-snapshot',
        '.st-devtools-growth-detail .menu_button',
        defineInteraction('click', '.st-devtools-growth-detail .menu_button'),
    ),
    defineStep(
        'timeline',
        'timeline-return',
        '.st-devtools-app-nav-item[data-tab="timeline"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="timeline"]'),
    ),
    defineStep(
        'timeline',
        'timeline-list',
        '.st-devtools-timeline-snapshots > summary',
        defineInteraction('toggle', '.st-devtools-timeline-snapshots', { state: 'open' }),
    ),

    // 첫 번째와 세 번째 연습 스냅샷을 비교하며 변경 유형을 확인합니다.
    defineStep(
        'diff',
        'diff-tab',
        '.st-devtools-app-nav-item[data-tab="diff"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="diff"]'),
    ),
    defineStep(
        'diff',
        'diff-base-snapshot-2',
        '.st-devtools-diff-selectors [data-diff-role="base"] select',
        defineInteraction('change', '.st-devtools-diff-selectors [data-diff-role="base"] select', {
            value: 'tutorial:snapshot:2',
        }),
    ),
    defineStep(
        'diff',
        'diff-compare-snapshot-3',
        '.st-devtools-diff-selectors [data-diff-role="compare"] select',
        defineInteraction(
            'change',
            '.st-devtools-diff-selectors [data-diff-role="compare"] select',
            { value: 'tutorial:snapshot:3' },
        ),
    ),
    defineStep(
        'diff',
        'diff-added',
        '.st-devtools-source-change.status-added > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-source-change.status-added',
            { state: 'open' },
        ),
    ),
    defineStep(
        'diff',
        'diff-changed',
        '.st-devtools-source-change.status-changed > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-source-change.status-changed',
            { state: 'open' },
        ),
    ),
    defineStep(
        'diff',
        'diff-removed',
        '.st-devtools-source-change.status-removed > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-source-change.status-removed',
            { state: 'open' },
        ),
    ),
    defineStep(
        'diff',
        'diff-replaced',
        '.st-devtools-source-change.status-replaced > summary',
        defineInteraction(
            'toggle',
            '.st-devtools-source-change.status-replaced',
            { state: 'open' },
        ),
    ),
    defineStep(
        'diff',
        'diff-full',
        '.st-devtools-full-diff > summary',
        defineInteraction('toggle', '.st-devtools-full-diff', { state: 'open' }),
    ),

    // 세 번째 연습 스냅샷에서 한국어를 찾아 원본 소스로 이동하고 마칩니다.
    defineStep(
        'search',
        'search-tab',
        '.st-devtools-app-nav-item[data-tab="search"]',
        defineInteraction('click', '.st-devtools-app-nav-item[data-tab="search"]'),
    ),
    defineStep(
        'search',
        'search-snapshot-3',
        '[data-tour-id="snapshot-picker"] select',
        defineInteraction('change', '[data-tour-id="snapshot-picker"] select', {
            value: 'tutorial:snapshot:3',
        }),
    ),
    defineStep(
        'search',
        'search-query-korean',
        '.st-devtools-search-controls input[data-tour-id="search-input"]',
        defineInteraction('input', '.st-devtools-search-controls input[data-tour-id="search-input"]', {
            value: '한국어',
        }),
    ),
    defineStep(
        'search',
        'search-result-main-source',
        '.st-devtools-search-result[data-source-id="tutorial:source:main"]',
        defineInteraction(
            'click',
            '.st-devtools-search-result[data-source-id="tutorial:source:main"]',
        ),
    ),
    defineStep('search', 'search-finish', null),
]);

export const BASIC_ONBOARDING_SECTIONS = Object.freeze([
    Object.freeze({
        id: 'prompt',
        title: '프롬프트',
        description: '요청이 저장되는 순간부터 실제 전송 프롬프트와 payload를 확인합니다.',
        icon: 'fa-layer-group',
        groupIds: Object.freeze(['capture', 'explorer']),
    }),
    Object.freeze({
        id: 'timeline',
        title: '기록',
        description: '스냅샷 흐름과 프롬프트 성장 그래프를 읽습니다.',
        icon: 'fa-clock-rotate-left',
        groupIds: Object.freeze(['timeline']),
    }),
    Object.freeze({
        id: 'diff',
        title: '비교',
        description: '두 요청 사이의 추가·삭제·수정·교체를 구분합니다.',
        icon: 'fa-code-compare',
        groupIds: Object.freeze(['diff']),
    }),
    Object.freeze({
        id: 'rules',
        title: '검사',
        description: '로컬 검사 결과와 근거를 따라가며 충돌 후보를 검토합니다.',
        icon: 'fa-shield-halved',
        groupIds: Object.freeze(['rules']),
    }),
    Object.freeze({
        id: 'search',
        title: '검색',
        description: '문구를 검색하고 해당 원본 프롬프트까지 이동합니다.',
        icon: 'fa-magnifying-glass',
        groupIds: Object.freeze(['search']),
    }),
].map((section) => Object.freeze({
    ...section,
    steps: Object.freeze(ONBOARDING_STEPS.filter(({ group }) => (
        section.groupIds.includes(group)
    ))),
})));

export function basicOnboardingSectionById(id) {
    return BASIC_ONBOARDING_SECTIONS.find((section) => section.id === id) ?? null;
}

function defineAdvancedStep(
    id,
    target,
    copy,
    interaction = null,
    { group = 'rules', tabId = 'rules', icon = 'fa-graduation-cap' } = {},
) {
    return Object.freeze({
        id,
        group,
        tabId,
        target,
        icon,
        copy: Object.freeze({ ...copy }),
        ...(interaction ? { interaction } : {}),
    });
}

const COMPARISON_POLICY_GUIDE_STEPS = Object.freeze([
    defineAdvancedStep(
        'advanced-comparison-entry',
        '.st-devtools-rules-settings-button',
        {
            title: '비교 정책은 검사 설정에서 관리합니다',
            what: '비교 정책은 같은 목적의 선택지를 하나의 그룹으로 해석해 불필요한 충돌 후보를 줄이는 설정입니다.',
            when: '출력 언어, 말투, 응답 형식처럼 한 번에 하나만 켜는 프롬프트끼리 서로 충돌한다고 표시될 때 사용합니다.',
            task: '강조된 설정 아이콘의 위치를 확인하세요. 아래 연습 설정은 실제 정책을 바꾸지 않는 더미 화면입니다.',
        },
        defineInteraction('click', '.st-devtools-rules-settings-button'),
    ),
    defineAdvancedStep(
        'advanced-comparison-profile-scope',
        '[data-advanced-guide-control="profile-scope"]',
        {
            title: '정책은 적용 범위를 가진 프로필 안에 저장됩니다',
            what: '비교 정책 프로필은 전체, 프리셋, 캐릭터, 채팅 범위로 나뉩니다. 현재 요청에는 더 구체적인 채팅 범위부터 적용하고, 일치하는 규칙이 없을 때 더 넓은 범위로 내려갑니다.',
            when: '공통 규칙은 전체에 두고 특정 캐릭터나 채팅에서만 다른 이름 규칙을 사용해야 할 때 범위를 나눕니다.',
            task: '강조된 목록에서 “현재 채팅”을 선택하세요. 연습 프로필은 메모리에만 있으며 실제 정책에는 저장되지 않습니다.',
        },
        defineInteraction('change', '[data-advanced-guide-control="profile-scope"]', {
            value: 'chat',
        }),
    ),
    defineAdvancedStep(
        'advanced-comparison-profile-chain',
        '[data-advanced-guide-result="profile-chain"]',
        {
            title: '현재 요청에 적용되는 순서를 먼저 확인합니다',
            what: '적용 순서는 채팅, 캐릭터, 프리셋, 전체 순입니다. 같은 범위에 여러 프로필이 있으면 우선순위가 높은 프로필부터 확인합니다.',
            when: '분명히 만든 규칙이 적용되지 않거나 예상과 다른 프로필이 먼저 사용되는 이유를 찾을 때 확인합니다.',
            task: '강조된 적용 순서에서 “현재 채팅”이 가장 먼저 표시되고 그 뒤에 전체 기본값이 이어지는지 확인하세요.',
        },
    ),
    defineAdvancedStep(
        'advanced-comparison-mode',
        '[data-advanced-guide-control="mode"]',
        {
            title: '그룹 안의 프롬프트를 어떻게 다룰지 정합니다',
            what: '대안 그룹은 한국어와 영어처럼 서로 교체되는 옵션으로 해석하고, 내부 무시 그룹은 교체 관계를 만들지 않은 채 그룹 내부 비교와 경고만 숨깁니다.',
            when: '옵션 전환을 비교 화면에서 “교체”로 보고 싶으면 대안 그룹을, 단순히 서로 검사할 필요가 없는 보조 조각이면 내부 무시 그룹을 사용합니다.',
            task: '강조된 목록에서 “대안 그룹”을 선택하세요. 다른 그룹과의 비교는 계속 유지됩니다.',
        },
        defineInteraction('change', '[data-advanced-guide-control="mode"]', {
            value: 'alternative',
        }),
    ),
    defineAdvancedStep(
        'advanced-comparison-matcher',
        '[data-advanced-guide-control="matcher"]',
        {
            title: '이름에서 그룹과 옵션을 나눕니다',
            what: '이름 규칙은 프롬프트 이름의 공통 부분을 그룹으로, 달라지는 부분을 옵션으로 읽습니다.',
            when: '출력언어 | 한국어, 출력언어 | 영어처럼 일정한 이름 형식을 이미 쓰고 있을 때 가장 빠릅니다.',
            task: '강조된 목록에서 “{group} | {option}” 규칙을 선택하세요.',
        },
        defineInteraction('change', '[data-advanced-guide-control="matcher"]', {
            value: '{group} | {option}',
        }),
    ),
    defineAdvancedStep(
        'advanced-comparison-manual-assignment',
        '[data-advanced-guide-control="manual-assignment"]',
        {
            title: '예외적인 이름은 수동으로 정확히 지정합니다',
            what: '수동 지정은 선택한 프롬프트를 특정 그룹과 옵션에 직접 연결하며 이름 규칙보다 항상 우선합니다.',
            when: '일부 프롬프트만 이름 형식이 다르거나 같은 이름 규칙으로 잘못 묶이는 항목을 안전하게 바로잡을 때 사용합니다.',
            task: '강조된 목록에서 “출력 언어 ❤️ 한국어”를 한국어 옵션으로 지정하세요.',
        },
        defineInteraction('change', '[data-advanced-guide-control="manual-assignment"]', {
            value: 'tutorial:language-ko',
        }),
    ),
    defineAdvancedStep(
        'advanced-comparison-precedence',
        '[data-advanced-guide-result="precedence"]',
        {
            title: '수동 지정과 첫 이름 규칙만 사용됩니다',
            what: '수동 지정이 있으면 이름 규칙을 적용하지 않고, 수동 지정이 없으면 위에서 처음 일치한 이름 규칙 하나만 사용합니다. 여러 규칙의 결과를 합치지 않습니다.',
            when: '한 프롬프트가 여러 그룹에 들어가거나 규칙 순서에 따라 결과가 달라지는 혼란을 피할 때 이 우선순위를 확인합니다.',
            task: '강조된 결과에서 하트 이름은 수동 지정, 세로줄 이름은 첫 이름 규칙으로 분류됐는지 확인하세요.',
        },
    ),
    defineAdvancedStep(
        'advanced-comparison-preview',
        '[data-advanced-guide-control="preview"]',
        {
            title: '저장 전에 적용 결과를 미리 봅니다',
            what: '미리보기는 어떤 이름이 그룹으로 해석되고 내부 비교가 몇 건 줄어드는지 보여줍니다.',
            when: '이름 규칙이 너무 넓게 적용되거나 엉뚱한 프롬프트까지 묶이지 않는지 확인할 때 사용합니다.',
            task: '강조된 “적용 전후 미리보기” 버튼을 누르세요.',
        },
        defineInteraction('click', '[data-advanced-guide-control="preview"]'),
    ),
    defineAdvancedStep(
        'advanced-comparison-result',
        '[data-advanced-guide-result="comparison"]',
        {
            title: '그룹 내부 비교만 제외됐는지 확인합니다',
            what: '한국어와 영어는 같은 출력언어 그룹의 대안으로 묶였고 말투 같은 다른 그룹과의 비교는 유지됩니다. 한 요청에 같은 대안 그룹 옵션이 여러 개 켜져 있으면 별도의 모호성 경고가 남습니다.',
            when: '실제 설정을 적용하기 전에 검사 후보가 의도한 범위에서만 줄고 잘못된 다중 활성 상태는 숨겨지지 않았는지 검토합니다.',
            task: '적용 전후 수치, “다른 그룹 비교 유지”, “다중 활성 경고 유지” 문구를 확인하세요. 이 연습 결과는 저장되지 않습니다.',
        },
    ),
]);

const SEMANTIC_AI_GUIDE_STEPS = Object.freeze([
    defineAdvancedStep(
        'advanced-semantic-entry',
        '.st-devtools-ai-mode-button',
        {
            title: 'AI 검사는 로컬 검사와 분리해서 켭니다',
            what: 'AI 모드는 선택한 로컬 검사 후보의 의미와 개선 방향을 추가로 확인하는 별도 화면입니다.',
            when: '정적 규칙만으로 실제 충돌인지 판단하기 어렵고 문맥을 함께 검토하고 싶을 때 사용합니다.',
            task: '강조된 “AI로 더 자세히 보기” 버튼을 누르세요. 연습에서는 실제 AI에 연결하지 않습니다.',
        },
        defineInteraction('click', '.st-devtools-ai-mode-button'),
    ),
    defineAdvancedStep(
        'advanced-semantic-target',
        '[data-advanced-guide-control="target"]',
        {
            title: 'AI에 보낼 검사 후보는 사용자가 직접 고릅니다',
            what: 'AI 모드를 켜는 것만으로는 아무 원문도 선택하거나 전송하지 않습니다. 체크한 로컬 finding 또는 지시 묶음과 연결된 최소 근거만 준비합니다.',
            when: '여러 로컬 경고 중 문맥 판단이 필요한 하나만 AI로 추가 검토해 전송 범위와 비용을 줄일 때 사용합니다.',
            task: '강조된 “응답 형식 충돌” 후보를 선택하세요. 다른 로컬 결과는 선택되지 않은 채 남습니다.',
        },
        defineInteraction('change', '[data-advanced-guide-control="target"]', {
            state: 'checked',
        }),
    ),
    defineAdvancedStep(
        'advanced-semantic-profile',
        '[data-advanced-guide-control="profile"]',
        {
            title: '어떤 AI 연결을 쓸지 먼저 확인합니다',
            what: '연결 프로필은 SillyTavern에 이미 설정된 제공자와 모델 연결을 선택합니다. API 키는 ST DevTools에 저장하지 않습니다.',
            when: '채팅용 모델과 검사 전용 모델을 다르게 쓰거나 비용과 품질을 구분하고 싶을 때 사용합니다.',
            task: '강조된 목록에서 “현재 채팅 연결”을 선택하세요.',
        },
        defineInteraction('change', '[data-advanced-guide-control="profile"]', {
            value: 'current',
        }),
    ),
    defineAdvancedStep(
        'advanced-semantic-token-cap',
        '[data-advanced-guide-control="token-cap"]',
        {
            title: '응답 상한은 비용과 결과 길이를 제한합니다',
            what: '응답 토큰 상한은 AI가 반환할 수 있는 최대 길이이며 입력 토큰이나 provider의 비용 상한과 같은 값은 아닙니다.',
            when: '간결한 판정만 필요하거나 연결 모델이 지나치게 긴 설명을 생성하는 것을 제한하고 싶을 때 조정합니다.',
            task: '강조된 입력값을 512 토큰으로 맞추고, 전송 미리보기에서도 같은 상한이 표시되는지 이후 단계에서 확인하세요.',
        },
        defineInteraction('change', '[data-advanced-guide-control="token-cap"]', {
            value: '512',
        }),
    ),
    defineAdvancedStep(
        'advanced-semantic-prompt',
        '[data-advanced-guide-control="prompt"]',
        {
            title: '검사 프롬프트와 프리필을 확인합니다',
            what: '사용자 프롬프트는 AI가 무엇을 검토할지 정하고, 프리필은 응답 형식을 안정적으로 시작하도록 돕습니다.',
            when: '사용하는 모델이 기본 검사 지시를 잘 따르지 않거나 조직별 검토 기준을 추가할 때 조정합니다.',
            task: '강조된 “검사 프롬프트” 묶음을 펼치세요. 연습 내용은 저장되지 않습니다.',
        },
        defineInteraction('toggle', '[data-advanced-guide-control="prompt"]', {
            state: 'open',
        }),
    ),
    defineAdvancedStep(
        'advanced-semantic-preview',
        '[data-advanced-guide-control="preview"]',
        {
            title: '실행 전에 실제 전송 범위를 미리 봅니다',
            what: '전송 미리보기에는 provider와 모델, 예상 입력 토큰, 응답 상한, 고정 지시, 추가 프롬프트, 프리필과 포함 원문이 표시됩니다.',
            when: '민감한 내용이 포함되거나 예상과 다른 연결 프로필이 선택된 상태에서 실행하는 실수를 막기 위해 매 호출 전에 확인합니다.',
            task: '강조된 “전송 내용 미리보기” 버튼을 누르세요. 연습에서는 고정된 더미 미리보기만 열립니다.',
        },
        defineInteraction('click', '[data-advanced-guide-control="preview"]'),
    ),
    defineAdvancedStep(
        'advanced-semantic-source-scope',
        '[data-advanced-guide-result="source-scope"]',
        {
            title: '포함된 원문과 제외 이유를 함께 확인합니다',
            what: '선택 후보의 source·atom·relation 연결에 필요한 활성 원문만 포함하고 나머지는 이름과 제외 이유만 표시합니다. 원문 제거본이나 메타데이터만 스냅샷에서는 AI 검사를 시작하지 않습니다.',
            when: 'AI 제공자에게 전달되는 정확한 범위를 검토하고 개인정보 저장 모드 때문에 실행할 수 없는 이유를 구분할 때 확인합니다.',
            task: '강조된 미리보기에서 Main Prompt와 출력 규칙만 포함되고, 캐릭터 설정은 “선택 근거와 무관”으로 제외됐는지 확인하세요.',
        },
    ),
    defineAdvancedStep(
        'advanced-semantic-consent',
        '[data-advanced-guide-control="consent"]',
        {
            title: '전송 내용을 보고 매번 동의합니다',
            what: 'AI 검사 전에는 선택한 근거 원문, 연결 프로필, 응답 상한을 미리 보여주고 실행할 때마다 동의를 받습니다.',
            when: '민감한 프롬프트가 외부 제공자에게 전달되는 범위를 직접 확인해야 할 때 중요합니다.',
            task: '강조된 동의 체크박스를 켜세요. 더미 데이터이므로 실제 전송은 일어나지 않습니다.',
        },
        defineInteraction('change', '[data-advanced-guide-control="consent"]', {
            state: 'checked',
        }),
    ),
    defineAdvancedStep(
        'advanced-semantic-run',
        '[data-advanced-guide-control="run"]',
        {
            title: '검증 가능한 결과만 화면에 사용합니다',
            what: '응답 구조와 근거가 요청 원문에 맞는지 검사한 뒤 통과한 결과만 보여줍니다. 검증에 실패한 응답은 폐기합니다.',
            when: 'AI가 그럴듯하지만 근거 없는 설명을 반환하는 위험을 줄여야 할 때 필요한 안전 단계입니다.',
            task: '강조된 “연습 AI 검사 실행” 버튼을 누르세요.',
        },
        defineInteraction('click', '[data-advanced-guide-control="run"]'),
    ),
    defineAdvancedStep(
        'advanced-semantic-result',
        '[data-advanced-guide-result="semantic"]',
        {
            title: '검증 결과와 안전 폐기 예시를 함께 읽습니다',
            what: '올바른 결과는 판정·인용 근거·개선 방향으로 표시되지만 JSON 구조가 잘못됐거나 인용 범위가 원문과 맞지 않으면 응답 전체를 폐기합니다. 통과한 제안도 자동으로 프롬프트를 수정하지 않습니다.',
            when: 'AI 제안을 따르기 전에 실제 원문과 근거가 맞는지 사람이 최종 검토하고, 결과가 보이지 않는 것이 안전 검증 때문인지 판단할 때 사용합니다.',
            task: '검증 통과 카드와 “근거 불일치로 폐기” 예시를 비교하고 “저장·자동 적용 안 함” 안내를 확인하세요. 모두 고정된 연습 결과입니다.',
        },
    ),
]);

const FINDING_REVIEW_GUIDE_STEPS = Object.freeze([
    defineAdvancedStep(
        'advanced-review-entry',
        '[data-advanced-guide-control="review-open"]',
        {
            title: '검사 결과마다 검토 결정을 따로 남길 수 있습니다',
            what: '검토 영역은 로컬 규칙이 찾은 후보를 사람이 확인한 뒤 유효하거나 오탐이라고 기록하고, 필요하면 표시 범위를 조정하는 곳입니다.',
            when: '같은 경고를 반복해서 읽지 않으면서도 자동 검사를 끄지 않고 사람의 판단을 남기고 싶을 때 사용합니다.',
            task: '강조된 “이 검사 결과 검토”를 펼치세요. 연습 결정은 메모리에만 남고 실제 검토 기록에는 저장되지 않습니다.',
        },
        defineInteraction('toggle', '[data-advanced-guide-control="review-open"]', {
            state: 'open',
        }),
    ),
    defineAdvancedStep(
        'advanced-review-false-positive',
        '[data-advanced-guide-control="decision-false-positive"]',
        {
            title: '유효와 오탐은 규칙의 사용 여부가 아니라 이 결과의 판단입니다',
            what: '유효는 실제로 검토할 문제였다는 뜻이고 오탐은 현재 원문 문맥에서는 문제가 아니라는 뜻입니다. 둘 다 검사 규칙 자체를 비활성화하지 않습니다.',
            when: '같은 유형의 규칙은 계속 사용하되 현재 근거만 잘못 잡혔다고 판단했을 때 오탐을 선택합니다.',
            task: '강조된 “오탐”을 선택하세요. 더미 결과가 검토 완료 영역으로 이동할 준비를 합니다.',
        },
        defineInteraction('change', '[data-advanced-guide-control="decision-false-positive"]', {
            value: 'false-positive',
        }),
    ),
    defineAdvancedStep(
        'advanced-review-decision-result',
        '[data-advanced-guide-result="decision"]',
        {
            title: '오탐 결정은 같은 의미 결과를 접어 두는 데 사용됩니다',
            what: '오탐으로 저장한 결과는 기본 목록에서 빠지지만 검토 완료 목록에 남아 나중에 다시 표시할 수 있습니다. 이번만 숨김은 패널을 닫으면 사라지는 임시 선택입니다.',
            when: '영구 판단과 현재 화면만 정리하는 임시 숨김을 혼동하지 않도록 저장 전에 차이를 확인합니다.',
            task: '강조된 설명에서 “오탐은 복원 가능”, “이번만 숨김은 세션 전용” 문구를 확인하세요.',
        },
    ),
    defineAdvancedStep(
        'advanced-review-ignore-scope',
        '[data-advanced-guide-control="ignore-scope"]',
        {
            title: '항상 무시는 가장 좁은 필요한 범위에만 적용합니다',
            what: '항상 무시는 안정된 finding 의미 키를 정책 범위에 기록합니다. 채팅, 캐릭터, 프리셋, 전체 중 좁은 범위를 고르면 다른 대화의 유효한 경고를 함께 숨길 위험을 줄일 수 있습니다.',
            when: '현재 채팅에서 의도적으로 반복되는 패턴처럼 앞으로도 계속 무시할 근거가 분명할 때만 사용합니다.',
            task: '강조된 적용 범위에서 “현재 채팅”을 선택하세요. 실제 제품에서도 기본적으로 가장 좁은 적용 가능한 범위를 우선합니다.',
        },
        defineInteraction('change', '[data-advanced-guide-control="ignore-scope"]', {
            value: 'chat',
        }),
    ),
    defineAdvancedStep(
        'advanced-review-always-ignore',
        '[data-advanced-guide-control="always-ignore"]',
        {
            title: '항상 무시는 확인 후 적용하는 별도 결정입니다',
            what: '항상 무시는 오탐 판정과 달리 선택 범위에서 같은 의미 결과를 계속 숨깁니다. 검사 규칙 전체를 끄거나 SillyTavern 프롬프트를 변경하지는 않습니다.',
            when: '같은 패턴이 반복해서 생성되고 그 범위에서는 의도한 구성임을 충분히 검토했을 때 사용합니다.',
            task: '강조된 “이 패턴 항상 무시”를 누르세요. 연습 화면에서는 확인 과정을 재현하지만 로컬 설정을 쓰지 않습니다.',
        },
        defineInteraction('click', '[data-advanced-guide-control="always-ignore"]'),
    ),
    defineAdvancedStep(
        'advanced-review-reviewed-result',
        '[data-advanced-guide-result="reviewed"]',
        {
            title: '숨긴 결과와 변경 기록은 다시 확인할 수 있습니다',
            what: '검토 완료 목록에는 오탐과 무시된 결과가 상태와 함께 남고, 감사 기록에는 언제 어떤 범위의 결정을 바꿨는지가 원문 없이 기록됩니다.',
            when: '경고가 갑자기 사라진 이유를 찾거나 과거 결정이 지금도 적절한지 재검토할 때 사용합니다.',
            task: '강조된 카드에서 “현재 채팅 · 항상 무시” 상태와 메모리 전용 연습 기록을 확인하세요.',
        },
    ),
    defineAdvancedStep(
        'advanced-review-restore',
        '[data-advanced-guide-control="restore"]',
        {
            title: '잘못 숨긴 결과는 다시 표시할 수 있습니다',
            what: '다시 표시는 오탐 판정이나 항상 무시 결정을 해제해 해당 결과를 기본 검사 목록으로 돌려놓습니다.',
            when: '프롬프트가 바뀌었거나 이전 판단이 너무 넓었다고 확인했을 때 검사를 다시 받을 수 있도록 복원합니다.',
            task: '강조된 “다시 표시”를 누르고 더미 결과가 기본 목록으로 돌아오는지 확인하세요.',
        },
        defineInteraction('click', '[data-advanced-guide-control="restore"]'),
    ),
]);

const RULE_STRUCTURE_GUIDE_STEPS = Object.freeze([
    defineAdvancedStep(
        'advanced-structure-analysis',
        '.st-devtools-rule-advanced > summary',
        {
            title: '분석 상세에서 검사 후보가 만들어진 구조를 봅니다',
            what: '분석 상세는 화면의 경고 카드 뒤에서 어떤 비교가 제외됐고 어떤 지시 구조가 만들어졌는지 보여주는 읽기 전용 영역입니다.',
            when: '경고 제목과 원문만으로 왜 같은 후보로 묶였는지 이해하기 어려울 때 구조 근거를 따라갑니다.',
            task: '강조된 “분석 상세”을 펼치세요. 고정된 연습 스냅샷을 로컬에서 분석한 결과만 사용합니다.',
        },
        defineInteraction('toggle', '.st-devtools-rule-advanced', { state: 'open' }),
    ),
    defineAdvancedStep(
        'advanced-structure-model',
        '.st-devtools-instruction-model > summary',
        {
            title: '지시 구조 모델의 전체 크기를 먼저 확인합니다',
            what: 'atom은 원문에서 분리한 최소 지시 단위이고 relation은 atom 사이의 일치, 충돌, 대안, 조건 같은 관계 후보입니다.',
            when: '긴 프롬프트에서 검사 범위가 너무 넓거나 분석 제한 때문에 일부 근거가 생략됐는지 빠르게 확인할 때 사용합니다.',
            task: '강조된 “지시 구조”를 펼치고 atom 수, relation 수와 분석 제한 경고가 있는지 확인하세요.',
        },
        defineInteraction('toggle', '.st-devtools-instruction-model', { state: 'open' }),
    ),
    defineAdvancedStep(
        'advanced-structure-determination',
        '[data-advanced-guide-result="determination-summary"]',
        {
            title: '확정·후보·근거 부족은 심각도와 다른 축입니다',
            what: '확정은 구조와 원문 근거가 충분한 관계, 후보는 일부 근거가 있지만 사람이 확인해야 하는 관계, 근거 부족은 위치나 문맥을 충분히 연결하지 못한 관계입니다.',
            when: '치명적·경고·정보 같은 심각도만 보고 확실성을 오해하지 않도록 관계의 판정 상태를 함께 읽습니다.',
            task: '강조된 요약에서 확정, 후보, 근거 부족의 개수를 각각 확인하세요.',
        },
    ),
    defineAdvancedStep(
        'advanced-structure-atoms',
        '[data-advanced-guide-control="instruction-atoms"]',
        {
            title: 'atom 목록에서 한 문장 안의 지시를 분리해서 봅니다',
            what: '하나의 원문도 출력 형식, 언어, 길이, 조건처럼 여러 atom으로 나뉠 수 있으며 각 atom은 원본 소스와 위치를 유지합니다.',
            when: '한 프롬프트 카드가 왜 여러 검사 후보에 참여했는지 또는 어떤 의미만 추출됐는지 확인할 때 사용합니다.',
            task: '강조된 “지시 단위” 묶음을 펼치세요.',
        },
        defineInteraction('toggle', '[data-advanced-guide-control="instruction-atoms"]', {
            state: 'open',
        }),
    ),
    defineAdvancedStep(
        'advanced-structure-atom',
        '[data-advanced-guide-result="instruction-atom"]',
        {
            title: '속성·극성·범위와 적용 대상을 함께 읽습니다',
            what: '속성은 형식이나 언어처럼 무엇을 지시하는지, 극성은 요구인지 금지인지, 범위와 대상은 어느 응답에 어떻게 적용되는지를 나타냅니다.',
            when: '문구가 비슷하다는 이유만으로 잘못 충돌한 것인지 실제로 같은 대상에 반대 동작을 요구하는지 구분할 때 확인합니다.',
            task: '강조된 XML 형식 atom에서 속성, 요구 극성, 응답 범위와 원본 “출력 규칙” 이름을 읽으세요.',
        },
    ),
    defineAdvancedStep(
        'advanced-structure-evidence',
        '[data-advanced-guide-control="atom-evidence"]',
        {
            title: '추출된 atom을 반드시 원문 근거와 대조합니다',
            what: '원문 근거에는 atom이 나온 정확한 문자열과 소스가 표시됩니다. 구조 라벨은 설명을 돕는 도구이며 원문보다 우선하는 판정이 아닙니다.',
            when: '추출기가 조건, 예외, 인용문을 지시로 잘못 읽지 않았는지 사람이 최종 확인할 때 사용합니다.',
            task: '강조된 “원문 근거”를 펼치고 XML 지시가 실제 출력 규칙 문자열 안에 있는지 확인하세요.',
        },
        defineInteraction('toggle', '[data-advanced-guide-control="atom-evidence"]', {
            state: 'open',
        }),
    ),
    defineAdvancedStep(
        'advanced-structure-cluster',
        '[data-advanced-guide-result="finding-cluster"]',
        {
            title: 'relation과 cluster가 최종 검사 후보로 이어집니다',
            what: 'relation은 JSON과 XML처럼 같은 대상에 양립하기 어려운 atom을 연결하고, cluster는 관련 atom과 relation을 한 검사 후보로 묶습니다. 이 연결도 확정 판정이 아니라 근거 경로입니다.',
            when: '검사 카드의 출처가 어느 atom과 관계에서 왔는지 확인하고 관련 소스나 최종 프롬프트 근거로 이동할 때 사용합니다.',
            task: '강조된 결과에서 atom 2개와 relation 1개가 응답 형식 충돌 후보로 묶였는지 확인하세요.',
        },
    ),
]);

const DIFF_ADVANCED_STEP_OPTIONS = Object.freeze({
    group: 'diff',
    tabId: 'diff',
    icon: 'fa-code-compare',
});

const DIFF_REPLACEMENT_GUIDE_STEPS = Object.freeze([
    defineAdvancedStep(
        'advanced-replacement-base',
        '[data-diff-role="base"] select',
        {
            title: '교체 전 요청을 기준으로 선택합니다',
            what: '교체 비교는 같은 목적의 대안 그룹에서 활성 옵션 하나가 다른 옵션 하나로 바뀐 경우를 기준에서 비교 대상으로 읽습니다.',
            when: '출력 언어, 말투, 응답 형식처럼 한 번에 하나만 쓰는 옵션을 바꾼 기록을 추가·삭제와 구분할 때 사용합니다.',
            task: '강조된 기준 목록에서 “한국어 요청”을 선택하세요.',
        },
        defineInteraction('change', '[data-diff-role="base"] select', {
            value: 'tutorial:replacement:base',
        }),
        DIFF_ADVANCED_STEP_OPTIONS,
    ),
    defineAdvancedStep(
        'advanced-replacement-compare',
        '[data-diff-role="compare"] select',
        {
            title: '교체 후 요청을 비교 대상으로 선택합니다',
            what: '비교 대상은 변경 후로 해석할 요청입니다. 방향을 바꾸면 이전 옵션과 이후 옵션도 서로 바뀝니다.',
            when: '어느 요청에서 옵션이 켜지고 꺼졌는지 시간 방향을 분명하게 유지해야 할 때 사용합니다.',
            task: '강조된 비교 대상 목록에서 “영어 요청”을 선택하세요.',
        },
        defineInteraction('change', '[data-diff-role="compare"] select', {
            value: 'tutorial:replacement:compare',
        }),
        DIFF_ADVANCED_STEP_OPTIONS,
    ),
    defineAdvancedStep(
        'advanced-replacement-ungrouped',
        '[data-advanced-guide-result="ungrouped-diff"]',
        {
            title: '정책이 없으면 안전하게 추가와 삭제로 표시합니다',
            what: '이름이나 식별자만으로 두 소스가 같은 옵션 그룹인지 확정할 수 없으면 한국어 삭제와 영어 추가를 별개 변경으로 남깁니다.',
            when: '잘못된 옵션 교체 추측으로 서로 무관한 프롬프트를 한 변화처럼 보이지 않게 하는 안전한 기본 동작입니다.',
            task: '강조된 결과에서 “출력언어 | 한국어”는 삭제, “출력언어 | 영어”는 추가로 표시되는지 확인하세요.',
        },
        null,
        DIFF_ADVANCED_STEP_OPTIONS,
    ),
    defineAdvancedStep(
        'advanced-replacement-enable-group',
        '[data-advanced-guide-control="enable-alternative-group"]',
        {
            title: '같은 대안 그룹이라는 정책 근거를 적용합니다',
            what: '출력언어 그룹과 한국어·영어 옵션이 명확히 연결되고 각 요청에 활성 옵션이 정확히 하나씩 있을 때만 교체로 묶습니다.',
            when: '사용자가 정한 그룹 의미를 비교 화면에도 반영해 옵션 전환을 한눈에 보고 싶을 때 사용합니다.',
            task: '강조된 “출력언어 대안 그룹 적용”을 누르세요. 메모리 속 더미 정책만 바뀝니다.',
        },
        defineInteraction('click', '[data-advanced-guide-control="enable-alternative-group"]'),
        DIFF_ADVANCED_STEP_OPTIONS,
    ),
    defineAdvancedStep(
        'advanced-replacement-card',
        '.st-devtools-source-change.status-replaced > summary',
        {
            title: '추가와 삭제가 하나의 교체 카드로 합쳐집니다',
            what: '교체 카드는 그룹 이름과 이전 옵션, 이후 옵션을 함께 표시합니다. 같은 식별자의 소스 내용이 바뀐 경우에는 그룹이 있어도 교체가 아니라 수정으로 유지됩니다.',
            when: '옵션 전환과 같은 프롬프트의 내용 수정을 혼동하지 않고 변경 의도를 읽을 때 사용합니다.',
            task: '강조된 교체 카드를 펼치고 “출력언어 · 한국어 → 영어”가 표시되는지 확인하세요.',
        },
        defineInteraction('toggle', '.st-devtools-source-change.status-replaced', {
            state: 'open',
        }),
        DIFF_ADVANCED_STEP_OPTIONS,
    ),
    defineAdvancedStep(
        'advanced-replacement-direction',
        '[data-advanced-guide-result="replacement-direction"]',
        {
            title: '교체 방향과 모호성 경계를 마지막으로 확인합니다',
            what: '기준과 비교 대상을 바꾸면 한국어와 영어의 이전·이후 방향도 바뀝니다. 한쪽 요청에 같은 그룹 옵션이 여러 개 활성화되면 교체로 묶지 않고 모호성 경고를 유지합니다.',
            when: '교체 결과를 설정 변경 기록으로 해석하거나 여러 옵션이 동시에 켜진 잘못된 상태를 놓치지 않기 위해 확인합니다.',
            task: '강조된 요약에서 기준 “한국어”, 비교 대상 “영어”, 활성 옵션 각 1개가 교체 조건으로 표시되는지 확인하세요.',
        },
        null,
        DIFF_ADVANCED_STEP_OPTIONS,
    ),
]);

export const ADVANCED_ONBOARDING_GUIDES = Object.freeze([
    Object.freeze({
        id: 'comparison-policy',
        title: '비교 정책 설정',
        description: '적용 범위, 그룹 동작, 이름 규칙, 수동 지정 우선순위와 적용 전후 미리보기를 익힙니다.',
        duration: '약 5분',
        icon: 'fa-diagram-project',
        steps: COMPARISON_POLICY_GUIDE_STEPS,
    }),
    Object.freeze({
        id: 'semantic-ai',
        title: 'AI 의미 검사',
        description: '후보 선택부터 정확한 전송 범위, 호출별 동의, 검증 통과와 안전 폐기까지 익힙니다.',
        duration: '약 6분',
        icon: 'fa-wand-magic-sparkles',
        steps: SEMANTIC_AI_GUIDE_STEPS,
    }),
    Object.freeze({
        id: 'finding-review',
        title: '검사 결과 판정과 예외 관리',
        description: '유효·오탐, 이번만 숨김, 범위별 항상 무시와 복원 차이를 안전하게 익힙니다.',
        duration: '약 4분',
        icon: 'fa-list-check',
        steps: FINDING_REVIEW_GUIDE_STEPS,
    }),
    Object.freeze({
        id: 'rule-structure',
        title: 'Atom·Relation 근거 읽기',
        description: '지시 단위와 관계가 확정·후보·근거 부족 검사 결과로 이어지는 경로를 익힙니다.',
        duration: '약 4분',
        icon: 'fa-sitemap',
        steps: RULE_STRUCTURE_GUIDE_STEPS,
    }),
    Object.freeze({
        id: 'diff-replacement',
        title: '대안 그룹 교체 비교',
        description: '그룹 정책이 없는 추가·삭제와 근거가 있는 옵션 교체를 비교 화면에서 구분합니다.',
        duration: '약 3분',
        icon: 'fa-code-compare',
        steps: DIFF_REPLACEMENT_GUIDE_STEPS,
    }),
]);

export function advancedOnboardingGuideById(id) {
    return ADVANCED_ONBOARDING_GUIDES.find((guide) => guide.id === id) ?? null;
}

export function normalizeOnboardingState(value) {
    const hasExplicitVersion = value != null && (
        Object.hasOwn(value, 'schemaVersion')
        || Object.hasOwn(value, 'tourVersion')
    );
    const versionMatches = !hasExplicitVersion || (
        Number(value?.schemaVersion) === SCHEMA_VERSION
        && Number(value?.tourVersion) === ONBOARDING_VERSION
    );
    const disposition = versionMatches && VALID_STATUSES.has(value?.disposition)
        ? value.disposition
        : 'new';
    return Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        tourVersion: ONBOARDING_VERSION,
        disposition,
    });
}

export function readOnboardingState(storage = globalThis.localStorage) {
    try {
        const stored = JSON.parse(storage?.getItem?.(ONBOARDING_STORAGE_KEY) ?? 'null');
        if (
            Number(stored?.schemaVersion) !== SCHEMA_VERSION
            || Number(stored?.tourVersion) !== ONBOARDING_VERSION
        ) {
            return normalizeOnboardingState(null);
        }
        return normalizeOnboardingState(stored);
    } catch {
        return normalizeOnboardingState(null);
    }
}

export function shouldAutoStartOnboarding(state) {
    return normalizeOnboardingState(state).disposition === 'new';
}

export function saveOnboardingState(
    disposition,
    {
        storage = globalThis.localStorage,
    } = {},
) {
    if (!['skipped', 'completed'].includes(disposition)) return null;
    const state = normalizeOnboardingState({
        disposition,
    });
    try {
        const serialized = JSON.stringify(state);
        storage?.setItem?.(ONBOARDING_STORAGE_KEY, serialized);
        if (storage?.getItem?.(ONBOARDING_STORAGE_KEY) !== serialized) return null;
        return state;
    } catch {
        return null;
    }
}
