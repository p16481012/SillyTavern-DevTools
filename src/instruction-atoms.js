const INSTRUCTION_SOURCE_TYPES = new Set([
    'instruction',
    'system',
    'jailbreak',
    'extension',
    'authors_note',
    'utility',
    'requestMessage',
]);

const REFERENCE_SOURCE_TYPES = new Set([
    'character',
    'persona',
    'lorebook',
]);

const CONVERSATION_SOURCE_TYPES = new Set([
    'chat_history',
    'assistant_prefill',
]);

const TOOL_SOURCE_TYPES = new Set([
    'tool_schema',
    'tool_call',
    'tool_result',
]);

export const INSTRUCTION_MODEL_LIMITS = Object.freeze({
    atoms: 500,
    relations: 200,
    compatibleRelations: 100,
    alerts: 100,
});

const INSTRUCTION_MATCH_SCAN_MULTIPLIER = 8;
const INSTRUCTION_MATCH_SCAN_MINIMUM = 128;

const LANGUAGE_DESCRIPTORS = [
    ['한국어', 'ko', /(?:한국어|한글)(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}(?:한국어|한글)(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+korean/giu],
    ['영어', 'en', /영어(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}영어(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+english/giu],
    ['일본어', 'ja', /일본어(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}일본어(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+japanese/giu],
    ['중국어', 'zh', /중국어(?:로|으로)\s*(?:만\s*)?(?:답변|응답|작성|출력)(?:하(?:세요|라|십시오)?|해)|(?:답변|응답|출력)(?:은|을|를)?[^\n.!?。！？]{0,18}중국어(?:로|으로)|(?:respond|reply|answer|write)(?:\s+only)?\s+in\s+chinese/giu],
];

const LANGUAGE_NEGATIVE_DESCRIPTORS = [
    ['한국어', 'ko', /(?:한국어|한글)(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+korean/giu],
    ['영어', 'en', /영어(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+english/giu],
    ['일본어', 'ja', /일본어(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+japanese/giu],
    ['중국어', 'zh', /중국어(?:를|은|로|으로)?[^\n.!?。！？]{0,12}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:respond|reply|answer|write)\s+in\s+chinese/giu],
];

const FORMAT_DESCRIPTORS = [
    ['JSON', 'json', /(?:json)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력|반환)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bjson\b(?:\s+only)?/giu],
    ['XML', 'xml', /(?:xml)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력|반환)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bxml\b(?:\s+only)?/giu],
    ['Markdown', 'markdown', /(?:markdown|마크다운)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bmarkdown\b/giu],
    ['일반 텍스트', 'plain-text', /(?:일반\s*텍스트|plain\s*text)(?:\s*형식)?(?:으로|만)?[^\n.!?。！？]{0,16}(?:답변|응답|작성|출력)|(?:return|respond|reply|output|write)[^\n.!?]{0,20}\bplain\s*text\b/giu],
];

const FORMAT_NEGATIVE_DESCRIPTORS = [
    ['JSON', 'json', /json[^\n.!?。！？]{0,14}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:use|output|return)[^\n.!?]{0,12}\bjson\b/giu],
    ['XML', 'xml', /xml[^\n.!?。！？]{0,14}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:use|output|return)[^\n.!?]{0,12}\bxml\b/giu],
    ['Markdown', 'markdown', /(?:markdown|마크다운)[^\n.!?。！？]{0,14}(?:사용하지|쓰지|금지)|(?:do not|never)\s+(?:use|output|return)[^\n.!?]{0,12}\bmarkdown\b/giu],
];

const FEATURE_DESCRIPTORS = [
    {
        label: '설명',
        key: 'explanation',
        positive: /(?:설명|해설|근거)[^\n.!?。！？]{0,16}(?:포함(?!\s*하지)|제공(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:include|provide)[^\n.!?]{0,20}(?:explanation|rationale)/giu,
        negative: /(?:설명|해설|근거)[^\n.!?。！？]{0,16}(?:하지|제외|생략)|(?:no|without|do not (?:include|provide))[^\n.!?]{0,20}(?:explanation|rationale)/giu,
    },
    {
        label: '인용',
        key: 'citation',
        positive: /(?:인용|출처)[^\n.!?。！？]{0,16}(?:포함(?!\s*하지)|표시(?!\s*하지)|제공(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:include|provide|add)[^\n.!?]{0,20}(?:citation|source)/giu,
        negative: /(?:인용|출처)[^\n.!?。！？]{0,16}(?:하지|제외|생략)|(?:no|without|do not (?:include|provide|add))[^\n.!?]{0,20}(?:citation|source)/giu,
    },
    {
        label: '이모지',
        key: 'emoji',
        positive: /(?:이모지|emoji)[^\n.!?。！？]{0,12}(?:사용(?!\s*하지)|포함(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:use|include)[^\n.!?]{0,15}(?:emoji)/giu,
        negative: /(?:이모지|emoji)[^\n.!?。！？]{0,12}(?:사용\s*하지|포함\s*하지|금지|제외)|(?:no|without|do not use)[^\n.!?]{0,15}(?:emoji)/giu,
    },
    {
        label: '코드 블록',
        key: 'code-block',
        positive: /(?:코드\s*블록)[^\n.!?。！？]{0,12}(?:사용(?!\s*하지)|포함(?!\s*하지))|(?<!not )(?<!do not )(?<!without )(?:use|include)[^\n.!?]{0,18}(?:code block|fenced code)/giu,
        negative: /(?:코드\s*블록)[^\n.!?。！？]{0,12}(?:사용\s*하지|포함\s*하지|금지|제외)|(?:no|without|do not use)[^\n.!?]{0,18}(?:code block|fenced code)/giu,
    },
];

const TONE_DESCRIPTORS = [
    {
        label: '따뜻한 말투',
        axis: 'warmth',
        value: 'warm',
        pattern: /(?:따뜻(?:하게|한\s+(?:말투|어조)로)\s*(?:답변|응답|대답|작성|말하)|따뜻하고\s+안심시키는\s+(?:말투|어조)로\s*(?:답변|응답|대답|작성|말하)|(?:답변|응답|대답|말투|어조)(?:은|는|을|를)?[^\n.!?。！？]{0,10}따뜻(?:하게|한))|\b(?:respond|reply|answer|write|speak)\s+(?:(?:in|with)\s+)?(?:a\s+)?warm(?:ly|\s+(?:tone|manner|style))?|\b(?:use|adopt|keep)\s+(?:a\s+)?warm(?:\s+and\s+(?:encouraging|reassuring))?\s+(?:tone|manner|style)/giu,
    },
    {
        label: '적대적인 말투',
        axis: 'warmth',
        value: 'hostile',
        pattern: /(?:적대적(?:으로|인\s+(?:말투|어조)로)|공격적(?:으로|인\s+(?:말투|어조)로))\s*(?:답변|응답|대답|작성|말하)|(?:답변|응답|대답|말투|어조)(?:은|는|을|를)?[^\n.!?。！？]{0,10}(?:적대적|공격적)(?:으로|인)|\b(?:respond|reply|answer|write|speak)\s+(?:(?:in|with)\s+)?(?:a\s+)?(?:hostile|aggressive)(?:ly|\s+(?:tone|manner|style))?|\b(?:use|adopt|keep)\s+(?:a\s+)?(?:hostile|aggressive)\s+(?:tone|manner|style)/giu,
    },
    {
        label: '격식 있는 말투',
        axis: 'formality',
        value: 'formal',
        pattern: /(?:격식\s*있게|공식적(?:으로|인\s+(?:말투|어조)로))\s*(?:답변|응답|대답|작성|말하)|(?:답변|응답|대답|말투|어조)(?:은|는|을|를)?[^\n.!?。！？]{0,10}(?:격식\s*있게|공식적(?:으로|인))|\b(?:respond|reply|answer|write|speak)\s+(?:(?:in|with)\s+)?(?:a\s+)?formal(?:ly|\s+(?:tone|manner|style))?|\b(?:use|adopt|keep)\s+(?:a\s+)?formal\s+(?:tone|manner|style)/giu,
    },
    {
        label: '캐주얼한 말투',
        axis: 'formality',
        value: 'casual',
        pattern: /(?:캐주얼(?:하게|한\s+(?:말투|어조)로)|비격식(?:으로|적인\s+(?:말투|어조)로)|편한\s+(?:말투|어조)로)\s*(?:답변|응답|대답|작성|말하)|(?:답변|응답|대답|말투|어조)(?:은|는|을|를)?[^\n.!?。！？]{0,10}(?:캐주얼|비격식|편한)(?:하게|으로|한)|\b(?:respond|reply|answer|write|speak)\s+(?:(?:in|with)\s+)?(?:a\s+)?casual(?:ly|\s+(?:tone|manner|style))?|\b(?:use|adopt|keep)\s+(?:a\s+)?casual\s+(?:tone|manner|style)/giu,
    },
    {
        label: '공손한 말투',
        axis: 'respect',
        value: 'polite',
        pattern: /(?:공손(?:하게|한\s+(?:말투|어조)로)|정중(?:하게|한\s+(?:말투|어조)로)|존댓말(?:로|을\s*사용해?))\s*(?:답변|응답|대답|작성|말하)|(?:답변|응답|대답|말투|어조)(?:은|는|을|를)?[^\n.!?。！？]{0,10}(?:공손|정중|존댓말)(?:하게|한|로)|\b(?:respond|reply|answer|write|speak)\s+(?:(?:in|with)\s+)?(?:a\s+)?(?:polite|respectful)(?:ly|\s+(?:tone|manner|style))?|\b(?:use|adopt|keep)\s+(?:a\s+)?(?:polite|respectful)\s+(?:tone|manner|style)/giu,
    },
    {
        label: '무례한 말투',
        axis: 'respect',
        value: 'rude',
        pattern: /(?:무례(?:하게|한\s+(?:말투|어조)로)|버릇없게|반말(?:로|을\s*사용해?))\s*(?:답변|응답|대답|작성|말하)|(?:답변|응답|대답|말투|어조)(?:은|는|을|를)?[^\n.!?。！？]{0,10}(?:무례|버릇없|반말)(?:하게|한|로)|\b(?:respond|reply|answer|write|speak)\s+(?:(?:in|with)\s+)?(?:a\s+)?(?:rude|impolite)(?:ly|\s+(?:tone|manner|style))?|\b(?:use|adopt|keep)\s+(?:a\s+)?(?:rude|impolite)\s+(?:tone|manner|style)/giu,
    },
];

const EXCLUSIVE_IDENTITY_PATTERNS = [
    /\byou\s+are\s+(?:only|solely)\s+((?:an?|the)\s+[^.\n!?]{2,64}?)(?=\s+(?:when|if|provided\s+that)\b|[.!?\n]|$)/giu,
    /\bact\s+(?:only|solely)\s+as\s+((?:(?:an?|the)\s+)?[^.\n!?]{2,64}?)(?=\s+(?:when|if|provided\s+that)\b|[.!?\n]|$)/giu,
    /\bact\s+as\s+(?:only|solely)\s+((?:(?:an?|the)\s+)?[^.\n!?]{2,64}?)(?=\s+(?:when|if|provided\s+that)\b|[.!?\n]|$)/giu,
    /\b(?:your\s+)?only\s+role\s+is\s+((?:(?:an?|the)\s+)?[^.\n!?]{2,64}?)(?=\s+(?:when|if|provided\s+that)\b|[.!?\n]|$)/giu,
    /(?:너는|당신은)\s+오직\s+([^.\n!?。！？]{2,64}?)(?:이다|입니다|로만\s+행동)/gu,
    /(?:너의|당신의)\s+유일한\s+역할은\s+([^.\n!?。！？]{2,64}?)(?:이다|입니다)/gu,
];

const SAFETY_DESCRIPTORS = [
    {
        key: 'secret-disclosure',
        label: '비밀값 공개',
        value: 'disclosed',
        action: 'disclose',
        polarity: 'require',
        pattern: /(?<!do not )(?<!never )(?<!must not )\b(?:reveal|expose|disclose|share|output|print|provide)\s+(?:(?:the|all|any)\s+)?(?:secret\s+values?|secrets?|passwords?|access\s+tokens?|api\s+keys?|credentials?)(?:\s*(?:and|or|,)\s*(?:secret\s+values?|secrets?|passwords?|access\s+tokens?|api\s+keys?|credentials?)){0,2}(?:\s+(?:verbatim|unchanged|in\s+full))?|(?:비밀번호|접근\s*토큰|api\s*키|자격\s*증명|비밀(?:값|정보)?)[^\n.!?。！？]{0,40}?(?:원문\s*그대로\s*)?(?:공개|노출|출력|제공|알려)(?:하세요|하라|하십시오|해라|해)/giu,
    },
    {
        key: 'secret-disclosure',
        label: '비밀값 공개',
        value: 'disclosed',
        action: 'avoid',
        polarity: 'prohibit',
        pattern: /\b(?:(?:(?:do\s+not|don't|don’t|never|must\s+not|should\s+not|shouldn't|shouldn’t|cannot|can't|can’t)(?:[\s,]+(?:ever|directly|actually|simply|under\s+any\s+circumstances)){0,2}|refuse(?:s|d)?\s+to)[\s,]+(?:reveal|expose|disclose|share|output|print|provide)|avoid(?:s|ed)?\s+(?:revealing|exposing|disclosing|sharing|outputting|printing|providing))\s+(?:(?:the|all|any)\s+)?(?:secret\s+values?|secrets?|passwords?|access\s+tokens?|api\s+keys?|credentials?)|\b(?:redact|mask)\s+(?:every|all|any|the)\s+(?:secret\s+)?values?\b|\bkeep\s+(?:(?:the|all|any)\s+)?(?:secret\s+values?|secrets?|passwords?|access\s+tokens?|api\s+keys?|credentials?)\s+(?:secret|private|confidential)\b|(?:비밀번호|접근\s*토큰|api\s*키|자격\s*증명|비밀(?:값|정보)?)[^\n.!?。！？]{0,40}?(?:공개|노출|출력|제공|알려)(?:하지\s*마|하지\s*않|하지\s*말|말라|금지)/giu,
    },
    {
        key: 'harmful-detail',
        label: '유해 상세 안내',
        value: 'provided',
        action: 'provide',
        polarity: 'require',
        pattern: /(?<!do not )(?<!never )(?<!must not )\b(?:provide|give|explain|write)\s+(?:detailed|step-by-step|specific)\s+(?:instructions?|guidance|steps?|methods?)\s+(?:for|to)\s+(?:harmful|dangerous|illegal)\b|(?:유해|위험|불법)(?:한)?[^\n.!?。！？]{0,18}(?:상세|구체적)(?:한)?[^\n.!?。！？]{0,12}(?:안내|설명|방법|절차)(?:를|을)?\s*(?:제공|작성|설명|안내)(?:하세요|하라|하십시오|해라|해)/giu,
    },
    {
        key: 'harmful-detail',
        label: '유해 상세 안내',
        value: 'provided',
        action: 'refuse',
        polarity: 'prohibit',
        pattern: /\b(?:(?:(?:do\s+not|don't|don’t|never|must\s+not|should\s+not|shouldn't|shouldn’t|cannot|can't|can’t)(?:\s+(?:ever|directly|actually|simply)){0,2}|refuse(?:s|d)?\s+to)\s+(?:provide|give|explain|write)|avoid(?:s|ed)?\s+(?:providing|giving|explaining|writing))\s+(?:detailed|step-by-step|specific)\s+(?:instructions?|guidance|steps?|methods?)\s+(?:for|to)\s+(?:harmful|dangerous|illegal)\b|(?:유해|위험|불법)(?:한)?[^\n.!?。！？]{0,18}(?:상세|구체적)(?:한)?[^\n.!?。！？]{0,12}(?:안내|설명|방법|절차)(?:를|을)?[^\n.!?。！？]{0,8}(?:거부|제공하지|작성하지|설명하지|안내하지)/giu,
    },
];

const MEMORY_DESCRIPTORS = [
    {
        key: 'history-use',
        label: '이전 대화 사용',
        value: 'used',
        action: 'use',
        polarity: 'require',
        pattern: /(?<!do not )(?<!never )(?<!must not )\b(?:use|remember|consider|refer\s+to)\s+(?:the\s+)?(?:previous|prior|earlier)\s+(?:conversation|chat|messages?)(?:\s+when\s+answering)?|(?:이전|과거|앞선)\s*(?:대화|채팅|메시지)(?:를|을)?\s*(?:기억|참고|사용|반영)(?:하세요|하라|하십시오|해라|해)/giu,
    },
    {
        key: 'history-use',
        label: '이전 대화 사용',
        value: 'used',
        action: 'ignore',
        polarity: 'prohibit',
        pattern: /\b(?:(?:ignore|forget)|(?:(?:do\s+not|don't|don’t|never|must\s+not|should\s+not|shouldn't|shouldn’t|cannot|can't|can’t)(?:\s+(?:ever|directly|actually|simply)){0,2}|refuse(?:s|d)?\s+to)\s+(?:use|remember|consider|refer\s+to))\s+(?:the\s+)?(?:previous|prior|earlier)\s+(?:conversation|chat|messages?)(?:\s+when\s+answering)?|(?:이전|과거|앞선)\s*(?:대화|채팅|메시지)(?:를|을)?\s*(?:무시|잊|기억하지|참고하지|사용하지|반영하지)/giu,
    },
    {
        key: 'sensitive-retention',
        label: '민감정보 기억',
        value: 'retained',
        action: 'retain',
        polarity: 'require',
        pattern: /(?<!do not )(?<!never )(?<!must not )\b(?:remember|store|retain|keep)\s+(?:the\s+)?(?:passwords?|access\s+tokens?|api\s+keys?|credentials?|sensitive\s+(?:information|data)|personal\s+data)(?:\s*(?:and|or|,)\s*(?:passwords?|access\s+tokens?|api\s+keys?|credentials?)){0,2}(?:\s+in\s+memory)?|(?:민감(?:한)?\s*(?:정보|개인정보)|개인정보|비밀번호|접근\s*토큰)(?:와|과|이나|나|,|\s)*[^\n.!?。！？]{0,20}(?:기억|저장|보관)(?:하세요|하라|하십시오|해라|해)/giu,
    },
    {
        key: 'sensitive-retention',
        label: '민감정보 기억',
        value: 'retained',
        action: 'forget',
        polarity: 'prohibit',
        pattern: /\b(?:(?:(?:do\s+not|don't|don’t|never|must\s+not|should\s+not|shouldn't|shouldn’t|cannot|can't|can’t)(?:\s+(?:ever|directly|actually|simply)){0,2})\s+(?:remember|store|retain|keep|save)|(?:forget|delete|discard|erase|remove))\s+(?:the\s+)?(?:passwords?|access\s+tokens?|api\s+keys?|credentials?|sensitive\s+(?:information|data)|personal\s+data)(?:\s*(?:and|or|,)\s*(?:passwords?|access\s+tokens?|api\s+keys?|credentials?)){0,2}(?:\s+(?:in|from)\s+memory|\s+after\s+(?:the\s+)?(?:request|session|response))?|(?:민감(?:한)?\s*(?:정보|개인정보)|개인정보|비밀번호|접근\s*토큰)[^\n.!?。！？]{0,28}(?:(?:기억|저장|보관)(?:하지\s*마|하지\s*않|하지\s*말|말라|금지)|(?:삭제|폐기)(?:하세요|하라|하십시오|해라|해))/giu,
    },
];

const ROLE_PATTERNS = [
    /\b(?:you are|act as|role is)\s+([^.\n]{3,80})/giu,
    /(?:너는|당신은)\s+([^.\n]{3,80}?)(?:이다|입니다|로 행동)/gu,
    /(?:역할은|역할:)\s*([^.\n]{3,80})/gu,
];

const OVERRIDE_PATTERN = /(?:이전|앞선|위의|기존)[^\n.!?。！？]{0,20}(?:지시|규칙|명령)[^\n.!?。！？]{0,16}(?:무시|취소|덮어)|(?:ignore|disregard|override)[^\n.!?]{0,24}(?:previous|earlier|above|all)[^\n.!?]{0,16}(?:instruction|rule)/giu;

const EXAMPLE_PREFIX = /^(?:>|예(?:시)?\s*:|ex(?:ample)?\.?\s*:|e\.g\.\s*)/iu;
const EXAMPLE_CUE = /(?:예(?:시)?|인용|문구|example|quote)\s*[:：]?/iu;
const ENGLISH_CONDITION_PREFIX = /(?:^|[,;]\s*)(?:(?:only|even)\s+)?(?:if|when|provided\s+that|for)\s+([^,;.!?。！？]{1,80})\s*$/iu;
const ENGLISH_CONDITION_SUFFIX = /^\s*[,;]?\s*(?:(?:only|even)\s+)?(?:if|when|provided\s+that)\s+([^,;.!?。！？]{1,80})/iu;
const KOREAN_CONDITION_SUFFIX = /(?:^|[,;]\s*)([^,;.!?。！？]{1,80}?)(?:인\s*경우(?:에는?)?|일\s*때(?:에는?)?|이면|라면|할\s*때)\s*[.!?。！？]?\s*$/iu;
const ENGLISH_EXCEPTION_PREFIX = /(?:unless|except(?:\s+when|\s+for)?)\s+([^,;.!?。！？]{1,80})/iu;
const KOREAN_EXCEPTION_PREFIX = /예외적으로\s+([^,;.!?。！？]{1,80}?)(?:이면|라면|인\s*경우|일\s*때)/iu;
const KOREAN_EXCEPTION_SUFFIX = /([^,;.!?。！？]{1,80}?)(?:인\s*경우(?:에는?)?|일\s*때(?:에는?)?)(?:는|은)?\s*(?:제외|예외)/iu;
const ABSOLUTE_PRIORITY_PATTERN = /(?:절대|무조건|never|under no circumstances)/iu;
const HIGH_PRIORITY_PATTERN = /(?:반드시|항상|최우선|우선|must|always|only)/iu;
const NEGATION_SENSITIVE_CATEGORIES = new Set([
    'tone',
    'identity',
    'safety',
    'memory',
]);
const ENGLISH_NEGATED_DIRECTIVE_PREFIX = /(?:^|[^\p{L}])(?:(?:do\s+not|don't|don’t|never|must\s+not|should\s+not|shouldn't|shouldn’t|cannot|can't|can’t)(?:[\s,]+(?:ever|directly|actually|simply|merely|really|under\s+any\s+circumstances)){0,2}|refuse(?:s|d)?\s+to|avoid(?:s|ed)?(?:\s+using|\s+to)?)[\s,]+(?:[\p{L}\p{N}_-]+\s+){0,3}$/iu;
const KOREAN_NEGATED_DIRECTIVE_SUFFIX = /^\s*(?:(?:하지\s*(?:마(?:세요|라)?|말(?:라)?))(?![\p{L}])|하지\s*않|말라|마세요|않도록|금지|거부)/u;

function normalizedText(value) {
    return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function uniqueRanges(ranges) {
    const seen = new Set();
    return ranges
        .map(({ start, end }) => ({ start: Number(start), end: Number(end) }))
        .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
        .filter(({ start, end }) => {
            const key = `${start}:${end}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function sourceRanges(source) {
    return uniqueRanges(source?.ranges ?? []);
}

function projectLocalRange(source, start, end) {
    if (source?.synthetic) return [{ start, end }];
    const contentLength = String(source?.content ?? '').length;
    return sourceRanges(source)
        .map((range) => {
            if (
                source.attribution === 'exact'
                && contentLength > 0
                && range.end - range.start === contentLength
            ) {
                return {
                    start: Math.min(range.end, range.start + start),
                    end: Math.min(range.end, range.start + end),
                };
            }
            return range;
        })
        .filter((range) => range.end > range.start);
}

function rangeOverlaps(left, right) {
    return left.start < right.end && right.start < left.end;
}

function sentenceSegments(text) {
    const segments = [];
    const pattern = /[^.!?。！？\n]+(?:[.!?。！？]+|$)/gu;
    for (const match of text.matchAll(pattern)) {
        const raw = match[0];
        const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
        const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
        const start = match.index + leading;
        const end = match.index + raw.length - trailing;
        if (end <= start) continue;
        segments.push({ start, end, text: text.slice(start, end) });
    }
    return segments;
}

function excludedExampleRanges(text) {
    const ranges = [];
    const fenced = /```[\s\S]*?(?:```|$)/gu;
    for (const match of text.matchAll(fenced)) {
        ranges.push({
            start: match.index,
            end: match.index + match[0].length,
            reason: 'fenced-example',
        });
    }
    let cursor = 0;
    for (const line of text.split('\n')) {
        const trimmed = line.trimStart();
        if (EXAMPLE_PREFIX.test(trimmed)) {
            ranges.push({
                start: cursor,
                end: cursor + line.length,
                reason: 'example-line',
            });
        }
        cursor += line.length + 1;
    }
    return ranges;
}

function segmentAt(segments, offset) {
    return segments.find(({ start, end }) => offset >= start && offset < end) ?? null;
}

function isQuotedExample(text, start, end, segment) {
    if (!segment || !EXAMPLE_CUE.test(segment.text)) return false;
    const before = text.slice(segment.start, start);
    const after = text.slice(end, segment.end);
    const quotePairs = [
        ['"', '"'],
        ["'", "'"],
        ['“', '”'],
        ['‘', '’'],
        ['「', '」'],
    ];
    return quotePairs.some(([open, close]) => (
        before.lastIndexOf(open) > before.lastIndexOf(close)
        && after.indexOf(close) >= 0
    ));
}

function normalizedApplicabilityText(value) {
    return normalizedText(value)
        .normalize('NFKC')
        .toLowerCase()
        .replace(/^[,;:\s]+|[,;:\s]+$/gu, '')
        .replace(/\s+/gu, ' ');
}

function applicabilityPredicate(value) {
    const normalized = normalizedApplicabilityText(value);
    if (!normalized || normalized.length > 96) return null;
    if (/(?:\band\b|\bor\b|&&|\|\||그리고|또는|거나)/iu.test(normalized)) {
        return Object.freeze({
            kind: 'compound',
            key: normalized,
            value: null,
            signature: `compound:${normalized}`,
        });
    }
    const englishEquality = normalized.match(
        /^(.{1,64}?)\s+(?:is|equals?|=|==)\s+([^\s,;]{1,32})$/iu,
    );
    if (englishEquality) {
        const key = normalizedApplicabilityText(englishEquality[1]);
        const equalityValue = normalizedApplicabilityText(englishEquality[2]);
        return Object.freeze({
            kind: 'equality',
            key,
            value: equalityValue,
            signature: `eq:${key}:${equalityValue}`,
        });
    }
    const koreanEquality = normalized.match(
        /^(.{1,64}?)(?:이|가|은|는)\s+([^\s,;]{1,32})$/u,
    );
    if (koreanEquality) {
        const key = normalizedApplicabilityText(koreanEquality[1]);
        const equalityValue = normalizedApplicabilityText(koreanEquality[2]);
        return Object.freeze({
            kind: 'equality',
            key,
            value: equalityValue,
            signature: `eq:${key}:${equalityValue}`,
        });
    }
    return Object.freeze({
        kind: 'clause',
        key: normalized,
        value: null,
        signature: `clause:${normalized}`,
    });
}

function contextMatch(pattern, value) {
    const match = String(value ?? '').match(pattern);
    if (!match) return null;
    const text = normalizedText(match[0]).replace(/^[,;]\s*/u, '');
    const clause = normalizedText(match[1]);
    if (!text || !clause) return null;
    return {
        text,
        predicate: applicabilityPredicate(clause),
    };
}

function extractInstructionApplicability(segment, atomStart, atomEnd) {
    if (!segment) {
        return {
            condition: null,
            conditionPredicate: null,
            exception: null,
            exceptionPredicate: null,
        };
    }
    const localStart = Math.max(0, atomStart - segment.start);
    const localEnd = Math.max(localStart, atomEnd - segment.start);
    const before = segment.text.slice(0, localStart);
    const after = segment.text.slice(localEnd);
    const applicabilityPrefix = before.replace(
        /(?:반드시|항상|절대|무조건|only|always|must|never)\s*$/iu,
        '',
    );
    const conditionMatch = contextMatch(
        ENGLISH_CONDITION_PREFIX,
        applicabilityPrefix,
    ) ?? contextMatch(KOREAN_CONDITION_SUFFIX, applicabilityPrefix)
        ?? contextMatch(ENGLISH_CONDITION_SUFFIX, after)
        ?? contextMatch(KOREAN_CONDITION_SUFFIX, after);
    const exceptionMatch = contextMatch(ENGLISH_EXCEPTION_PREFIX, applicabilityPrefix)
        ?? contextMatch(KOREAN_EXCEPTION_PREFIX, applicabilityPrefix)
        ?? contextMatch(ENGLISH_EXCEPTION_PREFIX, after)
        ?? contextMatch(KOREAN_EXCEPTION_SUFFIX, after);
    return {
        condition: conditionMatch?.text ?? null,
        conditionPredicate: conditionMatch?.predicate ?? null,
        exception: exceptionMatch?.text ?? null,
        exceptionPredicate: exceptionMatch?.predicate ?? null,
    };
}

function instructionPriority(text) {
    if (ABSOLUTE_PRIORITY_PATTERN.test(text)) return 'absolute';
    if (HIGH_PRIORITY_PATTERN.test(text)) return 'high';
    return 'normal';
}

function sourceContext(source) {
    return {
        role: source?.metadata?.role ?? (
            source?.type === 'system' || source?.type === 'jailbreak'
                ? 'system'
                : null
        ),
        position: source?.metadata?.position
            ?? source?.metadata?.promptOrder
            ?? null,
        depth: source?.metadata?.depth ?? null,
    };
}

function participantScopeForSource(source) {
    const type = source?.type ?? 'unknown';
    if (type === 'character') return 'character-profile';
    if (type === 'persona') return 'user-profile';
    if (type === 'lorebook') return 'shared-context';
    if (INSTRUCTION_SOURCE_TYPES.has(type)) return 'assistant-response';
    if (source?.synthetic || type === 'synthetic') return 'assistant-response';
    return 'unknown';
}

export function classifyInstructionCapability(source) {
    const type = source?.type ?? 'unknown';
    if (source?.synthetic) {
        return {
            kind: 'aggregate-fallback',
            extractsAtoms: true,
            comparesAtoms: true,
            atomStatus: 'candidate',
            reason: 'final-text-fallback',
        };
    }
    if (type === 'final') {
        return {
            kind: 'aggregate',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'aggregate-output',
        };
    }
    if (CONVERSATION_SOURCE_TYPES.has(type)) {
        return {
            kind: 'conversation',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'conversation-output',
        };
    }
    if (TOOL_SOURCE_TYPES.has(type)) {
        return {
            kind: 'tool-data',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'tool-structure',
        };
    }
    if (type === 'multimodal') {
        return {
            kind: 'multimodal-placeholder',
            extractsAtoms: false,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'multimodal-placeholder',
        };
    }
    if (INSTRUCTION_SOURCE_TYPES.has(type)) {
        return {
            kind: 'instruction',
            extractsAtoms: true,
            comparesAtoms: true,
            atomStatus: 'confirmed',
            reason: null,
        };
    }
    if (REFERENCE_SOURCE_TYPES.has(type)) {
        return {
            kind: 'reference',
            extractsAtoms: true,
            comparesAtoms: false,
            atomStatus: 'insufficient-evidence',
            reason: 'reference-data',
        };
    }
    return {
        kind: 'mixed',
        extractsAtoms: true,
        comparesAtoms: false,
        atomStatus: 'insufficient-evidence',
        reason: 'unknown-source-capability',
    };
}

function atomId(
    source,
    participantScope,
    category,
    property,
    value,
    start,
    end,
    polarity,
) {
    return [
        'atom',
        source.id,
        participantScope,
        category,
        property,
        value,
        polarity,
        start,
        end,
    ].join(':');
}

function createAtom(source, capability, descriptor, match, segments) {
    const segment = segmentAt(segments, match.start);
    const applicability = extractInstructionApplicability(
        segment,
        match.start,
        match.end,
    );
    const {
        condition,
        conditionPredicate,
        exception,
        exceptionPredicate,
    } = applicability;
    let status = capability.atomStatus;
    if (status === 'confirmed' && (condition || exception || descriptor.category === 'role')) {
        status = 'candidate';
    }
    const context = sourceContext(source);
    const participantScope = participantScopeForSource(source);
    const confidencePenalty = condition || exception ? 0.08 : 0;
    const confidence = Math.max(
        0,
        Math.min(1, Number((descriptor.confidence - confidencePenalty).toFixed(2))),
    );
    const localRange = { start: match.start, end: match.end };
    return {
        id: atomId(
            source,
            participantScope,
            descriptor.category,
            descriptor.property,
            descriptor.value,
            match.start,
            match.end,
            descriptor.polarity,
        ),
        category: descriptor.category,
        target: descriptor.target,
        action: descriptor.action,
        property: descriptor.property,
        value: descriptor.value,
        valueLabel: descriptor.valueLabel,
        polarity: descriptor.polarity,
        scope: descriptor.scope,
        participantScope,
        condition,
        conditionPredicate,
        exception,
        exceptionPredicate,
        priority: instructionPriority(segment?.text ?? match.text),
        status,
        sourceId: source.id,
        sourceLabel: source.label ?? source.id,
        sourceType: source.type ?? 'unknown',
        sourceRole: context.role,
        position: context.position,
        depth: context.depth,
        text: match.text,
        localRange,
        finalRanges: projectLocalRange(source, match.start, match.end),
        rangeMethod: source.attribution === 'exact'
            ? 'exact-offset'
            : sourceRanges(source).length > 0
                ? 'source-range'
                : 'local-only',
        method: descriptor.method,
        confidence,
        capability: capability.kind,
    };
}

function categoryEnabledForExtraction(context, category) {
    return !context.categoryEnabled || context.categoryEnabled(category);
}

function consumeMatchBudget(context) {
    if (context.remainingAtoms <= 0 || context.scanBudget <= 0) {
        context.truncated = true;
        return false;
    }
    context.scanBudget -= 1;
    return true;
}

function recordExtractionExclusion(context, source, range, reason, text) {
    context.exclusions.push({
        sourceId: source.id,
        localRange: range,
        reason,
        text,
    });
}

function negatedRequireMatch(context, descriptor, match) {
    if (
        descriptor.polarity !== 'require'
        || !NEGATION_SENSITIVE_CATEGORIES.has(descriptor.category)
    ) {
        return false;
    }
    const segment = segmentAt(context.segments, match.start);
    if (!segment) return false;
    const before = context.text.slice(segment.start, match.start);
    const after = context.text.slice(match.end, segment.end);
    return ENGLISH_NEGATED_DIRECTIVE_PREFIX.test(before)
        || KOREAN_NEGATED_DIRECTIVE_SUFFIX.test(after);
}

function extractPatternAtoms(source, capability, descriptor, context) {
    const atoms = [];
    if (!categoryEnabledForExtraction(context, descriptor.category)) return atoms;
    descriptor.pattern.lastIndex = 0;
    for (const rawMatch of context.text.matchAll(descriptor.pattern)) {
        if (!consumeMatchBudget(context)) break;
        const match = {
            start: rawMatch.index,
            end: rawMatch.index + rawMatch[0].length,
            text: rawMatch[0],
        };
        const range = { start: match.start, end: match.end };
        const excluded = context.excluded.find((item) => rangeOverlaps(range, item));
        if (excluded || isQuotedExample(
            context.text,
            match.start,
            match.end,
            segmentAt(context.segments, match.start),
        )) {
            recordExtractionExclusion(
                context,
                source,
                range,
                excluded?.reason ?? 'quoted-example',
                match.text,
            );
            continue;
        }
        if (negatedRequireMatch(context, descriptor, match)) {
            recordExtractionExclusion(
                context,
                source,
                range,
                'negated-directive',
                match.text,
            );
            continue;
        }
        atoms.push(createAtom(source, capability, descriptor, match, context.segments));
        context.remainingAtoms -= 1;
    }
    return atoms;
}

function extractRoleAtoms(source, capability, context) {
    const atoms = [];
    if (!categoryEnabledForExtraction(context, 'role')) return atoms;
    for (const pattern of ROLE_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of context.text.matchAll(pattern)) {
            if (!consumeMatchBudget(context)) return atoms;
            const value = normalizedText(match[1]).toLowerCase();
            if (!value) continue;
            const range = { start: match.index, end: match.index + match[0].length };
            const excluded = context.excluded.find((item) => rangeOverlaps(range, item));
            if (excluded || isQuotedExample(
                context.text,
                range.start,
                range.end,
                segmentAt(context.segments, range.start),
            )) {
                recordExtractionExclusion(
                    context,
                    source,
                    range,
                    excluded?.reason ?? 'quoted-example',
                    match[0],
                );
                continue;
            }
            atoms.push(createAtom(source, capability, {
                category: 'role',
                target: 'assistant',
                action: 'act-as',
                property: 'assistant.role',
                value,
                valueLabel: value,
                polarity: 'require',
                scope: 'identity',
                method: 'pattern:role-declaration',
                confidence: 0.74,
            }, {
                start: range.start,
                end: range.end,
                text: match[0],
            }, context.segments));
            context.remainingAtoms -= 1;
        }
    }
    return atoms;
}

function normalizedExclusiveIdentity(value) {
    return normalizedText(value)
        .toLowerCase()
        .replace(/^(?:a|an|the)\s+/iu, '')
        .replace(/\s+(?:only|solely)$/iu, '')
        .trim();
}

function extractExclusiveIdentityAtoms(source, capability, context) {
    const atoms = [];
    if (!categoryEnabledForExtraction(context, 'identity')) return atoms;
    const descriptor = {
        category: 'identity',
        target: 'assistant',
        action: 'act-as',
        property: 'assistant.identity.exclusive',
        polarity: 'require',
        scope: 'identity',
        method: 'pattern:identity:exclusive-role',
        confidence: 0.97,
    };
    for (const pattern of EXCLUSIVE_IDENTITY_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of context.text.matchAll(pattern)) {
            if (!consumeMatchBudget(context)) return atoms;
            const value = normalizedExclusiveIdentity(match[1]);
            if (!value) continue;
            const range = { start: match.index, end: match.index + match[0].length };
            const excluded = context.excluded.find((item) => rangeOverlaps(range, item));
            if (excluded || isQuotedExample(
                context.text,
                range.start,
                range.end,
                segmentAt(context.segments, range.start),
            )) {
                recordExtractionExclusion(
                    context,
                    source,
                    range,
                    excluded?.reason ?? 'quoted-example',
                    match[0],
                );
                continue;
            }
            const boundedMatch = {
                start: range.start,
                end: range.end,
                text: match[0],
            };
            if (negatedRequireMatch(context, descriptor, boundedMatch)) {
                recordExtractionExclusion(
                    context,
                    source,
                    range,
                    'negated-directive',
                    match[0],
                );
                continue;
            }
            atoms.push(createAtom(source, capability, {
                ...descriptor,
                value,
                valueLabel: value,
            }, {
                start: range.start,
                end: range.end,
                text: match[0],
            }, context.segments));
            context.remainingAtoms -= 1;
        }
    }
    return atoms;
}

function extractSourceAtoms(
    source,
    capability,
    maximumAtoms = INSTRUCTION_MODEL_LIMITS.atoms,
    categoryEnabled = null,
) {
    const text = String(source?.content ?? '');
    const exclusions = [];
    const context = {
        text,
        segments: sentenceSegments(text),
        excluded: excludedExampleRanges(text),
        exclusions,
        categoryEnabled,
        remainingAtoms: Math.max(0, maximumAtoms),
        scanBudget: Math.max(
            INSTRUCTION_MATCH_SCAN_MINIMUM,
            Math.max(0, maximumAtoms) * INSTRUCTION_MATCH_SCAN_MULTIPLIER,
        ),
        truncated: false,
    };
    const atoms = [];

    for (const [valueLabel, value, pattern] of LANGUAGE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'language',
            target: 'response',
            action: 'set',
            property: 'response.language',
            value,
            valueLabel,
            polarity: 'require',
            scope: 'output',
            method: `pattern:language:${value}`,
            confidence: 0.98,
            pattern,
        }, context));
    }
    for (const [valueLabel, value, pattern] of LANGUAGE_NEGATIVE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'language',
            target: 'response',
            action: 'avoid',
            property: 'response.language',
            value,
            valueLabel,
            polarity: 'prohibit',
            scope: 'output',
            method: `pattern:language-negative:${value}`,
            confidence: 0.94,
            pattern,
        }, context));
    }
    for (const [valueLabel, value, pattern] of FORMAT_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'format',
            target: 'response',
            action: 'set',
            property: 'response.format',
            value,
            valueLabel,
            polarity: 'require',
            scope: 'output',
            method: `pattern:format:${value}`,
            confidence: 0.96,
            pattern,
        }, context));
    }
    for (const [valueLabel, value, pattern] of FORMAT_NEGATIVE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'format',
            target: 'response',
            action: 'avoid',
            property: 'response.format',
            value,
            valueLabel,
            polarity: 'prohibit',
            scope: 'output',
            method: `pattern:format-negative:${value}`,
            confidence: 0.92,
            pattern,
        }, context));
    }
    for (const feature of FEATURE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'directives',
            target: 'response',
            action: 'include',
            property: `response.include.${feature.key}`,
            value: 'included',
            valueLabel: feature.label,
            polarity: 'require',
            scope: 'output',
            method: `pattern:directive:${feature.key}:positive`,
            confidence: 0.95,
            pattern: feature.positive,
        }, context));
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'directives',
            target: 'response',
            action: 'exclude',
            property: `response.include.${feature.key}`,
            value: 'included',
            valueLabel: feature.label,
            polarity: 'prohibit',
            scope: 'output',
            method: `pattern:directive:${feature.key}:negative`,
            confidence: 0.95,
            pattern: feature.negative,
        }, context));
    }
    for (const tone of TONE_DESCRIPTORS) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'tone',
            target: 'response',
            action: 'set-tone',
            property: `response.tone.${tone.axis}`,
            value: tone.value,
            valueLabel: tone.label,
            polarity: 'require',
            scope: 'style',
            method: `pattern:tone:${tone.axis}:${tone.value}`,
            confidence: 0.92,
            pattern: tone.pattern,
        }, context));
    }
    for (const descriptor of [
        ...SAFETY_DESCRIPTORS.filter(({ polarity }) => polarity === 'prohibit'),
        ...SAFETY_DESCRIPTORS.filter(({ polarity }) => polarity !== 'prohibit'),
    ]) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'safety',
            target: 'response',
            action: descriptor.action,
            property: `response.safety.${descriptor.key}`,
            value: descriptor.value,
            valueLabel: descriptor.label,
            polarity: descriptor.polarity,
            scope: 'safety',
            method: `pattern:safety:${descriptor.key}:${descriptor.polarity}`,
            confidence: 0.94,
            pattern: descriptor.pattern,
        }, context));
    }
    for (const descriptor of [
        ...MEMORY_DESCRIPTORS.filter(({ polarity }) => polarity === 'prohibit'),
        ...MEMORY_DESCRIPTORS.filter(({ polarity }) => polarity !== 'prohibit'),
    ]) {
        atoms.push(...extractPatternAtoms(source, capability, {
            category: 'memory',
            target: 'conversation-memory',
            action: descriptor.action,
            property: `memory.${descriptor.key}`,
            value: descriptor.value,
            valueLabel: descriptor.label,
            polarity: descriptor.polarity,
            scope: 'memory',
            method: `pattern:memory:${descriptor.key}:${descriptor.polarity}`,
            confidence: 0.94,
            pattern: descriptor.pattern,
        }, context));
    }
    const identityAtoms = extractExclusiveIdentityAtoms(source, capability, context);
    atoms.push(...identityAtoms);
    atoms.push(...extractRoleAtoms(source, capability, context).filter((roleAtom) => (
        !identityAtoms.some((identityAtom) => rangeOverlaps(
            roleAtom.localRange,
            identityAtom.localRange,
        ))
    )));
    atoms.push(...extractPatternAtoms(source, capability, {
        category: 'priority',
        target: 'instruction-set',
        action: 'override',
        property: 'instruction.priority',
        value: 'previous',
        valueLabel: '이전 지시',
        polarity: 'override',
        scope: 'all',
        method: 'pattern:priority-override',
        confidence: 0.99,
        pattern: OVERRIDE_PATTERN,
    }, context));

    const deduplicated = new Map();
    for (const atom of atoms) {
        const key = [
            atom.participantScope,
            atom.category,
            atom.property,
            atom.value,
            atom.polarity,
            atom.localRange.start,
            atom.localRange.end,
        ].join(':');
        const previous = deduplicated.get(key);
        if (!previous || atom.confidence > previous.confidence) deduplicated.set(key, atom);
    }
    return {
        atoms: [...deduplicated.values()].sort(
            (left, right) => left.localRange.start - right.localRange.start,
        ),
        exclusions,
        truncated: context.truncated,
    };
}

function formatsConflict(left, right) {
    const pair = new Set([left, right]);
    return (pair.has('json') && pair.has('xml'))
        || (pair.has('markdown') && pair.has('plain-text'));
}

function normalizedRoleTokens(value) {
    const ignored = new Set([
        'a',
        'an',
        'the',
        'helpful',
        'friendly',
        'assistant',
        'ai',
        '친절한',
        '유능한',
        '도우미',
    ]);
    return new Set(normalizedText(value)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token && !ignored.has(token)));
}

function rolesCompatible(left, right) {
    if (left === right || left.includes(right) || right.includes(left)) return true;
    const leftTokens = normalizedRoleTokens(left);
    const rightTokens = normalizedRoleTokens(right);
    if (leftTokens.size === 0 || rightTokens.size === 0) return true;
    const leftOnly = [...leftTokens].filter((token) => !rightTokens.has(token));
    const rightOnly = [...rightTokens].filter((token) => !leftTokens.has(token));
    return leftOnly.length === 0 || rightOnly.length === 0;
}

function atomsConflict(left, right) {
    if (
        left.participantScope === 'unknown'
        || right.participantScope === 'unknown'
        || left.participantScope !== right.participantScope
    ) {
        return null;
    }
    if (left.target !== right.target || left.property !== right.property) return null;
    if (left.category === 'priority' || right.category === 'priority') return null;
    if (left.value === right.value && left.polarity !== right.polarity) {
        return 'opposite-polarity';
    }
    if (left.polarity !== 'require' || right.polarity !== 'require') return null;
    if (left.category === 'language' && left.value !== right.value) {
        return 'alternative-values';
    }
    if (left.category === 'tone' && left.value !== right.value) {
        return 'alternative-values';
    }
    if (left.category === 'identity' && left.value !== right.value) {
        return 'exclusive-identity';
    }
    if (
        left.category === 'format'
        && left.value !== right.value
        && formatsConflict(left.value, right.value)
    ) {
        return 'alternative-values';
    }
    if (
        left.category === 'role'
        && left.value !== right.value
        && !rolesCompatible(left.value, right.value)
    ) {
        return 'role-overlap';
    }
    return null;
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function predicatesEqual(left, right) {
    return Boolean(
        left?.signature
        && right?.signature
        && left.signature === right.signature
    );
}

function predicatesMutuallyExclusive(left, right) {
    return Boolean(
        left?.kind === 'equality'
        && right?.kind === 'equality'
        && left.key === right.key
        && left.value !== right.value
    );
}

function compareApplicability(left, right) {
    const leftCondition = left.conditionPredicate;
    const rightCondition = right.conditionPredicate;
    const leftException = left.exceptionPredicate;
    const rightException = right.exceptionPredicate;

    if (
        (predicatesEqual(leftException, rightCondition) && !leftCondition)
        || (predicatesEqual(rightException, leftCondition) && !rightCondition)
    ) {
        return {
            applicabilityKind: 'exception-specialization',
            disposition: 'compatible',
        };
    }
    if (leftCondition && rightCondition) {
        if (predicatesEqual(leftCondition, rightCondition)) {
            const sameExceptions = (
                (!leftException && !rightException)
                || predicatesEqual(leftException, rightException)
            );
            return {
                applicabilityKind: sameExceptions
                    ? 'same-predicate-overlap'
                    : 'unknown-overlap',
                disposition: 'conflict',
            };
        }
        if (predicatesMutuallyExclusive(leftCondition, rightCondition)) {
            return {
                applicabilityKind: 'mutually-exclusive',
                disposition: 'compatible',
            };
        }
        return {
            applicabilityKind: 'unknown-overlap',
            disposition: 'conflict',
        };
    }
    if (leftCondition || rightCondition) {
        return {
            applicabilityKind: 'subset-overlap',
            disposition: 'conflict',
        };
    }
    if (leftException || rightException) {
        return {
            applicabilityKind: predicatesEqual(leftException, rightException)
                ? 'same-predicate-overlap'
                : 'unknown-overlap',
            disposition: 'conflict',
        };
    }
    return {
        applicabilityKind: 'unconditional-overlap',
        disposition: 'conflict',
    };
}

function relationStatus(left, right, applicability) {
    if (left.category === 'role' || right.category === 'role') {
        return 'insufficient-evidence';
    }
    if (
        left.status === 'insufficient-evidence'
        || right.status === 'insufficient-evidence'
    ) {
        return 'insufficient-evidence';
    }
    if (applicability.disposition === 'compatible') {
        return ['mutually-exclusive', 'exception-specialization'].includes(
            applicability.applicabilityKind,
        )
            ? 'confirmed'
            : 'candidate';
    }
    if (
        applicability.applicabilityKind === 'same-predicate-overlap'
        && left.capability === 'instruction'
        && right.capability === 'instruction'
    ) {
        return 'confirmed';
    }
    if (
        left.status === 'candidate'
        || right.status === 'candidate'
        || left.condition
        || right.condition
        || left.exception
        || right.exception
    ) {
        return 'candidate';
    }
    return 'confirmed';
}

function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
}

function createRelations(atoms, capabilities, compareSources, categoryEnabled) {
    const capabilityBySource = new Map(
        capabilities.map((capability) => [capability.sourceId, capability]),
    );
    const semanticAtoms = [...new Map(atoms.map((atom) => [[
        atom.sourceId,
        atom.participantScope,
        atom.category,
        atom.property,
        atom.value,
        atom.polarity,
        atom.condition ?? '',
        atom.exception ?? '',
    ].join('|'), atom])).values()];
    const relations = [];
    const compatibilityRelations = [];
    let relationsTruncated = false;
    let compatibilityRelationsTruncated = false;
    relationPairs:
    for (let leftIndex = 0; leftIndex < semanticAtoms.length; leftIndex += 1) {
        for (
            let rightIndex = leftIndex + 1;
            rightIndex < semanticAtoms.length;
            rightIndex += 1
        ) {
            const left = semanticAtoms[leftIndex];
            const right = semanticAtoms[rightIndex];
            const kind = atomsConflict(left, right);
            if (!kind) continue;
            if (categoryEnabled && !categoryEnabled(left.category)) continue;
            const leftCapability = capabilityBySource.get(left.sourceId);
            const rightCapability = capabilityBySource.get(right.sourceId);
            if (!leftCapability?.comparesAtoms || !rightCapability?.comparesAtoms) continue;
            if (
                left.sourceId !== right.sourceId
                && compareSources
                && !compareSources(leftCapability.source, rightCapability.source, left.category)
            ) {
                continue;
            }
            const atomIds = [left.id, right.id].sort();
            const applicability = compareApplicability(left, right);
            const status = relationStatus(left, right, applicability);
            const applicabilitySignatures = [left, right]
                .map((atom) => [
                    atom.id,
                    atom.conditionPredicate?.signature ?? '',
                    atom.exceptionPredicate?.signature ?? '',
                ].join('|'))
                .sort();
            const relationKey = [
                left.participantScope,
                left.category,
                kind,
                applicability.applicabilityKind,
                applicability.disposition,
                atomIds.join('|'),
                applicabilitySignatures.join('|'),
            ].join(':');
            const relation = {
                id: `relation:${left.category}:${hashString(relationKey)}`,
                category: left.category,
                kind,
                participantScope: left.participantScope,
                applicabilityKind: applicability.applicabilityKind,
                disposition: applicability.disposition,
                status,
                atomIds,
                sourceIds: uniqueStrings([left.sourceId, right.sourceId]),
                finalRanges: uniqueRanges([...left.finalRanges, ...right.finalRanges]),
                localEvidence: [
                    {
                        atomId: left.id,
                        sourceId: left.sourceId,
                        sourceLabel: left.sourceLabel,
                        text: left.text,
                        localRange: left.localRange,
                    },
                    {
                        atomId: right.id,
                        sourceId: right.sourceId,
                        sourceLabel: right.sourceLabel,
                        text: right.text,
                        localRange: right.localRange,
                    },
                ],
                conditions: uniqueStrings([left.condition, right.condition]),
                exceptions: uniqueStrings([left.exception, right.exception]),
                method: 'instruction-atom-pair',
                confidence: Number(Math.min(left.confidence, right.confidence).toFixed(2)),
                clusterId: null,
            };
            if (applicability.disposition === 'compatible') {
                if (
                    compatibilityRelations.length
                    < INSTRUCTION_MODEL_LIMITS.compatibleRelations
                ) {
                    compatibilityRelations.push(relation);
                } else {
                    compatibilityRelationsTruncated = true;
                }
            } else if (relations.length < INSTRUCTION_MODEL_LIMITS.relations) {
                relations.push(relation);
            } else {
                relationsTruncated = true;
            }
            if (
                relationsTruncated
                && compatibilityRelationsTruncated
            ) {
                break relationPairs;
            }
        }
    }
    return {
        relations,
        compatibilityRelations,
        relationsTruncated,
        compatibilityRelationsTruncated,
    };
}

function buildClusters(relations) {
    const clusters = [];
    const remaining = new Set(relations.map(({ id }) => id));
    const relationById = new Map(relations.map((relation) => [relation.id, relation]));
    while (remaining.size > 0) {
        const seedId = remaining.values().next().value;
        const queue = [seedId];
        const selectedRelations = [];
        const atomIds = new Set();
        const category = relationById.get(seedId)?.category;
        while (queue.length > 0) {
            const relationId = queue.shift();
            if (!remaining.has(relationId)) continue;
            const relation = relationById.get(relationId);
            if (!relation || relation.category !== category) continue;
            remaining.delete(relationId);
            selectedRelations.push(relation);
            relation.atomIds.forEach((atomId) => atomIds.add(atomId));
            for (const candidateId of remaining) {
                const candidate = relationById.get(candidateId);
                if (
                    candidate?.category === category
                    && candidate.atomIds.some((atomId) => atomIds.has(atomId))
                ) {
                    queue.push(candidateId);
                }
            }
        }
        const relationIds = selectedRelations.map(({ id }) => id).sort();
        const clusterId = `cluster:${category}:${hashString(relationIds.join('|'))}`;
        const statuses = new Set(selectedRelations.map(({ status }) => status));
        const status = statuses.has('confirmed')
            ? 'confirmed'
            : statuses.has('candidate')
                ? 'candidate'
                : 'insufficient-evidence';
        const cluster = {
            id: clusterId,
            category,
            status,
            relationIds,
            atomIds: [...atomIds],
            sourceIds: uniqueStrings(selectedRelations.flatMap(({ sourceIds }) => sourceIds)),
            finalRanges: uniqueRanges(
                selectedRelations.flatMap(({ finalRanges }) => finalRanges),
            ),
            confidence: selectedRelations.length
                ? Number(Math.min(
                    ...selectedRelations.map(({ confidence }) => confidence),
                ).toFixed(2))
                : 0,
        };
        selectedRelations.forEach((relation) => {
            relation.clusterId = clusterId;
        });
        clusters.push(cluster);
    }
    return clusters;
}

export function buildInstructionModel(
    sources,
    {
        activeSourceIds = null,
        compareSources = null,
        categoryEnabled = null,
    } = {},
) {
    const active = activeSourceIds instanceof Set
        ? activeSourceIds
        : new Set((sources ?? []).map(({ id }) => id));
    const capabilities = [];
    const atoms = [];
    const exclusions = [];
    let atomsTruncated = false;

    for (const source of Array.isArray(sources) ? sources : []) {
        const classified = classifyInstructionCapability(source);
        const capability = {
            sourceId: source.id,
            sourceLabel: source.label ?? source.id,
            sourceType: source.type ?? 'unknown',
            active: active.has(source.id),
            ...classified,
            source,
        };
        capabilities.push(capability);
        if (!capability.active || !capability.extractsAtoms) continue;
        if (atoms.length >= INSTRUCTION_MODEL_LIMITS.atoms) {
            atomsTruncated = true;
            continue;
        }
        const remaining = INSTRUCTION_MODEL_LIMITS.atoms - atoms.length;
        const extracted = extractSourceAtoms(
            source,
            capability,
            remaining,
            categoryEnabled,
        );
        const enabledAtoms = categoryEnabled
            ? extracted.atoms.filter((atom) => categoryEnabled(atom.category))
            : extracted.atoms;
        if (remaining > 0) {
            atoms.push(...enabledAtoms.slice(0, remaining));
        }
        if (enabledAtoms.length > remaining || extracted.truncated) atomsTruncated = true;
        exclusions.push(...extracted.exclusions);
    }

    const relationResult = createRelations(
        atoms,
        capabilities,
        compareSources,
        categoryEnabled,
    );
    const { relations, compatibilityRelations } = relationResult;
    const clusters = buildClusters(relations);
    const allPriorityAlerts = atoms
        .filter((atom) => atom.category === 'priority' && atom.action === 'override')
        .filter(() => !categoryEnabled || categoryEnabled('priority'))
        .filter((atom) => {
            const capability = capabilities.find(
                ({ sourceId }) => sourceId === atom.sourceId,
            );
            return capability?.comparesAtoms;
        })
        .map((atom) => ({
            id: `alert:priority:${hashString(atom.id)}`,
            category: 'priority',
            status: atom.status,
            atomIds: [atom.id],
            sourceIds: [atom.sourceId],
            finalRanges: atom.finalRanges,
            localEvidence: [{
                atomId: atom.id,
                sourceId: atom.sourceId,
                sourceLabel: atom.sourceLabel,
                text: atom.text,
                localRange: atom.localRange,
            }],
            method: 'instruction-atom-single',
            confidence: atom.confidence,
            clusterId: null,
        }));
    const priorityAlerts = allPriorityAlerts.slice(0, INSTRUCTION_MODEL_LIMITS.alerts);

    return {
        version: 3,
        capabilities: capabilities.map(({ source, ...capability }) => capability),
        atoms,
        relations,
        compatibilityRelations,
        clusters,
        alerts: priorityAlerts,
        exclusions,
        limits: INSTRUCTION_MODEL_LIMITS,
        stats: {
            activeSources: capabilities.filter(({ active }) => active).length,
            instructionSources: capabilities.filter(
                ({ active: isActive, comparesAtoms }) => isActive && comparesAtoms,
            ).length,
            referenceSources: capabilities.filter(
                ({ active: isActive, kind }) => isActive && kind === 'reference',
            ).length,
            excludedSources: capabilities.filter(
                ({ active: isActive, extractsAtoms }) => !isActive || !extractsAtoms,
            ).length,
            atoms: atoms.length,
            confirmedAtoms: atoms.filter(({ status }) => status === 'confirmed').length,
            candidateAtoms: atoms.filter(({ status }) => status === 'candidate').length,
            insufficientAtoms: atoms.filter(
                ({ status }) => status === 'insufficient-evidence',
            ).length,
            conflictRelations: relations.length,
            compatibleRelations: compatibilityRelations.length,
            confirmedRelations: relations.filter(
                ({ status }) => status === 'confirmed',
            ).length,
            candidateRelations: relations.filter(
                ({ status }) => status === 'candidate',
            ).length,
            insufficientRelations: relations.filter(
                ({ status }) => status === 'insufficient-evidence',
            ).length,
            atomsTruncated,
            relationsTruncated: relationResult.relationsTruncated,
            compatibilityRelationsTruncated: (
                relationResult.compatibilityRelationsTruncated
            ),
            alertsTruncated: allPriorityAlerts.length > priorityAlerts.length,
        },
    };
}
