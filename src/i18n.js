const KO = {
    'app.open': 'ST DevTools 열기',
    'app.readOnly': '읽기 전용',
    'app.initializationError': 'ST DevTools를 시작할 수 없습니다. SillyTavern을 업데이트하고 브라우저 콘솔을 확인하세요.',
    'action.refresh': '타임라인 새로고침',
    'action.close': '닫기',
    'action.clearTimeline': '타임라인 비우기',
    'action.copy': '복사',
    'action.export': '{format} 내보내기',
    'action.promptCopied': '프롬프트를 복사했습니다.',
    'tab.explorer': '프롬프트 탐색기',
    'tab.timeline': '타임라인',
    'tab.diff': '프롬프트 비교',
    'tab.context': '컨텍스트',
    'tab.rules': '규칙 검사',
    'tab.search': '검색',
    'empty.title': '저장된 프롬프트 스냅샷이 없습니다',
    'empty.description': '일반 채팅 메시지를 보내면 원본을 변경하지 않고 조립된 프롬프트를 캡처합니다.',
    'snapshot.label': '스냅샷',
    'snapshot.tokens': '{count} 토큰',
    'snapshot.retained': '현재 채팅에 스냅샷 {count}개가 보관되어 있습니다.',
    'timeline.deleteConfirm': '현재 채팅의 ST DevTools 스냅샷을 모두 삭제할까요? 삭제 후 복구할 수 없습니다.',
    'timeline.unknownModel': '모델 정보 없음',
    'timeline.loreCount': '로어북 항목 {count}개',
    'diff.minimum': '비교하려면 스냅샷이 2개 이상 필요합니다.',
    'diff.base': '기준',
    'diff.compare': '비교 대상',
    'stat.promptTokens': '프롬프트 토큰',
    'stat.contextLimit': '컨텍스트 한도',
    'stat.reservedOutput': '출력 예약량',
    'stat.remaining': '남은 컨텍스트',
    'stat.contextUsage': '컨텍스트 사용률',
    'stat.largestSource': '가장 큰 소스',
    'common.unknown': '알 수 없음',
    'search.placeholder': '모든 프롬프트 소스에서 텍스트 찾기',
    'search.regex': '정규식',
    'search.matchCase': '대소문자 구분',
    'search.matches': '{count}개 일치',
    'search.matchesLimited': '{count}개 이상 일치',
    'search.invalidRegex': '잘못된 정규식: {message}',
    'source.characterDescription': '캐릭터 설명',
    'source.characterPersonality': '캐릭터 성격',
    'source.scenario': '시나리오',
    'source.persona': '페르소나',
    'source.authorsNote': '작가 노트',
    'source.chatHistory': '채팅 기록',
    'source.assistantPrefill': '어시스턴트 프리필 / 마지막 어시스턴트 메시지',
    'source.finalPrompt': '최종 프롬프트',
    'source.configuredPrompt': '설정 프롬프트',
    'source.lorebookEntry': '로어북 항목 {uid}',
    'attribution.exact': '정확',
    'attribution.derived': '파생',
    'attribution.unmatched': '미확인',
    'promptType.chat-completion': '채팅 컴플리션',
    'promptType.text-completion': '텍스트 컴플리션',
    'generation.normal': '일반 생성',
    'generation.continue': '이어쓰기',
    'generation.impersonate': '사용자 흉내',
    'generation.swipe': '스와이프',
    'generation.regenerate': '재생성',
    'generation.quiet': '백그라운드 생성',
    'generation.unknown': '생성 유형 미확인',
    'rules.summary': '치명적 {critical} · 경고 {warning} · 정보 {info}',
    'rules.cleanTitle': '명확한 규칙 충돌을 찾지 못했습니다',
    'rules.cleanDescription': '정적 검사는 의미 전체를 이해하지 못하므로 결과가 없더라도 최종 프롬프트를 직접 검토하세요.',
    'rules.severity.critical': '치명적',
    'rules.severity.warning': '경고',
    'rules.severity.info': '정보',
    'rules.contextCritical.title': '컨텍스트 한도에 매우 근접함',
    'rules.contextCritical.message': '현재 프롬프트가 사용 가능한 컨텍스트의 {usage}%를 사용합니다. 다음 생성에서 중요한 기록이 잘릴 수 있습니다.',
    'rules.contextWarning.title': '컨텍스트 사용률이 높음',
    'rules.contextWarning.message': '현재 프롬프트가 사용 가능한 컨텍스트의 {usage}%를 사용합니다.',
    'rules.duplicate.title': '여러 소스에 같은 문장이 있음',
    'rules.duplicate.message': '동일한 문장이 {count}개 소스에서 발견되어 토큰을 중복 사용하고 규칙 우선순위를 흐릴 수 있습니다.',
    'rules.repeated.title': '한 소스 안에서 문장이 반복됨',
    'rules.repeated.message': '“{source}” 안에서 동일한 문장이 {count}회 반복됩니다.',
    'rules.language.title': '응답 언어 지시가 충돌함',
    'rules.language.message': '서로 다른 응답 언어 지시가 발견되었습니다: {languages}',
    'rules.format.title': '출력 형식 지시가 충돌할 수 있음',
    'rules.format.message': '동시에 요구된 출력 형식: {formats}',
    'rules.role.title': '여러 역할 지시가 발견됨',
    'rules.role.message': '서로 다른 역할 선언이 {count}개 발견되었습니다. 의도된 역할 전환인지 확인하세요.',
    'rules.largeSource.title': '단일 소스가 프롬프트 대부분을 차지함',
    'rules.largeSource.message': '“{source}”가 {tokens}토큰으로 최종 프롬프트의 약 {share}%를 차지합니다.',
    'rules.unmatched.title': '최종 프롬프트에서 확인되지 않은 소스가 있음',
    'rules.unmatched.message': '현재 상태에서 읽은 소스 {count}개를 최종 프롬프트의 동일 문자열과 연결하지 못했습니다. 매크로·정규식·템플릿 변환 또는 비활성 상태일 수 있습니다.',
    'rules.evidence': '근거',
};

const LEGACY_SOURCE_LABELS = {
    'Character Description': 'source.characterDescription',
    'Character Personality': 'source.characterPersonality',
    Scenario: 'source.scenario',
    Persona: 'source.persona',
    "Author's Note": 'source.authorsNote',
    'Chat History': 'source.chatHistory',
    'Assistant Prefill / Last Assistant Message': 'source.assistantPrefill',
    'Final Prompt': 'source.finalPrompt',
    'Configured prompt': 'source.configuredPrompt',
};

export function t(key, variables = {}) {
    const template = KO[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? `{${name}}`));
}

export function sourceDisplayLabel(source) {
    if (source?.labelKey) {
        return t(source.labelKey, source.metadata ?? {});
    }
    const legacyKey = LEGACY_SOURCE_LABELS[source?.label];
    if (legacyKey) {
        return t(legacyKey);
    }
    const legacyLore = source?.label?.match(/^Lorebook entry (.+)$/);
    if (legacyLore) {
        return t('source.lorebookEntry', { uid: legacyLore[1] });
    }
    return source?.label ?? t('common.unknown');
}

export function attributionDisplayLabel(attribution) {
    const key = `attribution.${attribution}`;
    const translated = t(key);
    return translated === key ? (attribution ?? t('common.unknown')) : translated;
}

export function promptTypeDisplayLabel(promptType) {
    const key = `promptType.${promptType}`;
    const translated = t(key);
    return translated === key ? (promptType ?? t('common.unknown')) : translated;
}

export function generationTypeDisplayLabel(generationType) {
    const normalized = generationType || 'unknown';
    const key = `generation.${normalized}`;
    const translated = t(key);
    return translated === key ? normalized : translated;
}
