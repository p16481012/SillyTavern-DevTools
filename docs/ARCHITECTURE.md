# 아키텍처

이 문서는 v0.16.3의 세 갈래 도움말 정보 구조, 19개 기능 설명서의 제품형 정적 preview와 다섯 고급 coachmark, 직접 체험형 기본 온보딩, 다섯 기능 하단 내비게이션·모바일 앱 셸, 스키마 v7, 캡처 우선 저장, 불투명 generation ledger와 usage·비용 출처, 구조 provenance, 저장 정책·무결성·archive, 개인정보 모드, Worker·가상 목록, 선택적 AI Semantic Inspector와 공식 합성 Provider 평가 경계를 기준으로 합니다. Rule Inspector V3와 비교 정책 V2의 로컬 분석 경계도 그대로 유지합니다.

## 읽기 전용 경계

ST DevTools는 `generate_interceptor`를 선언하지 않고 SillyTavern의 이벤트 payload를 수정하지 않습니다. Prompt-ready 리스너는 캡처 대기 항목을 만들고 즉시 반환합니다. 요청 설정 객체는 같은 이벤트의 동기적 후속 변경이 반영될 수 있도록 리스너 반환 직후 복제하며, 토큰 계산과 IndexedDB 쓰기는 이벤트 처리 흐름 밖에서 실행됩니다.

선택적 AI 의미 검사는 이 읽기 전용 원본 경계를 유지하면서 사용자가 매번 미리보기와 전송에 동의했을 때만 선택한 공개 Connection Manager profile `sendRequest()` 또는 현재 연결의 공개 `getContext().generateRaw()` 중 하나를 호출합니다. 이 호출은 SillyTavern 프롬프트·캐릭터·설정·정적 검사 결과를 수정하지 않고 제안을 현재 패널 메모리에만 반환합니다.

v0.13.1의 `원문 복사`·`내용 복사`·`제안 내용 복사`는 화면에 이미 표시된 문자열만 클립보드로 전달합니다. SillyTavern 저장 API나 prompt interceptor를 호출하지 않으며 raw prompt 복사 동작은 `full` 스냅샷에만 표시합니다. AI 제안 복사는 제목·요약·판단 이유를 복사할 뿐 수정된 프롬프트라고 표시하지 않습니다.

### 세 갈래 도움말 경계

`src/help-center.js`는 화면별 상세 문서를 immutable registry로 제공하고 상단 책 control은 `기본 사용법`·`고급 기능 가이드`·`기능 설명서`만 보이는 하나의 modal dialog를 엽니다. 기본 사용법은 전체 hands-on 안내와 프롬프트 13·기록 6·비교 8·검사 7·검색 5단계의 기능별 진입점을 제공하고, 기능 설명서는 검색 가능한 상세 문서와 FAQ를 제공합니다. 홈 카드 전체가 button이므로 별도 파란색 `… 보기` action copy는 만들지 않고 제목·설명·방향 표시만 사용합니다.

`HELP_TOPIC_VISUALS`는 19개 `HELP_TOPICS` ID와 정확히 대응하는 불변 시각 자료 registry입니다. 각 자료는 `flow`·`comparison`·`lanes` 유형과 접근 가능한 설명·caption, `sequence`·`contrast`·`branch`·`mapping`·`trend`·`replacement`·`parallel` 관계를 가진 lane·item으로만 구성됩니다. renderer는 이를 실제 제품 class와 분리된 정적 header·lane panel·card row·icon·text badge로 투영하고 `연습 데이터 · 읽기 전용`을 표시합니다. 외부 이미지 URL·고정 색상값·실제 form control·event handler 없이 밝음·어두움 panel token과 모바일 단일 열 재배치만 사용합니다.

짧은 `?` tooltip은 기능을 다시 떠올릴 한두 문장과 텍스트형 `자세히 보기`만 포함합니다. `자세히 보기`는 별도의 창이나 중간 목록을 거치지 않고 같은 도움말 dialog의 해당 topic ID로 deep link합니다. 도움말을 닫으면 deep link를 연 실제 control로 focus를 복원합니다.

고급 기능 가이드는 별도 연습장 renderer로 기능을 복제하지 않고 실제 규칙 검사·비교 화면과 같은 control·레이아웃 위에서 coachmark 단계로 실행합니다. 비교 정책 9단계는 profile 적용 범위·순서·그룹 동작·이름 규칙·수동 지정·우선순위·미리보기를, AI 의미 검사 10단계는 후보·profile·응답 상한·prompt/prefill·전송 범위·동의·검증·폐기를 다룹니다. 검사 결과 판정과 예외 관리 7단계, Atom·Relation 근거 읽기 7단계, 대안 그룹 교체 비교 6단계도 각각 고정 source·결과·정책 상태를 session 메모리에서만 전환합니다. `SemanticInspector`, Connection Manager, `fetch`, snapshot store, 실제 검토 결정·비교 정책 저장 함수와 비용 경로는 호출하지 않습니다.

도움말 dialog가 열리면 제품의 header·workspace·bottom navigation을 `inert`·`aria-hidden` 처리하고 dialog 안에서 focus를 순환합니다. Escape와 닫기는 더미 session·timer를 정리하고 원래 focus를 복원합니다. 모바일은 dialog 전체 화면을 사용하며 고정 header 아래 `.st-devtools-help-body` 하나만 scroll owner입니다. 320px·390px, 밝음·어두움 테마와 keyboard focus에서 세 경로·문서 deep link·코치마크 control이 가로로 넘치거나 호스트 테마에 의해 변형되지 않는 것을 회귀 대상으로 둡니다.

변경 비교는 렌더 시 저장된 비교 정책을 두 snapshot source에 다시 주석화합니다. 같은 source identity가 유지된 상태에서 내용·토큰·귀속·메타데이터 또는 alternative group·option 분류가 바뀌면 `changed`, 동일한 `alternative` group에서 기준과 비교 각각 활성 옵션이 정확히 하나이고 option도 서로 다르면 removed+added 한 쌍을 `replaced`로 결합합니다. 정책 누락, 동일 option, 다대다나 추가 활성 옵션처럼 모호한 경우에는 결합하지 않습니다.

### hands-on 온보딩과 부분 투어의 view-session 격리 경계

v0.16.3의 온보딩은 `src/onboarding.js`에 전체 39단계와 기본 사용법의 기능별 부분 투어를 함께 정의합니다. 도움말에 표시하는 부분 투어는 캡처 3단계와 전송 프롬프트 10단계를 합친 프롬프트 13·기록 6·비교 8·검사 7·검색 5단계입니다. 전체 안내도 같은 39단계로 ‘예상과 다른 답변에 어떤 지시가 영향을 줬는지 찾기’를 캡처 → 실제 전송 내용 → 충돌 근거 → 변경 시점 → 두 요청 비교 → 원본 검색 순서로 추적합니다. 직접 조작할 것이 없는 읽기 단계는 `briefing` 한 번에서 `다음`으로 이동하고, 상호작용 단계는 별도 진입 확인 없이 `practice → debrief`로 진행합니다. `이전`은 phase가 아니라 선택한 투어 안의 논리 단계 단위로 이동합니다.

전체 안내만 첫 실행 상태의 `completed`·`skipped`를 기록합니다. 기능별 부분 투어와 고급 가이드는 독립 route로 실행하며 완료·중단·건너뛰기가 전역 온보딩 상태를 쓰거나 덮어쓰지 않습니다. 각 부분 투어는 필요한 snapshot 수·선택 항목·캡처 상태가 준비된 checkpoint에서 session을 만들기 때문에 중간 기능부터 시작해도 이전 장의 조작을 요구하지 않습니다.

`src/onboarding-fixture.js`는 920·1,080·1,248 토큰의 immutable 스냅샷 3개와 전용 immutable comparison policy를 정의합니다. 요청 2의 `예시 수 | 1개`와 요청 3의 `예시 수 | 2개`는 서로 다른 identity이지만 `{group} | {option}` 정책으로 같은 대안 그룹에 주석화되어 1:1 교체가 됩니다. 이 정책은 `tutorial:snapshot:*`에만 사용하고 실제 사용자 저장 정책과 분리합니다. `createOnboardingSession()`은 초기 두 스냅샷만 보이는 별도 mutable view state를 매번 만들고, 연습 캡처가 끝나면 세 번째 스냅샷을 그 session의 timeline에만 추가합니다. `DevToolsWindow`의 `activeTimeline()`·`activeSelectedId()`·`activeTabId()`·열림/필터 상태 접근자는 실습 중에만 이 session을 선택합니다.

실습 단계는 실제 탭·select·button·details·검색 입력을 click/change/input/toggle하게 하지만 snapshot store의 추가·삭제·보관 API, provider adapter·Semantic Inspector, 클립보드와 export를 호출하지 않습니다. 캡처 연습의 `대기 → 감지 → 저장 중 → 저장됨`도 session 내부 상태 전환이며 실제 요청을 저장하지 않습니다. 상태는 색상 점만 쓰지 않고 짧은 copy와 pill을 함께 갱신합니다. AI 의미 검사나 공식 Provider 평가가 실행 중이면 시작하지 않고 실습 중 새 AI 실행도 거부합니다.

첫 초대와 읽기 전용 briefing·debrief는 modal phase입니다. 제품 영역을 `inert`·`aria-hidden` 처리하고 focus를 안내 surface 안에 가둔 상태에서 화면을 dim 처리하며 실제 target의 spotlight 영역만 드러냅니다. briefing은 target ring·점선 화살표·제목과 기능 의미·사용 시점 또는 확인 행동을 두 개의 짧은 문장으로 표시합니다. debrief는 녹색 result ring과 별도 불투명 고대비 surface에서 `잘했어요!`, 단계 이름과 관찰 결과를 분리합니다. 완료 surface는 target보다 위 stacking context에 놓이고 아래 target copy가 비치지 않도록 배경·텍스트 token을 직접 지정합니다. modal footer에는 진행 숫자와 `다음`만 두고 종료 control은 패널 우측 상단에 둡니다. phase가 끝나면 `inert`와 focus trap을 함께 해제합니다.

상호작용 단계는 처음부터 practice로 진입해 dim·modal·`inert` 없이 실제 제품 화면, target의 고대비 pulse ring과 기능 이름·의미·사용 맥락·할 일을 한 dock에 표시합니다. 캡처 데모는 이름이 보이는 가로 실행 버튼과 진행 중 상태를 제공하고 나머지 target은 실제 button·input·select 또는 disclosure의 직접 `summary`입니다. value·checked·open 조건이 이미 충족된 경우 현재 DOM 상태를 즉시 완료 집합과 동기화해 control을 되돌렸다 다시 조작하게 하지 않습니다. 정확한 동작을 감지하면 debrief로 자동 전환하고, disclosure는 제목 줄 대신 새로 펼쳐진 본문의 보이는 영역을 결과 target으로 사용합니다.

튜토리얼 interaction listener는 실제 control보다 먼저 실행되는 capture phase에 있습니다. click 직후의 이전 `aria-checked`·`open` 값을 판정하지 않도록 다음 task까지 완료 검사를 미루고, 그 사이 튜토리얼이 닫히거나 다른 단계로 바뀐 경우를 막기 위해 같은 session 객체·step ID·`practice` phase인지 다시 확인합니다.

320px·390px 화면에서도 고정 sheet나 내부 본문 스크롤을 사용하지 않습니다. target 강조 영역은 최소 52×44px이고 짧은 코치마크는 panel의 실제 가시 폭과 target 위·아래 중 가용 공간을 함께 계산하며 하단 safe area 내비게이션을 피합니다. 검색 snapshot select처럼 긴 control도 가시 viewport 안에서 폭과 수평 위치를 제한해 document를 왼쪽으로 밀거나 가로 scroll을 만들지 않습니다. 320px의 캡처 실습은 지시와 실행 버튼을 세로로 배치합니다. target pulse·copy 진입·spotlight 크기 변화·성공 feedback은 짧은 one-shot animation이고 `prefers-reduced-motion`에서는 정적 링과 색상 변화만 유지합니다. 종료 시 target 표시와 session을 제거하고 기존 live 탭·선택·타임라인·캡처 상태와 시작 전 focus를 다시 렌더링합니다. 저장하는 상태는 `st-devtools:onboarding:v5`의 schema/tour version과 `skipped` 또는 `completed`뿐이며 진행 단계·phase·시각·연습 원문·실제 데이터는 저장하지 않습니다.

## 캡처 파이프라인

1. `GENERATION_STARTED`가 원시 공개 ID를 저장하지 않는 불투명 내부 handle과 생성 유형·수명 제한 상태를 만듭니다.
2. `WORLD_INFO_ACTIVATED`가 공개 ID로 정확한 session을 찾거나 안전하게 하나만 고를 수 있을 때 해당 generation의 로어북 항목으로 기록합니다.
3. `CHAT_COMPLETION_PROMPT_READY` 또는 `GENERATE_AFTER_COMBINE_PROMPTS`가 prompt-ready payload와 현재 컨텍스트를 복제합니다.
4. 가능한 경우 다음 이벤트와 대기 중인 prompt 양쪽의 공개 ID가 정확히 같을 때 연결합니다. 공개 ID가 양쪽 모두 없을 때만 prompt 유형별 request FIFO를 사용합니다.
   - `CHAT_COMPLETION_SETTINGS_READY`
   - `TEXT_COMPLETION_SETTINGS_READY`
   - `GENERATE_AFTER_DATA`
5. 같은 이벤트 전달 중 동기적으로 설정이 바뀔 수 있으므로 리스너 반환 직후 요청 객체를 복제합니다. 연속 settings-ready 이벤트는 pending 항목을 동기적으로 예약하며, 동일 요청 객체가 다른 호환 이벤트에 다시 전달되면 한 번만 연결합니다. 공개 ID 충돌이나 한쪽 ID 누락은 다른 pending 항목으로 fallback하지 않습니다.
6. 요청 객체에서 `messages`, `chat`, `prompt`, `input`을 우선 payload로 사용합니다.
7. credential 형태의 필드, 토큰 형태 값, Authorization, URL query 비밀값과 PEM 개인 키를 요청·컨텍스트·로어북·payload 전체에서 제거하고 경로를 기록합니다.
8. 요청 설정 이벤트가 일정 시간 안에 없으면 prompt-ready payload를 대체 캡처합니다.
9. `GENERATION_STOPPED` 또는 `GENERATION_ENDED`를 받으면 정확히 식별되거나 하나로 한정된 generation에 연결된 스냅샷의 lifecycle을 같은 ID로 갱신합니다.
10. 정확한 payload와 finalText, 로컬 추정 usage, 단일 final source를 가진 최소 스냅샷을 먼저 만듭니다. 캡처 시점의 사용자 설정에 따라 `full`·`redacted`·`metadata` 중 하나로 단방향 변환하고 원래 채팅 partition에 저장합니다.
11. `store.addSnapshot()` 뒤 같은 partition과 ID를 즉시 다시 읽어 레코드와 timeline index를 검증합니다. 저장·재읽기는 각각 제한 시간 안에 끝나지 않으면 단계가 구분된 `failed`로 닫습니다.
12. 저장이 확인된 뒤 prompt tokenizer의 입력 토큰, 소스 연결 상태·payload 구조 위치·멀티모달 토큰 추정치를 유휴 작업에서 계산하고 같은 ID를 원자적으로 보강합니다. 작업량 상한을 넘거나 후처리가 실패하면 최소 스냅샷을 그대로 유지합니다. 유효한 `MESSAGE_RECEIVED` 출력 토큰은 하나의 활성 generation만 고를 수 있을 때 별도 후속 usage로 병합합니다.
13. 같은 채팅의 저장·읽기·삭제·비우기는 채팅 키 잠금으로 직렬화하고, 모든 저장 변경과 전체 삭제·정책 적용·archive 가져오기는 추가 전역 잠금으로 교차 실행을 막습니다. lifecycle·usage·상세 분석 후속 변경은 저장 identity를 유지하는 원자적 snapshot updater를 사용합니다.

### 개인정보 없는 캡처 상태

v0.11.4의 `capture-status`는 캡처 payload와 별개인 UI 진행 신호입니다. detail은 동결된 `{ state, promptType?, stage?, phase?, at }`만 가지며 상태는 `capturing`·`processing`·`saved`·`failed`·`excluded-semantic`·`skipped-safety`, phase는 `finalizing`·`privacy`·`storage`·`storage-verify`로 제한합니다. 프롬프트 원문, snapshot/chat ID, provider/model, request ID와 오류 객체·메시지는 넣지 않습니다. 기존 `snapshot` 이벤트는 저장 또는 같은 ID로 보강된 스냅샷 전달에, `capture-error`는 저장 실패한 동일 스냅샷 재시도에 계속 사용합니다.

## 캡처 경계

`backend-request-ready`는 SillyTavern 프런트엔드가 자체 백엔드로 전달하기 직전의 생성 데이터를 뜻합니다. 외부 provider로 전달되기 전 SillyTavern 서버가 요청을 변환하거나 필드를 추가할 수 있으므로 provider에 도달한 최종 HTTP 본문과 동일하다고 주장하지 않습니다.

`generation-data-ready`는 API별 생성 데이터가 조립된 시점이며 이후 프런트엔드 또는 백엔드 변환이 남을 수 있습니다.

`prompt-ready`는 요청 설정 이벤트를 사용할 수 없을 때의 대체 경계입니다. v0.2 이하 스냅샷도 이 경계로 마이그레이션됩니다.

### Generation ledger와 usage 경계

`GenerationLedger`는 raw public ID 대신 호출자에게 노출되지 않는 내부 handle을 사용합니다. 활성·완료 session, public-ID 충돌 표시, pending request·usage buffer, lore와 snapshot 참조는 각각 개수·수명 상한을 가집니다. session view에는 공개 ID 값이 아니라 `hasPublicId`·충돌 여부·상태와 제한된 개수만 노출됩니다.

Prompt와 request의 상관관계는 양쪽에서 같은 공개 ID를 확인한 경우가 가장 우선입니다. 한쪽에만 ID가 있거나 같은 ID가 충돌하면 실패로 닫고, prompt와 request 양쪽 모두 ID가 없을 때만 유형별 request FIFO를 사용합니다. Response usage는 공개 ID가 정확히 일치할 때만 session에 들어가며 ID가 없거나 모호하면 별도 `unlinked` record가 됩니다. Response FIFO는 없습니다.

현재 공식 SillyTavern `event_types`에는 provider response usage payload와 이에 대응하는 provider request ID가 없습니다. `MESSAGE_RECEIVED`는 로컬 채팅 메시지 이벤트이며 provider 응답 usage 이벤트가 아닙니다. 따라서 기본 capability matrix는 공개 response·stream usage, public response correlation과 provider-reported cost를 `unsupported`로 선언합니다. OpenAI·Anthropic·Google·호환 usage shape parser와 `recordResponseUsage()` adapter는 별도 integration이 공식적으로 같은 ID와 payload를 주입할 때를 위한 경계이며 기본 이벤트 wiring에는 연결하지 않습니다.

Usage 정규형은 `provider-reported`·`local-estimate`·`unlinked`·`unavailable`, 입력·출력·캐시 입력·합계 토큰, 근거 이벤트·연결 시각과 비용을 정확한 허용 키로만 보존합니다. 로컬 prompt tokenizer 값은 입력 추정치이고 `MESSAGE_RECEIVED`의 `message.extra.token_count`는 출력 추정치입니다. 하나의 활성 generation을 고를 수 없으면 출력값을 임의 session에 붙이지 않습니다. Provider 값은 로컬 값보다 우선할 수 있지만, 기본 공식 이벤트에는 그 값을 제공하는 source가 없습니다.

비용은 provider 응답이 금액과 통화를 직접 보고해 스냅샷에 저장된 경우에만 표시합니다. 새 로컬 비용 계산과 내장·사용자 가격표는 없습니다. 과거 스냅샷에 이미 저장된 `user-override`·`catalog-estimate`·`lower-bound` 출처는 스키마 읽기 호환을 위해 보존하지만 새로 만들거나 재계산하지 않습니다.

## 스냅샷 스키마

스키마 버전 7:

- 식별 정보: ID, 시각, 확장 버전, 채팅 ID, 메시지 수
- 생성 정보: API 전송 계열, Chat Completion source 또는 Text Completion generation type, 모델, 프리셋, 프롬프트 유형, 생성 유형
- `providerTrace`: 전송 API·프롬프트 형식·생성 유형, SillyTavern에서 선택한 생성 소스와 요청 내 근거 위치, 확인할 수 없는 upstream provider 상태
- `capture`: 이벤트 이름, 캡처 단계, 대체 캡처 여부, 서버 변환 포함 여부, 요청 캡처 상태, 생성 lifecycle과 상태 이벤트 시각, raw ID 없이 공개 ID가 있었는지만 나타내는 `hadCorrelationId`
- `request`: 민감 정보와 알려진 상관관계 ID 값이 제거된 요청 본문, 프롬프트 필드를 제외한 생성 설정, 제거된 필드 경로와 `hadCorrelationId`
- `payload`: 변경 불가능하게 복제한 요청 프롬프트와 평탄화 텍스트
- provenance: 알려진 소스, 연결 방식, 0~1 신뢰도, 소스 메타데이터, 최종 텍스트 문자 범위, 구조 위치 사용 가능 상태와 최대 50개의 JSON pointer·메시지 번호·role·원본 값 범위·최종 범위
- assistant prefill: 요청 설정의 명시적인 근거로 확인한 `confirmed`와 마지막 assistant 메시지 위치만으로 판단한 `inferred`
- 멀티모달: 제공자, 입력 유형, 로컬 토큰 추정치, `estimate`·`lower-bound`·`upper-bound`·`unavailable`, 산정 방식
- 로어북: 활성화된 항목 객체
- 통계: 토큰, 컨텍스트 한도, 출력 예약량, 사용률, 남은 토큰
- `usage`: 상태, 입력·출력·캐시·합계 토큰, 근거 이벤트·연결 시각, provider 보고 비용과 과거 스냅샷 읽기 호환용 비용 출처
- 개인정보: privacy schema, `full`·`redacted`·`metadata` 모드, 원문·채팅 ID·요청 ID 포함 여부와 제한된 요약

스토리지를 읽을 때 스키마 v1~v4는 먼저 v5로, v5는 고정된 v6 단계로, v6은 v7로 지연 변환합니다. v6→v7은 구버전 `stats.totalTokens`가 유효할 때 입력 전용 `legacy-snapshot-token-count` 로컬 추정치로 옮기고 출력·캐시·provider 비용은 추측하지 않습니다. `capture.correlationId`·`request.correlationId`와 요청 root·알려진 metadata container의 correlation key 값을 제거하고 `hadCorrelationId` boolean만 보존합니다. 일반 도메인 `id`와 다른 객체 안의 동명 필드는 보존합니다. 변환은 기존 payload·최종 텍스트·snapshot ID를 변경하지 않는 새 객체를 만들며, 성공한 개별 레코드만 한 번 다시 저장합니다. 경량 인덱스의 `approximateBytes`와 이미 완료된 저장 요약은 변환 전후 바이트 차이만큼 함께 보정합니다. 정상 v7 레코드는 다시 직렬화하거나 쓰지 않습니다.

과거에 캡처하지 않은 요청 본문·멀티모달 크기·구조 위치는 소급하지 않습니다. 기존 provenance 방식과 신뢰도는 유지하되 구조 위치는 빈 목록과 `legacy-unavailable`로 표시합니다. 과거 lifecycle은 `unknown`으로 남기고, 기존 provider 값은 선택한 생성 소스의 `legacy-fallback` 근거로만 사용하며 upstream provider는 계속 `unknown`입니다.

v7 usage·correlation 검증 또는 이전 변환에 실패한 개별 레코드는 삭제하거나 덮어쓰지 않습니다. 같은 타임라인의 정상 형제 레코드는 계속 반환하며, 저장 계층은 제한된 `{id, message}` 메타데이터와 손상 개수를 만들지만 UI 경계에서 세부 항목을 폐기하고 개수만 보존합니다. 따라서 손상 원문과 내부 식별자는 패널 상태·DOM·오류 문구에 들어가지 않습니다. 무결성 복구도 손상 body 자체는 고치거나 제거하지 않고 참조와 인덱스만 복구합니다.

`redacted`는 prompt-bearing 문자열 전체를 길이·UTF-8 바이트·SHA-256을 담은 고정 placeholder로 치환하고 source ID·채팅 ID·요청 ID를 불투명 digest 기반 참조로 바꿉니다. 이것은 이름·이메일 같은 의미 기반 개인정보 탐지가 아니라 원문 제거 변환입니다. `metadata`는 payload·request body·source·lore·preset 같은 프롬프트 구조를 제거하고 capture lifecycle·provider trace·토큰과 개수 요약만 유지합니다. 이미 더 비공개인 스냅샷을 덜 비공개인 모드로 되돌리는 변환은 거부합니다.

## 저장·검색·내보내기 안전 경계

저장 상태 요약은 인덱스만 신뢰하지 않고 실제 `timeline:` 키를 열거합니다. 따라서 인덱스에서 누락된 타임라인도 채팅·스냅샷 수와 대략적 JSON 바이트에 포함되며 전체 삭제 대상이 됩니다. `st-devtools:` localStorage 항목도 개수와 용량에 포함하고 전체 삭제 시 규칙 설정·비교 정책·마지막 탭·창 위치를 함께 제거합니다. 다른 확장과 SillyTavern의 키는 건드리지 않습니다. IndexedDB를 초기화하지 못하면 메모리 backend와 소실 가능성을 UI에 명시합니다.

채팅별 보관 수·보관 기간·전체 대략적 용량과 UI 자동 로드 수는 별도 설정입니다. 정책 미리보기는 원문 대신 경량 인덱스와 레코드 바이트만 읽고 `기간 → 채팅별 개수 → 전체 용량` 순서로 삭제 대상을 결정합니다. 각 채팅의 최신 정상 레코드, 손상·고아 레코드와 명시적으로 보호된 새 캡처는 삭제하지 않습니다. 보호 항목만으로 용량 제한을 넘으면 `overBudget`으로 보고하며 자동으로 보호를 해제하지 않습니다. 적용 시 preview revision과 현재 mutation revision을 비교하고 달라졌으면 아무것도 지우지 않고 새 미리보기를 요구합니다.

구버전 배열 저장 구조는 미리보기에서 스키마 변환 없이 ID·시간·대략적 바이트만 계산하며, 승인 뒤에도 삭제될 과거 항목을 변환하지 않고 실제 보관할 최신 항목만 새 구조로 옮깁니다. 자동 로드 수는 보관 수 이하로 제한되며 이를 바꿔도 저장 데이터는 삭제하지 않습니다. 테마만 바꾸면 타임라인을 읽지 않고, 자동 로드·보관 범위 변경에 필요한 화면 새로고침은 설정 모달과 적용 버튼을 복구한 뒤 한 번만 비동기로 실행합니다. v0.8.9 설정이나 기존 저장 데이터가 감지되면 100개 보관 상한을 승계하고 신규 데이터가 없는 프로필에만 30개 기본값을 적용합니다.

무결성 진단은 경량 descriptor만 사용해 누락된 레코드 참조, 손상 레코드, 유효한 고아 레코드, 잘못된 인덱스, 구버전 중복·충돌 컨테이너를 분류합니다. 복구는 누락 참조 제거, 정상 고아 재인덱싱, chat index·완료 요약 재구성과 내용이 동일하다고 검증된 구버전 중복 제거만 수행합니다. 손상 레코드 참조와 raw 값, 현재 레코드와 다른 구버전 컨테이너는 그대로 보존합니다. 진단·복구도 revision 확인과 제한된 건수의 비식별 집계만 UI에 노출합니다.

`navigator.storage.estimate()`의 사용량·quota는 `browser-origin` 범위로 표시합니다. 이 값은 같은 origin의 SillyTavern과 다른 저장소를 포함하며, ST DevTools가 계산한 스냅샷·설정의 대략적 바이트와 합치거나 확장 전용 quota로 표현하지 않습니다. API가 없거나 실패해도 저장 동작은 계속하고 상태를 `unavailable`로 남깁니다.

일반 검색은 180ms debounce 뒤 실행합니다. 사용자 정규식은 256자, 그룹 24개, 반복자 32개로 제한하고 역참조·중첩 반복·반복되는 wildcard 같은 고위험 구조를 거부합니다. v0.10.0의 검색·diff·규칙 분석 runtime은 입력의 소스 수·문자 수·중첩을 먼저 제한한 뒤 요청마다 module Worker를 만들고 성공·오류·취소·timeout 때 항상 종료합니다. 결과가 돌아왔을 때 snapshot/policy revision이 달라졌으면 `stale`로 폐기합니다. Worker를 만들 수 없는 환경에서는 같은 입력 제한과 timeout 계약을 가진 로컬 경로를 사용합니다.

분석 cache는 snapshot·설정 digest, 분석 종류·variant·revision만 key로 쓰는 메모리 전용 LRU입니다. 항목 수·대략적 바이트·TTL 상한을 가지며 페이지를 새로고침하면 사라집니다. 프롬프트 원문은 key나 영구 저장소에 기록하지 않습니다. 비교 정책 이름 규칙은 별도로 정적 안전 검사를 적용하고 검사할 이름을 2,048자로 제한합니다.

복사·내보내기 영역은 원문과 형식별 구조 포함 범위를 먼저 표시합니다. 일반 내보내기와 전체 archive는 원문을 포함할 수 있습니다. 공유용 문서는 `redacted`·`metadata`만 허용하고 원본에서 수집한 민감 문자열 seed가 직렬화 결과에 남으면 실패로 닫히지만, 임의 개인정보 부재를 증명하지 않으므로 파일의 사용자 검토가 최종 경계입니다.

snapshot archive schema v2는 각 entry의 `full`·`redacted`·`metadata` 모드와 SHA-256 digest를 별도로 보존하므로 혼합 보관분을 `mixed`로 표현합니다. parser는 전체 바이트·깊이·채팅/항목 수·알 수 없는 필드·prototype key·중복 ID·privacy 일관성과 digest를 staging 전에 검증합니다. 안전한 schema v1 제거본은 v2로 이전하지만 원문이 섞인 것으로 확인되면 거부합니다.

가져오기 기본 전략은 merge입니다. 같은 chat·snapshot ID와 digest는 중복으로 건너뛰고, ID가 같지만 digest가 다르면 keep-both용 결정적 suffix를 붙이거나 사용자가 skip을 선택합니다. replace는 archive digest에서 유도한 archive별 확인 문자열을 요구합니다. 실행은 `SnapshotStore.runExclusiveImport()`의 전역 mutation lock 아래 raw key/value 상태를 먼저 복제하고, 보관 정책을 중간 적용하지 않은 채 변경한 뒤 전체 read-back digest를 확인합니다. 실패하면 건강한 레코드만 재생성하는 대신 raw 상태를 그대로 복원하고 복원 key/value fingerprint까지 검증합니다.

## 소스 수집

가능한 경우 SillyTavern의 `getCharacterCardFields()` 결과를 사용해 매크로와 그룹 카드 처리가 반영된 필드를 읽습니다. 구버전에서는 원본 캐릭터 데이터로 대체합니다.

- 설명, 성격, 시나리오
- 예시 대화, 첫 메시지
- 캐릭터 시스템 프롬프트
- 캐릭터 후처리 지시
- 캐릭터 깊이 프롬프트
- 페르소나, 작가 노트
- 활성 로어북
- 확장·설정 프롬프트
- 채팅 기록과 어시스턴트 프리필

직접 포함된 문자열은 최종 평탄화 텍스트에서 모든 비중첩 범위를 최대 50개까지 기록합니다. 정확한 문자열이 없으면 NFKC·대소문자·공백·zero-width 차이를 정규화해 대응 범위를 계산합니다.

v6 새 캡처는 최종 문자열 범위와 별도로 payload 안의 실제 구조 위치를 기록합니다. 위치는 JSON pointer, 메시지 번호, role, 해당 값 안의 문자 범위와 최종 프롬프트 범위를 조합하며 중복 제거 뒤 소스별 50개로 제한합니다. 설정 프롬프트·요청 메시지·도구·멀티모달 조각처럼 구조 근거가 있는 소스에만 추가하며, 위치를 찾지 못한 소스나 과거 스냅샷에 임의의 pointer를 만들지 않습니다.

설정 프롬프트는 일반 소스보다 먼저 SillyTavern 설정의 `identifier`·이름·role·position·depth·활성 상태를 보존합니다. 그 뒤 호환되는 역할의 실제 payload 메시지 안에서만 정확·정규화·템플릿 연결을 시도해 `configuredEnabled`와 `included`를 분리합니다. 비활성 설정은 동일 문자열이 payload에 있어도 귀속하지 않습니다.

기존 소스로 귀속되지 않은 실제 system/developer 메시지 구간은 `requestMessage` 소스로 남깁니다. 따라서 설정 목록에 없는 provider·확장 삽입 지시도 Rule Inspector에서 그룹 밖 비교 대상이 될 수 있습니다.

그 뒤 `{{...}}`, `${...}`, `<%...%>`, `<<...>>`가 있는 소스는 매크로 사이의 고정 문자열이 최종 텍스트에서 순서대로 이어지는지 확인합니다. 고정 문자열은 최소 12자·두 조각 이상이어야 하고 각 치환 구간은 최대 500자입니다. 결과는 확정이 아닌 `템플릿 후보`이며 고정 문자열 비율과 매크로 수로 계산한 제한된 신뢰도를 저장합니다.

멀티모달 소스는 요청 설정과 모델 이름으로 OpenAI·Anthropic·Google을 구분합니다. 이미지 크기와 미디어 길이가 있을 때만 공식 문서의 패치·타일·초당 규칙을 적용하며, 불완전한 입력은 하한·상한 또는 산정 불가로 남깁니다.

## 진단 보고서

현재 채팅 진단은 스냅샷을 시간순 메타데이터로 변환합니다. 전체 채팅 진단은 저장 인덱스를 읽은 뒤 실제 타임라인이 있는 채팅만 `chat-N`으로 익명화합니다. 두 형식 모두 프롬프트·요청 본문·요청 식별자·채팅 식별자 값을 제외한다고 명시합니다.

진단 JSON 가져오기는 5MB 이하 JSON 객체만 파싱하고 보고서 버전·범위·생성 시각·개수 일관성·개인정보 제외 플래그를 검사합니다. 원문 필드 이름, 과도한 중첩·항목 수를 거부합니다. 검증 결과는 범위와 개수만 UI에 표시하며 스냅샷 저장소에 쓰지 않습니다.

진단 비교는 두 문서를 같은 validator로 각각 검증한 뒤 허용 목록에 있는 summary scalar·count map·token 통계와 제한된 스냅샷 메타데이터만 비교합니다. 내부 ID는 일치 판단에만 사용하고 결과에는 시각·API·provider·model·capture stage만 남깁니다. count key는 200개, 추가·삭제·변경 스냅샷은 각 100개로 제한하며 범위나 report version이 다르면 `compatible: false`와 경고를 반환합니다.

## 파이프라인 분석과 시각화

타임라인 분석은 저장된 스냅샷을 변경하지 않는 순수 함수로 계산합니다. 스냅샷을 시각순으로 정렬한 뒤 이전 턴과 비교해 전체 토큰 증감, 활성화·제거·변경 로어북과 변경된 소스를 구합니다. 같은 world·UID 로어북 항목은 내용·키·위치와 목록 순서 차이를 별도 필드 변화로 보존합니다.

소스 비교는 캡처마다 바뀔 수 있는 ID 대신 소스 유형과 `metadata.field`, 로어북 world/uid, 설정 식별자 등 의미가 유지되는 메타데이터를 조합합니다. 같은 식별자가 반복되면 등장 순서를 덧붙입니다. 실제 포함 상태가 바뀌면 추가·삭제로 표시하고, 두 스냅샷 모두에 있는 소스는 내용·토큰·연결 방식과 별도로 role·depth·position·enabled·`promptOrder` 변화를 계산합니다. 두 시점 모두 비활성·미포함이면 원문 내용 변화는 노출하지 않지만 배치 메타데이터 변화는 표시합니다. 최종 프롬프트 자체는 별도의 전체 diff로 표시하므로 소스별 diff에서는 제외합니다.

최종 프롬프트의 문자 범위 시각화는 모든 소스 범위의 시작·끝을 경계로 텍스트를 sweep 방식으로 분할합니다. 여러 소스가 겹치는 구간은 모든 소스 ID를 보존해 어느 방향에서 탐색해도 대응 항목을 강조할 수 있습니다. 타임라인 화면은 사용하지 않는 소스별 diff를 계산하지 않아 큰 보관 범위에서도 불필요한 비교를 줄입니다. 성장 그래프도 전체 분석에서 최근 10개만 그려 시각 밀도를 제한하고, 각 점의 선택 상태와 토큰 상세만 UI 상태로 유지합니다.

타임라인이나 소스가 100개 이상이면 `VirtualListMetrics`가 측정된 행 높이와 추정 높이를 Fenwick tree에 누적해 현재 viewport와 overscan 범위만 DOM으로 만듭니다. spacer가 전체 스크롤 높이를 유지하고 `aria-setsize`·`aria-posinset`과 키보드 이동 시 대상 행의 재렌더를 함께 갱신합니다. 항목이 100개 미만이거나 필요한 DOM API가 없으면 기존 전체 렌더 경로를 사용합니다.

## 규칙 검사

규칙 검사는 저장된 스냅샷을 입력받는 순수 로컬 함수입니다. 검사 결과는 스냅샷에 저장하지 않고 화면을 열 때 계산합니다. 따라서 전역 규칙과 분석 로직이 개선되어도 기존 스냅샷을 다시 캡처할 필요가 없습니다. 다만 v0.9.1 이전 스냅샷에는 프리셋 API와 캐릭터·그룹 채팅 소유자 범위가 없으므로, 프리셋·캐릭터·채팅 프로필과 해당 범위의 검토 판정은 v0.9.1에서 새로 캡처한 스냅샷으로 확인합니다.

검사는 평탄화된 전체 텍스트를 한꺼번에 비교하지 않고 검사 가능한 소스별로 수행합니다. `instruction-atoms.js`는 먼저 소스를 지시·참고·대화 산출물·tool 데이터·멀티모달 표시·최종 집계로 분류합니다. 비활성 설정 프롬프트와 실제 요청 미포함 소스는 원자 추출에서 제외하고, 대화 산출물·tool 데이터·멀티모달 표시·최종 집계는 지시 비교에서 분리합니다. 참고 데이터는 원자를 표시할 수 있지만 일반 지시와 자동 비교하지 않습니다.

각 지시 원자는 대상, 행동, 속성, 값, 긍정/금지, 범위, 조건, 예외와 우선순위 외에 source ID·label·type·role·position·depth, 원문 문자 범위, 최종 프롬프트 범위, 추출 방식과 0~1 신뢰도를 보존합니다. 예시 접두사·인용 예문·fenced code block의 문구는 원자에서 제외합니다. 같은 속성의 비호환 값 또는 반대 극성 원자를 실제 쌍으로 연결하고, 원자를 공유하는 관계는 클러스터로 묶습니다.

무조건 명시된 언어·형식·긍정/금지 충돌은 `confirmed`, 조건이나 예외가 섞이면 `candidate`, 역할처럼 정적 패턴만으로 양립 여부를 확정하기 어려우면 `insufficient-evidence`로 판정합니다. 원자 500개·관계 200개·우선순위 경고 100개 상한을 두며, 상한에 닿으면 결과에 생략 상태를 기록합니다. 명시적인 패턴과 정확히 정규화된 문장 비교를 사용하며 의미를 추론하는 모델 호출은 사용하지 않습니다.

### Rule Inspector V3 처리 흐름

1. `instruction-atoms.js`가 실제 요청에 포함된 검사 가능 소스를 capability별로 나누고 지시 원자를 추출합니다.
2. `comparison-policy.js`가 스냅샷의 범위 컨텍스트와 정책 V2 초안을 이용해 소스 복제본에 그룹 annotation을 붙입니다.
3. `rules.js`가 원자 쌍·클러스터를 만들면서 같은 그룹과 검사 범주에 적용되는 비교만 제외하고, 제외 비교·그룹 요약·그룹 경고를 findings와 함께 반환합니다.
4. `finding-review.js`가 결과의 의미 키와 현재 범위에 저장된 판정·무시를 대조합니다.
5. UI가 구조 요약과 원자 상세를 기본 접힘 상태로 표시하고, finding에서 탐색기를 다시 렌더한 뒤 관련 소스 또는 정확한 최종 근거 범위를 강조합니다.

현재 비교 범주 ID는 `language`, `format`, `role`, `directives`, `duplicates`입니다. 컨텍스트 사용률, 대형 소스, 명시적인 이전 지시 무시 문구처럼 한 소스 또는 스냅샷 전체를 검사하는 규칙은 그룹 내부 비교 제외와 별개입니다.

V3 검사 결과는 `atomIds`, `relationId`, `clusterId`, 양쪽 `evidenceRecords`, 관련 `sourceIds`와 최종 텍스트의 `finalRanges`, `method`, 수치 `confidence`를 함께 반환합니다. 규칙 활성화와 수치 임계값은 버전이 지정된 브라우저 localStorage 키에 저장하며 스냅샷 스키마에는 포함하지 않습니다.

### 선택적 AI Semantic Inspector 경계

v0.13.1의 AI 의미 검사는 Rule Inspector V3 뒤에 붙는 선택 계층입니다. 정적 분석은 AI 설정과 관계없이 기존처럼 로컬에서 실행되고, AI 기능은 `st-devtools:preferences:v5`의 명시적 opt-in이 없으면 UI에서 준비조차 시작하지 않습니다. 규칙 검사 화면의 AI 모드가 opt-in·연결 프로필·응답 상한을 함께 다루지만, 활성화만으로 `prepare()`·`inspect()` 또는 provider adapter를 호출하지 않습니다. V1~V4 설정은 읽을 때 V5 기본값과 합쳐 이전합니다. 선택 대상과 AI 결과는 `DevToolsWindow` 인스턴스 메모리에만 있으며 스냅샷·archive·정책·검토 판정·localStorage에 기록하지 않습니다. 설정에는 선택한 Connection Manager 프로필의 bounded opaque ID와 사용자가 직접 입력한 bounded 추가 프롬프트·프리필만 저장하며 프로필 객체나 credential은 기록하지 않습니다. 추가 프롬프트·프리필은 일반 텍스트 저장임을 UI에서 경고합니다.

처리 흐름은 다음과 같습니다.

1. UI가 개인정보 모드가 `full`인 현재 스냅샷과 사용자가 직접 체크한 `finding:<id>` 또는 `cluster:<id>`만 `SemanticInspector.prepare()`에 전달합니다. redacted·metadata v7 스냅샷은 코어에서도 다시 거부합니다.
2. `SemanticInspector`는 adapter의 선택된 Connection Manager 프로필 또는 현재 연결 identity를 동기적으로 읽습니다. 공개 프로필 서비스가 없거나 저장한 프로필 ID가 resolve되지 않으면 요청 시작 전에 현재 연결을 사용합니다. provider를 확인할 수 없는 `unavailable`은 지원하지 않는 상태로 실패하고, provider만 확인되는 `partial`은 model과 비용을 추측하지 않은 채 그대로 유지합니다.
   Text Completion 프로필에는 consent에서 검토한 semantic prompt를 문자열로 그대로 전달하고 `includeInstruct: false`로 별도 instruct template 재구성을 막습니다. `includePreset: true`는 sampler·stop 설정에만 사용하며 prompt·model·응답 상한은 명시적 요청값을 유지합니다.
3. `semantic-inspector.js`가 target을 실제 로컬 finding/cluster에 연결하고 source·atom·relation closure를 계산합니다. 활성 상태·실제 요청 포함·대안 제외·분석 capability·금지된 final/chat-history 유형을 검사하며, closure 밖 소스는 정확한 label과 제외 이유만 미리보기에 남깁니다.
4. closure에 필요한 source는 일부를 조용히 생략하거나 자르지 않습니다. source별·선택 전체·요청 전체 상한을 넘거나 필수 source에서 민감 토큰을 발견하면 준비 전체를 `SEMANTIC_INVALID_INPUT`으로 실패시켜 quote offset을 바꾸는 부분 정제를 금지합니다.
5. 준비 결과는 실제 요청과 같은 전체 `content`, source 이름·type·byte·range·정책 annotation, 제외 목록, 현재 provider/model identity, 예상 입력 토큰, 응답 토큰 상한, 고정 지시·추가 지시·프리필을 담습니다. UI는 이 값으로 전용 모달을 만들고 동의 체크를 매번 선택 해제합니다. 사용자가 이번 1회 전송에 동의하기 전에는 `inspect()`를 호출하지 않습니다.
6. 전송 직전에 adapter identity를 다시 읽어 provider·model·현재 연결/프로필 경로·opaque profile ID 중 하나라도 준비 시점과 달라졌으면 실패로 닫습니다. 준비 identity는 `generate()`의 expected route binding으로 전달되고 adapter가 실제 경로를 한 번 resolve해 호출 함수와 함께 고정합니다. 이 사이에 선택 profile이 사라지거나 current route가 profile로 바뀌면 capture gate를 열기 전에 실패하므로 current 연결로 잘못 전송하지 않습니다. identity 전체가 요청 digest에 포함되므로 같은 provider/model을 쓰는 다른 프로필의 cache도 재사용하지 않습니다. 유효한 메모리 cache가 없을 때만 provider adapter의 `generate()`를 호출하며, 선택한 프로필의 `sendRequest()`가 시작된 뒤 실패하면 현재 연결 `generateRaw()`로 자동 재시도하지 않습니다.
7. adapter는 문자열 응답과 bounded JSON object만 허용하고 OpenAI 계열·Anthropic·Google 계열 및 공개 profile의 알려진 envelope에서만 결과 텍스트를 꺼냅니다. 인증·요청 한도·네트워크·timeout·일시 장애·거부는 원래 오류 문구를 버리고 안정된 `SEMANTIC_*` code와 고정 reason으로 분류합니다. 구조화된 안전 거부는 형식 오류와 구분하지만 거부 원문은 전달하지 않습니다.
8. 응답은 버전이 지정된 JSON object 한 개만 허용합니다. 정확한 root/suggestion/evidence 필드, 배열·문자열·깊이·노드·바이트 상한, 허용 category/severity, 준비 요청에 실제로 존재하는 target/source/atom/relation ID를 검사합니다. evidence의 모델 제공 offset이 틀렸더라도 `quote`가 해당 source content에 정확히 존재할 때만 bounded 검색으로 위치를 재정렬합니다. 원문에 없는 quote나 다른 검증 실패가 하나라도 있으면 전체 응답을 `SEMANTIC_INVALID_RESPONSE`로 폐기합니다.
9. 통과한 결과는 `origin: ai`와 요청 digest를 가진 별도 `AI 제안`으로만 반환합니다. UI에는 정적 finding 카드와 다른 영역으로 렌더링하며 정적 finding, 판정·무시, 비교 정책, 원본 프롬프트를 갱신하는 컨트롤을 두지 않습니다.

관련 모듈의 경계는 다음과 같습니다.

| 모듈 | 책임 | 변경하거나 저장하지 않는 것 |
|---|---|---|
| `semantic-inspector.js` | target closure, 정확한 전송 preview, bounded prompt, strict JSON/evidence 검증, memory cache | SillyTavern 원본, 정적 finding/review/policy, 전체 raw prompt·provider response의 영구 저장 |
| `semantic-connection-profiles.js` | 공개 `ConnectionManagerRequestService`의 지원 프로필 목록·해결, bounded ID·name·provider·model·completion type 정제 | API key·URL·비밀번호·proxy·private settings 읽기 또는 저장 |
| `semantic-provider-adapter.js` | 선택한 공개 profile `sendRequest()` 또는 현재 `getContext().generateRaw()` 단일 경로 호출, prepared identity와 실제 route의 원자적 결속, underlying settlement lease, 알려진 provider envelope 정규화, response cap, timeout·AbortSignal의 논리적 취소와 안정된 오류 code·reason | 프로필 실패 뒤 현재 연결 재시도, 알 수 없는 envelope 추측, provider 오류 원문 전달, 내부/legacy generation 함수·credential transport 접근, 실행 중 provider 계산 강제 중단 |
| `semantic-evaluation.js` | 합성 corpus의 제안 유용성·오탐률·같은 source에서 IoU 0.5 이상인 근거 pair 적중률을 bounded·결정적으로 계산하고 원문 없는 집계 보고서 반환 | 실제 provider 호출, 모델 결과 생성, 사용자 스냅샷·프롬프트 원문 저장 |
| `semantic-provider-evaluation-corpus.js` | 제품에 포함된 고정 합성 16건과 실제 로컬 분석 후 canonical target closure 구성, 구조 relation/atom/source-bridge 경로 표시 | 사용자 snapshot·파일·clipboard·사용자 prompt/prefill 입력 |
| `semantic-provider-evaluation-harness.js` | 동일 inspector를 사용한 사례별 prepare·구조 closure gate·동의·fresh inspect, identity/route/cache 고정, inspector 단위 mutex·settlement lease, 1회 smoke/3회 공식 판정과 원문 없는 집계 | 자동 일괄 호출·retry·별도 adapter/gate·raw prompt/response/quote 저장 |
| `semantic-capture-gate.js` | 호출별 nonce identity ticket, prompt·prompt type exact match, 같은 semantic 호출의 exact duplicate 억제, TTL·용량·identity-exact 소비·해제 | 모든 생성의 전역 캡처 중단, 모호한 요청의 임의 연결 |
| `capture.js` 연동 | AI request와 정확히 일치한 settings/data event 및 그 duplicate만 자기 캡처에서 제외 | 동시에 진행되는 일반 사용자 generation의 정상 캡처 |
| `ui.js` | 기본 OFF 설정, 수동 선택, 매 호출 미리보기·동의, 취소·재시도, 별도 결과 표시 | 동의 저장, 자동 대상 선택·자동 수정·정책 변경 |

Provider 응답 정규화는 배열 prototype·길이·own key·data descriptor를 제한하고 응답 객체의 iterator·slice·toJSON·accessor를 호출하지 않습니다. 이는 공개 SillyTavern API가 반환한 plain data의 해석 경계이며, 같은 JavaScript realm에 이미 주입된 hostile Proxy의 `getPrototypeOf`·descriptor 같은 meta trap 실행 자체를 별도 process처럼 sandbox하는 기능은 아닙니다.

`SemanticInspectorMemoryCache`의 key는 protocol·provider identity·응답 상한·bounded prompt를 포함한 digest입니다. 값에는 전체 raw prompt·전체 raw provider response와 전용 `source.content`·`evidence.quote` 필드를 넣지 않고 검증된 ID·offset과 title·summary·rationale 같은 정규화 제안 텍스트를 제한된 LRU/TTL로 보관합니다. 모델이 제안 텍스트 안에 입력 원문의 표현을 반복할 가능성까지 제거하지는 않으므로 이 cache는 익명화 경계가 아닙니다. cache hit의 evidence quote는 현재 준비 source의 검증된 offset에서 다시 구성하며 새로고침하면 cache 전체가 사라집니다.

v0.14.0 평가 corpus v2 16건은 목적에 맞게 새로 쓴 합성 사례만 포함하며 사용자 원문·credential·URL을 입력으로 사용하지 않습니다. 기존 기반 사례에 조건·예외·말투·역할·안전의 충돌/비충돌 한·영 교차 대조군을 더했고, reference evidence가 source의 exact slice인지 검사합니다. 평가기는 검증된 제안 집합을 기대 issue와 정확한 target·source 집합으로 일대일 대응시켜 유용성·오탐률과 같은 source에서 IoU 0.5 이상인 근거 pair 적중률을 집계하고 누락 사례나 상한 초과 입력을 실패로 닫습니다. category·target·source가 같은 복수 issue는 최대 issue 적중 수 안에서 근거 pair 적중이 최대가 되는 bounded 대응을 선택합니다.

corpus v2의 `releaseGates`는 전체 비율과 별도로 각 의미 축의 양성 exact issue match·모든 기대 근거 pair 적중·추가 근거 없음과 음성 제안 0건을 필수 조건으로 만듭니다. 구 평가기는 v2 fixture를 지원 버전으로 받아들이지 않으며, 현 평가기는 `releaseGates`가 없는 legacy v1만 종전 집계 방식으로 명시 지원합니다. v1에 gate를 붙이거나 v2에서 gate를 빼면 실패로 닫습니다.

이 corpus의 `atoms`·`relations`가 비어 있는 사례는 source text 의미 판별 벤치이며 구조 atom 생성 자체를 보증하지 않습니다. v0.14.1 공식 suite의 16건은 실제 relation과 제품 target 2건, 실제 atom을 운반하는 평가 target bridge 1건, 구조가 없는 source bridge 13건으로 분리 표시합니다. 매 준비 요청의 target/source/atom/relation ID를 SHA-256으로 고정된 structural gate와 exact 비교하고, 구조 양성 provider 응답은 실제 atom/relation ID 귀속까지 요구합니다. 별도 10건 fixture도 source/atom/relation ID와 closure를 검증합니다. 말투·안전은 아직 정적 atom 분류가 없으므로 구조 경로 통과로 표기하지 않습니다. 현재 점수는 category·target/source 집합·evidence 범위를 평가하지만 severity·confidence와 title·summary·rationale의 의미 정확성까지 자동 채점하지 않습니다. 구체적인 실행·중단·기록 규칙은 [`SEMANTIC-PROVIDER-MANUAL-EVALUATION.md`](SEMANTIC-PROVIDER-MANUAL-EVALUATION.md)에 따릅니다.

따라서 이 결정적 회귀는 평가 도구와 고정 reference 예시의 일관성을 검증할 뿐, 네트워크에서 실행되는 특정 provider·model의 사실성·안전성·품질을 CI가 보증한다는 뜻은 아닙니다.

취소와 timeout은 논리적입니다. adapter는 호출자 promise를 `SEMANTIC_ABORTED` 또는 `SEMANTIC_TIMEOUT`으로 종료하고 뒤늦은 결과를 UI·cache에 반영하지 않지만, 공개 profile `sendRequest()`와 `generateRaw()`에는 provider 계산을 강제로 중단하는 공통 계약이 없으므로 이미 시작된 계산·과금을 되돌린다고 보장하지 않습니다. gate ticket은 underlying 호출이 먼저 끝나면 즉시 해제하고, 그렇지 않으면 요청 timeout보다 30초 긴 bounded TTL까지 유지해 경계 시점의 늦은 self-capture를 막습니다. adapter는 raw 결과를 노출하지 않는 `whenIdle()` lease를 유지하고 공식 harness의 inspector 단위 mutex는 underlying settlement 전까지 새 세션을 거부합니다. 새 시도는 settlement 뒤 새 nonce와 새 준비·미리보기·동의를 사용합니다.

AI 요청은 캐릭터 설명·성격과 페르소나의 구분을 모델이 추측하지 않도록 원본 metadata 전체 대신 제한된 `profileKind`(`character-description`, `character-personality`, `persona`)만 전달합니다. 고정 system prompt는 서로 다른 참가자의 프로필이 같은 항목·제목·문체를 공유한다는 이유만으로 유사·중복·충돌을 제안하지 않도록 지시하되, 같은 응답 행동에 대한 실질적인 지시 충돌 근거가 있으면 계속 보고하게 합니다.

AI prompt와 동시에 식별자 없는 일반 사용자 요청이 도착해 어느 요청인지 안전하게 구분할 수 없으면 gate와 기존 generation ledger 모두 임의 FIFO 연결을 하지 않습니다. explicit public ID가 있는 정상 사용자 요청은 그대로 정확 연결합니다. 이 fail-closed 경계는 AI 호출을 숨기기 위해 다른 사용자의 capture를 소비하는 것을 막습니다.

v0.11.1에서는 semantic payload 탐색을 최대 2MiB·8,192개 노드·4,096개 문자열로 제한합니다. 이는 기존 256개 문자열 경계 때문에 긴 일반 채팅 prompt 자체가 폐기되던 회귀를 막으면서도, 새 상한을 넘겨 nonce exact match 여부를 증명할 수 없는 입력은 `skipped-safety`로 닫아 AI 원문이 스냅샷으로 들어가지 않게 합니다.

### 정책 V2 모듈 경계

| 모듈 | 책임 | 변경하지 않는 것 |
|---|---|---|
| `comparison-policy.js` | 정책 V2 정규화·V1 이전, 적용 프로필 정렬, 그룹 정의·이름 matcher·수동 지정 해석, 소스 annotation과 그룹 비교 정책 계산 | 스냅샷 원본, SillyTavern 프롬프트 |
| `profile-context.js` | 전체·프리셋·캐릭터·채팅 범위의 버전 지정 지문과 표시 label 생성·정규화 | 원시 범위 ID를 정책 키로 직접 노출 |
| `policy-io.js` | 버전 지정 정책 문서의 생성·직렬화·엄격한 검증, 현재 상태를 건드리지 않는 가져오기 초안 생성 | localStorage 쓰기, 스냅샷 백업·병합 |
| `policy-preview.js` | 변경 전·후 규칙 설정과 정책을 각각 분석해 finding 증감과 소스별 배정 변화를 계산 | 저장된 정책, 스냅샷 |
| `finding-review.js` | 의미 기반 finding 키·더 넓은 suppression 키, 유효·오탐 판정, 범위별 항상 무시와 세션 한정 숨김 해석 | 분석 finding과 소스 원문 |
| `audit-log.js` | 설정 전·후 digest와 제한된 요약만 담는 로컬 변경 기록의 정규화·상한 관리 | 원문·근거·정책 전체 내용, 변조 방지 보안 감사 |

`comparison-policy.js`의 정책 V2 문서는 `profiles`를 루트로 하며 각 프로필은 `scope`, `priority`, 재사용 가능한 `groupDefinitions`, 순서가 있는 `matchers`, `manualAssignments`를 가집니다. 그룹 동작과 이름 해석을 분리하므로 하나의 그룹 정의를 여러 템플릿·정규식 matcher와 수동 지정이 참조할 수 있습니다. V1의 이름 규칙과 수동 지정은 결정적으로 하나의 전역 V2 프로필로 이전합니다.

### 범위와 소스 배정 우선순위

현재 스냅샷과 일치하고 활성화된 프로필만 다음 순서로 평가합니다.

1. 채팅
2. 캐릭터
3. 프리셋
4. 전체

같은 범위에서는 숫자가 큰 `priority`를 먼저 평가하고, 값도 같으면 문서에 있는 순서를 유지합니다. 각 프로필에서는 identifier를 우선하는 수동 지정을 먼저 찾고, 없으면 이름 matcher를 위에서부터 평가해 첫 일치를 사용합니다. 한 프로필에서 소스가 일치하지 않으면 더 넓은 다음 프로필로 계속 내려갑니다. 일치한 그룹의 동작이 `대안 그룹`이면 해당 범주의 내부 원자 쌍만 제외하고 여러 옵션이 실제 요청에 포함될 때 그룹 경고 한 건을 만듭니다. `내부 무시`는 내부 쌍과 이 경고를 모두 숨기며, 두 동작 모두 그룹 밖 소스와의 비교는 유지합니다.

수동 지정은 가능한 경우 설정 identifier를 사용합니다. identifier가 없는 과거 소스는 순서·문자 오프셋을 제외한 보조 지문값을 사용하지만, 현재 스냅샷에서 같은 지문값이 둘 이상이면 오적용하지 않고 해당 지정을 건너뜁니다. 구형 source ID·label 연결은 이전 데이터 호환을 위한 마지막 대체 경로입니다.

`profile-context.js`는 원시 범위 값을 NFKC·공백·대소문자로 정규화한 뒤 결정적인 불투명 지문으로 바꿉니다. 프리셋은 가능한 경우 API namespace를 함께 사용합니다. 채팅 범위는 같은 chat ID가 다른 소유자에게 재사용되는 충돌을 줄이기 위해 그룹 또는 캐릭터 소유자와 chat ID를 함께 지문화하며, 그룹 컨텍스트가 있으면 그룹을 우선합니다. 소유자 정보를 얻지 못한 구형 경로는 chat ID만 지문화합니다.

이 지문은 안정적인 로컬 연결 키이지 암호학적 익명화 수단이 아닙니다. 화면용 label에는 프리셋·캐릭터·채팅 이름이 들어갈 수 있고 정책 파일에는 프로필 label과 수동 지정 label이 포함될 수 있으므로 공유 전 검토해야 합니다.

### 변경 미리보기와 검사 결과 검토

`policy-preview.js`는 저장된 규칙·정책과 편집 중인 규칙·정책을 독립적으로 분석합니다. finding은 위치가 아니라 의미 키의 multiset으로 비교해 새로 나타남·사라짐·유지됨을 계산하고, 소스 지문별 정책 signature를 비교해 프로필·그룹·옵션·배정 방식 변화를 찾습니다. 미리보기는 revision과 스냅샷 정보로 캐시하며 닫힌 영역은 지연 렌더링하고 소스 카드는 최대 100개만 표시합니다. 분석 상한에 닿은 경우 `truncated` 상태를 함께 전달합니다.

`finding-review.js`는 위치·표시 문구를 제외하고 규칙·관계·소스 지문·의미 근거 digest를 조합한 정확한 `finding:v1` 키를 만듭니다. `유효`와 `오탐`은 이 정확한 키에 저장합니다. `항상 무시`는 이후 동등한 캡처에도 적용되도록 더 넓은 `suppression:v1` 키와 전체·프리셋·캐릭터·채팅 범위를 사용합니다. 정확한 `유효` 판정은 적용 가능한 더 넓은 무시보다 우선하고, `이번만 숨김`은 저장하지 않는 현재 패널 메모리 집합입니다. 의미 근거·규칙·관련 소스 구성이 바뀌면 키도 바뀌므로 이전 판정이 재적용되지 않을 수 있습니다.

### 정책 파일, 초안 적용과 저장 경계

정책 파일은 `st-devtools-rule-inspector-config` 형식 버전 1 envelope 안에 규칙 설정 스키마 v1과 비교 정책 스키마 v2를 필수로 담고, 검사 결과 판정 스키마 v1은 사용자가 선택했을 때만 담습니다. 프롬프트 원문과 로컬 감사 기록은 내보내지 않지만 프로필·그룹·패턴·수동 지정의 식별자와 label, 선택한 판정 키는 포함될 수 있습니다.

`policy-io.js`는 파일 전체를 검증한 뒤에만 호출자 상태와 분리된 `nextState`를 만듭니다. 검증 실패는 현재 UI 상태와 localStorage를 변경하지 않습니다. 정상 파일도 즉시 저장하지 않고 pending 규칙·정책·판정 초안으로 올린 뒤 `policy-preview.js` 결과를 사용자가 확인하도록 합니다. 판정 component가 없는 파일은 기존 판정을 유지하고, 가져온 판정의 내부 감사 항목은 기존 로컬 항목을 유지합니다.

사용자가 `설정 적용`을 누르면 UI는 다음 네 키를 하나의 적용 단위로 취급합니다.

- `st-devtools:rule-settings:v1`
- `st-devtools:comparison-policy:v2`
- `st-devtools:finding-reviews:v1`
- `st-devtools:rule-audit:v1`

적용 전 네 값을 메모리에 백업하고, 새 값을 각각 기록한 뒤 read-back으로 같은 문자열인지 확인합니다. 모두 확인된 뒤에만 메모리의 저장 상태를 교체하고 V1 정책 키를 제거합니다. 중간 쓰기나 검증이 실패하면 메모리 상태를 되돌리고 각 키를 백업 값으로 복원하려고 시도하며 초안을 dirty 상태로 유지합니다.

localStorage는 여러 키를 묶는 트랜잭션을 제공하지 않습니다. 따라서 이 흐름은 검증된 일괄 적용과 보상 복원을 제공하지만 ACID 원자성을 보장하지 않으며, quota·브라우저 저장소 장애로 복원 쓰기까지 실패하면 일부 키가 바뀐 채 남을 수 있습니다. V1 키 제거도 성공 경로에서만 수행합니다.

### 정책 입력·저장 안전 한계

- 입력 JSON은 1 MiB, 정규화 결과는 768 KiB, 깊이는 10, 전체 노드는 20,000으로 제한합니다.
- 프로필은 64개, 프로필별 그룹 정의·matcher는 각각 100개, 프로필별 수동 지정은 500개로 제한합니다. 전체 그룹·matcher는 각각 500개, 전체 수동 지정은 2,000개, 가져오는 판정은 2,000개가 상한입니다.
- 알 수 없는 필드, `__proto__`·`constructor`·`prototype` 키, 지원하지 않는 버전, 중복 ID, 끊어진 그룹 참조, 허용되지 않은 범위·동작·검사 범주를 거부합니다.
- 정규식 이름 matcher는 검색과 같은 길이·복잡도 정적 검사를 통과해야 합니다. 이 검사는 알려진 고위험 구조를 줄이는 경계이며 임의 정규식의 실행 시간을 수학적으로 보장하지는 않습니다.
- 미리보기와 정적 Rule Inspector는 자연어 의미 전체, 조건 논리, 실제 우선순위 승자를 판정하지 않습니다. 분석 상한 이후의 원자·관계는 생략될 수 있습니다.
- 로컬 감사 기록은 최대 200건·256 KiB이며 설정 전체 대신 digest와 제한된 요약을 저장합니다. 같은 브라우저 사용자가 수정·삭제할 수 있으므로 보안 로그나 부인 방지 기록이 아닙니다.
- 정책 가져오기는 Rule Inspector 설정 초안 교체입니다. IndexedDB 스냅샷 백업·복원, 타임라인 병합, 현재 정책과의 자동 merge 기능은 아닙니다.

## 다섯 기능 단층 하단 내비게이션

`DevToolsWindow`는 `전송 프롬프트`·`기록`·`변경 비교`·`규칙 검사`·`검색` 다섯 실제 renderer를 하나의 하단 tablist에 일대일로 연결합니다. v0.12.0의 4개 그룹과 조건부 하위 tablist, v0.12.1의 독립 `요청 상세` 진입점은 사용하지 않습니다. 어느 화면에서나 한 번의 선택으로 같은 기능을 열며 `last-tab`에는 실제 탭 ID만 저장합니다. 제거된 `context` 값은 탭 검증 단계에서 `explorer`로 안전하게 대체합니다. 선택 상태와 roving `tabindex`, 좌우 화살표·Home·End 이동도 다섯 기능 전체에서 동일합니다.

패널 grid는 `헤더 / minmax(0, 1fr) 콘텐츠 / 하단 내비게이션` 세 행입니다. 중앙 콘텐츠만 스크롤되며 하단 tablist는 콘텐츠에 가려지거나 함께 스크롤되지 않습니다. 각 화면은 실제 기능 이름의 `h1`을 먼저 렌더링하고 짧은 설명은 제목 옆 tooltip으로 제공합니다. tooltip은 PC hover·키보드 focus·모바일 click을 지원합니다. 헤더 상태 점은 기존 `capture-status`의 bounded 상태를 시각화할 뿐 payload·저장·재시도 계약을 바꾸지 않으며 짧은 상태 문구와 접근 가능한 이름을 함께 유지합니다.

`전송 프롬프트`는 스냅샷 목록보다 먼저 현재 요청의 총 토큰, 컨텍스트 사용률 progress, 남은 컨텍스트와 provider/model을 같은 overview card에 표시하고 카드 안에서 스냅샷을 바꿉니다. 프리셋 그룹은 기본 접힘이며 `요청 포함만`은 configured source 중 `included === true`인 항목만 화면에서 걸러냅니다. 최종 mapping에 쓰는 전체 source map은 필터와 무관하게 유지합니다. 독립 요청 상세 탭에서 보존한 생성 설정과 프롬프트 payload는 전송 프롬프트 아래의 lazy disclosure에서 읽습니다. 이 UI는 저장된 값만 읽으며 새 분석이나 provider 호출을 시작하지 않습니다. 다른 네 화면에는 중복 hero를 만들지 않고 성장 그래프·비교 선택기·규칙 요약·검색 입력을 각 화면의 첫 작업 블록으로 유지합니다.

700px 이하에서는 창을 `100vw`·`100dvh` 앱 셸로 만들고 border·radius·resize를 제거하며 하단 내비게이션에 safe area를 포함합니다. 430px 이하 헤더 action은 시각 아이콘 크기와 별개로 44px 터치 영역을 유지하고 상단 safe area를 반영합니다. `usesCompactLayout()`이 참이면 데스크톱 geometry를 복원하지 않고 ResizeObserver의 geometry 저장을 건너뛰며 header pointerdown도 drag 상태를 만들지 않습니다. 데스크톱에서는 기존 geometry 복원·저장, resize와 drag가 유지됩니다.

설정 모달은 열 때 입력칸을 자동 focus하지 않고 패널 컨테이너로 focus를 옮기며 기존 focus trap·복원 경계를 유지합니다. 상단 닫기 버튼, 바로 보이는 자주 쓰는 설정과 접힌 고급 설정을 유지하고 테마 선택은 해당 preference만 즉시 저장합니다. AI opt-in·연결 프로필·응답 상한은 규칙 검사 화면의 AI 모드에서 변경하며 대상 선택·미리보기·호출별 동의 전에는 네트워크 경로를 열지 않습니다. 규칙·비교 정책 설정은 제목의 설정 버튼이 여는 별도 dialog에 렌더링합니다. 430px 이하의 프롬프트 비교는 같은 diff 데이터를 간결한 표로 재배치하며 분석 결과나 비교 의미를 바꾸지 않습니다.

v0.15.8의 선택형 hands-on 실습은 위 정보 구조에 분리 더미 view session을 연결하고 실제 control로 캡처와 다섯 화면을 연습하게 합니다. 읽기 전용 briefing은 dim·target ring·점선 화살표와 두 개의 짧은 설명을, interactive practice는 밝은 실제 화면에서 기능 의미·사용 맥락·할 일과 DOM control을 한 번에, debrief는 녹색 result ring·성공 문구·관찰 결과를 제공합니다. 하단 기능 내비게이션의 측정 높이를 이전·다음 위치와 본문 scroll 여백에 공유하고 comparison disclosure는 practice에서 카드 전체를 강조합니다. 빠른 시작과 tooltip은 hands-on 실습을 대체하지 않고 각 화면에서 필요한 짧은 보조 설명으로 유지합니다.

## 내부 고대비 테마와 호스트 격리

SillyTavern 테마의 `--SmartThemeBlurTintColor`에는 알파 값이 포함될 수 있으므로 패널 배경에 직접 사용하지 않습니다. 자동 모드에서는 본문 글자의 계산된 명도를 확인한 후 밝은 글자에는 어두운 패널, 어두운 글자에는 밝은 패널을 사용합니다. 사용자는 같은 설정 저장소에서 패널을 항상 밝게 또는 항상 어둡게 고정할 수 있으며, 고정 모드에서는 매 렌더마다 SillyTavern 색상을 다시 계산하지 않습니다.

v0.12.0은 패널 내부의 배경·본문·보조 글자·테두리·상태·강조 색을 밝은/어두운 고대비 토큰으로 정의합니다. v0.12.1은 패널 범위의 form selector 특이도를 높여 호스트가 extension stylesheet 뒤에 `!important` 배경·색을 선언해도 패널 토큰이 우선하도록 보강했습니다. 패널의 `button`·`select`·`.menu_button`·표·상태 요소는 폭·flex·writing-mode·색·배경 등 필요한 속성을 명시해 SillyTavern 전역 테마의 세로 글자·강제 전체 폭·저대비 색 규칙이 내부 control을 덮지 못하게 합니다. 이 격리는 UI 표현에 한정되며 SillyTavern 문서 바깥의 스타일이나 저장 데이터에는 영향을 주지 않습니다.

구버전 스냅샷의 매크로 템플릿 provenance는 브라우저 정규식 엔진이 안전하게 처리할 수 있는 길이까지만 시도합니다. 정규식 생성 또는 실제 매칭 시점에 엔진 한계가 발생하면 스냅샷 마이그레이션 자체를 실패시키지 않고 해당 소스만 `unmatched`로 유지합니다.
