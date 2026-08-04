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

function defineAdvancedStep(id, target, copy, interaction = null) {
    return Object.freeze({
        id,
        group: 'rules',
        tabId: 'rules',
        target,
        icon: 'fa-graduation-cap',
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
        'advanced-comparison-mode',
        '[data-advanced-guide-control="mode"]',
        {
            title: '대안 그룹 동작을 선택합니다',
            what: '대안 그룹은 같은 그룹 안의 옵션끼리 비교하지 않지만 다른 그룹의 프롬프트와는 계속 비교합니다.',
            when: '한국어와 영어처럼 동시에 쓸 목적이 아닌 선택지를 교체 관계로 표시하고 싶을 때 사용합니다.',
            task: '강조된 목록에서 “대안 그룹”을 선택하세요.',
        },
        defineInteraction('change', '[data-advanced-guide-control="mode"]', {
            value: 'alternative',
        }),
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
            what: '한국어와 영어는 같은 출력언어 그룹의 대안으로 묶였고, 말투 같은 다른 그룹과의 비교는 유지됩니다.',
            when: '실제 설정을 적용하기 전후에 검사 후보가 의도한 범위에서만 줄었는지 검토할 때 사용합니다.',
            task: '적용 전후 수치와 “다른 그룹 비교 유지” 문구를 확인하세요. 이 연습 결과는 저장되지 않습니다.',
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
            title: '판정·근거·개선 방향을 함께 읽습니다',
            what: 'AI 결과는 자동으로 프롬프트를 수정하지 않습니다. 판정과 인용 근거를 확인한 뒤 제안 문구를 복사해 원래 편집 화면에서 사용합니다.',
            when: 'AI 제안을 그대로 따르기 전에 실제 원문과 맞는지 사람이 최종 검토할 때 사용합니다.',
            task: '세 영역을 읽고 “저장·자동 적용 안 함” 안내를 확인하세요. 이것은 고정된 연습 결과입니다.',
        },
    ),
]);

export const ADVANCED_ONBOARDING_GUIDES = Object.freeze([
    Object.freeze({
        id: 'comparison-policy',
        title: '비교 정책 설정',
        description: '이름 규칙, 대안 그룹, 적용 전후 미리보기를 실제 화면 흐름으로 익힙니다.',
        duration: '약 3분',
        icon: 'fa-diagram-project',
        steps: COMPARISON_POLICY_GUIDE_STEPS,
    }),
    Object.freeze({
        id: 'semantic-ai',
        title: 'AI 의미 검사',
        description: '연결 선택, 프롬프트, 전송 동의, 검증된 결과 확인 순서를 안전한 더미 데이터로 익힙니다.',
        duration: '약 4분',
        icon: 'fa-wand-magic-sparkles',
        steps: SEMANTIC_AI_GUIDE_STEPS,
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
