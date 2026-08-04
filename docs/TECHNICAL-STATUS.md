# v0.16.2 기술 구현 현황

## v0.16.2 튜토리얼 안정화·설명서 도식·고급 가이드 확장

- 완료 debrief는 target과 분리된 불투명 고대비 surface와 stacking context를 사용합니다. 아래 화면의 글자와 success copy가 겹치지 않으며 밝음·어두움 테마 모두에서 제목·관찰 결과·다음 control의 대비를 유지합니다.
- 검색 튜토리얼은 넓은 snapshot select를 강조할 때도 패널의 실제 가시 폭을 기준으로 target과 guide 위치를 제한합니다. 320px·390px에서 문서 폭이나 viewport를 왼쪽으로 밀지 않고 가로 overflow 없이 원래 중앙 정렬을 유지합니다.
- 도움말 홈 카드의 별도 `action` copy를 제거했습니다. 제목·설명·우측 화살표와 카드 전체 button만 남겨 파란색 `… 보기` 문구의 중복을 없앴습니다. 툴팁의 `자세히 보기` deep link는 유지합니다.
- `HELP_TOPIC_VISUALS`는 `HELP_TOPICS` 19개와 1:1로 대응하는 immutable registry입니다. 각 항목은 `flow`·`comparison`·`lanes` 유형, 접근 가능한 설명과 caption, 의미 관계를 가진 lane·item으로 구성되며 외부 이미지 URL이나 고정 색상값을 저장하지 않습니다.
- 기능 설명서 renderer는 캡처 상태, 원본→최종 prompt, 필터, 근거 위치, 검사 결과, 비교 정책, AI 전송·검증, 채팅 분기, 성장 그래프, diff 상태, 검색, 보관·개인정보, payload, atom/relation, provider 평가, 저장 도구, FAQ의 흐름과 전후 대조를 테마 token 기반 미니 도식으로 표시합니다.
- 비교 정책 guide는 9단계로 확장해 profile 적용 범위·현재 적용 순서·대안/내부 무시 동작·이름 matcher·수동 지정·수동 우선순위·미리보기·결과를 다룹니다. AI 의미 검사 guide는 10단계로 확장해 후보 선택·연결 profile·응답 상한·prompt/prefill·전송 미리보기·포함/제외 범위·매회 동의·검증·폐기 결과를 다룹니다.
- `ADVANCED_ONBOARDING_GUIDES`에는 검사 결과 판정과 예외 관리 7단계, Atom·Relation 근거 읽기 7단계, 대안 그룹 교체 비교 6단계가 추가되었습니다. 오탐·이번만 숨김·범위별 항상 무시·복원, atom/relation과 원문 근거, 정책 전후의 추가/삭제→교체 전환을 실제 화면형 더미 UI에서 안내합니다.
- 다섯 고급 guide는 각각 독립 checkpoint와 session state를 사용하고 실제 review decision, comparison policy, snapshot store, `SemanticInspector`, Connection Manager, provider, network와 비용 경로를 호출하지 않습니다. 완료·중단은 첫 실행 전체 안내의 `completed`·`skipped` 상태도 변경하지 않습니다.

## v0.16.1 세 갈래 도움말·부분 투어·고급 코치마크

- 도움말 route는 `home`·`basic`·`advanced`·`docs`로 나뉘며 첫 화면에는 `기본 사용법`·`고급 기능 가이드`·`기능 설명서` 세 진입점만 렌더링합니다.
- `BASIC_ONBOARDING_SECTIONS`는 프롬프트 13·기록 6·비교 7·검사 7·검색 5단계의 순서·표시 수·시작 checkpoint를 정의합니다. 전체 38단계 안내와 같은 step renderer·interaction 판정을 재사용합니다.
- `createOnboardingSession({ checkpoint })`는 부분 투어가 요구하는 timeline 길이, 선택 snapshot, 캡처 완료 상태를 준비합니다. 따라서 기록·비교·검사·검색을 바로 시작해도 앞 장 조작을 반복하지 않습니다.
- 온보딩 route는 전체·기본 section·고급 guide를 구분하고 persistence flag를 별도로 둡니다. section·advanced의 완료·종료·건너뛰기는 전역 온보딩 `completed`·`skipped` 상태를 쓰지 않습니다.
- `ADVANCED_ONBOARDING_GUIDES`는 비교 정책 5단계와 AI 의미 검사 6단계를 실제 규칙 검사 화면 형태로 렌더링합니다. 이름 matcher·대안 그룹·profile·prompt·prefill·동의·결과는 더미 session에만 존재합니다.
- 고급 guide는 `SemanticInspector`, provider adapter, Connection Manager, `fetch`, snapshot store, 실제 비교 정책 저장과 비용 경로를 호출하지 않습니다. guide 전환·닫기에서 timer와 session을 폐기합니다.
- `helpTooltip(..., { helpTopicId })`은 짧은 설명과 텍스트형 `자세히 보기`를 렌더링하고 같은 dialog의 해당 상세 문서 topic으로 deep link합니다. 프롬프트 위치·포함 필터·성장 그래프·비교 정책·AI 의미 검사·검색·보관·개인정보·저장 도구에 topic이 연결됩니다.
- 도움말 dialog의 focus trap·Escape·원래 focus 복원, 320px·390px 모바일 단일 scroll owner·가로 overflow 없음, 밝음·어두움 테마 대비와 tooltip keyboard focus를 자동·브라우저 회귀 대상으로 둡니다.

## v0.16.0 도움말·연습실·교체 판정

- `HELP_TOPICS`는 다섯 화면과 캡처·설정의 14개 기능 문서를 immutable registry로 제공하고 현재 화면 필터, 전체 검색, 최근 읽은 3개 항목을 지원합니다.
- 기존 상단 안내 launcher는 하단 탭을 늘리지 않고 `도움말·연습` dialog를 엽니다. 기능 제목의 책 아이콘도 같은 문서로 deep link하며 기존 `?` tooltip은 짧은 설명 전용입니다.
- 비교 정책 연습실은 네 개의 고정 소스와 순수 `create/updateHelpLabSession()` 상태 전이로 이름 matcher·대안 그룹·전후 결과를 체험합니다.
- AI 의미 검사 연습실은 고정 후보·전송 미리보기·동의·running timer·검증 결과·폐기 예시를 재현합니다. store, saved policy, `SemanticInspector`, provider adapter, network와 비용 경로는 사용하지 않습니다.
- 도움말 modal은 별도 focus scope, Escape, 원래 focus 복원과 timer stale-session guard를 가지며 모바일에서는 전체 화면·단일 body scroll을 사용합니다.
- diff 입력 source는 저장된 비교 정책으로 주석화한 뒤 Worker 또는 local runtime에 전달합니다. 정확한 source identity의 내용·배치·alternative 분류 변화는 `changed`, 서로 다른 source identity 사이의 안전한 alternative option 1:1 활성 전환은 `replaced`입니다.
- 교체 pairing은 group instance, 서로 다른 non-empty option, 기준/비교의 활성 group cardinality 1을 모두 요구합니다. 하나라도 확인되지 않으면 added+removed를 유지합니다.

## v0.15.8 이전 이동·비교 spotlight 보정

- 설명·결과 modal footer와 practice 화면에 같은 `previousOnboardingStep()`을 사용하는 이전 control을 둡니다. 첫 단계에서는 비활성화하고, 완료한 상호작용 단계로 돌아갈 때는 `debrief`, 아직 수행하지 않은 단계에서는 해당 entry stage로 복귀합니다.
- 이전 이동이 실행 중인 연습 캡처를 벗어나면 timer와 대기를 취소하고 안전한 대기 상태로 되돌립니다. 종료 시 modal·practice 이전 control과 viewport listener도 함께 정리합니다.
- `positionOnboardingGuide()`는 `.st-devtools-app-nav`의 실제 높이를 읽어 CSS 변수로 공유합니다. 이전·다음 control은 이 높이 위에 놓이고 본문에는 같은 값만큼 임시 하단 공간을 만들어 마지막 target도 control 뒤에 숨지 않습니다.
- `focusOnboardingTarget()`은 practice 이전 control의 상단을 본문 가시 영역 하한으로 사용합니다. viewport 크기가 바뀌면 활성 target을 다시 보이는 위치로 옮긴 뒤 spotlight를 재계산합니다.
- toggle practice는 interaction selector인 `<details>` 전체를 강조해 `.st-devtools-source-change { overflow: hidden; }` 안에서 summary outline이 잘리는 문제를 피합니다. 완료 debrief는 기존처럼 새로 펼쳐진 본문을 강조합니다.
- 비교 결과의 비동기 렌더가 끝나면 현재 단계가 comparison인지 확인해 target을 다시 연결합니다. 320×640·390×844에서 6개 comparison 조작 target이 각각 하나이며 spotlight가 보이고 target·dock·이전 control이 겹치지 않음을 검증했습니다.

## v0.15.7 직접 체험 진입·이벤트 판정 보정

- interaction이 있는 단계의 entry stage는 `practice`, 읽기 전용 단계는 `briefing`으로 계산합니다. interactive 단계에는 별도 `직접 해보기` 화면을 만들지 않고 실제 target과 기능 이름·의미·사용 맥락·할 일을 함께 렌더링합니다.
- practice에서 정확한 control을 조작하면 자동으로 `debrief`에 들어가며, 사용자가 `다음`을 누르는 곳은 읽기 전용 briefing과 조작 완료 debrief뿐입니다.
- 설명·결과 panel의 종료 control을 footer에서 panel 우측 상단으로 옮겼습니다. practice 종료 control도 같은 위치를 사용하고, host theme의 `display` 강제 규칙보다 높은 `[hidden] { display: none !important; }` 경계로 동시에 두 개가 보이지 않게 합니다.
- capture phase에서 받은 click은 `setTimeout(0)`의 다음 task에서 판정합니다. callback은 같은 onboarding session, 같은 step ID, `practice` phase를 다시 확인해 이전 상태 판정과 지연 callback의 다음 단계 오완료를 모두 방지합니다.
- `explorer-included-filter`는 `aria-checked="true"` 계약을 유지하고 실제 pointer 한 번의 `false → true` 전환 뒤 debrief로 이동합니다. 반대 `true → false` 전환은 완료로 인정하지 않습니다.
- 320×640과 390×844 브라우저 viewport에서 단일 우측 상단 종료 control, 가로 overflow 없음, practice dock 내부 scroll 없음과 실제 pointer 상호작용을 검증했습니다.

## v0.15.6 코치마크 설명·상태·성공 피드백

- 첫 초대는 구체 사례의 JSON·XML 용어보다 사용자가 해결할 ‘예상과 다른 답변의 원인 찾기’를 먼저 설명합니다. JSON·XML은 실제 원문을 읽는 단계에서만 사례로 소개합니다.
- briefing renderer는 기존 `what` 첫 문장과 `when` 또는 읽기 단계의 `task` 첫 문장을 분리해 기능 의미와 사용·확인 맥락을 함께 보여 줍니다.
- panel형 캡처 action은 이름이 보이는 44px 가로 버튼이며 실행 중에는 `aria-busy`, 비활성 상태, spinner와 `캡처 진행 중…`을 표시합니다. 320px에서는 지시문 아래 전폭 버튼으로 배치합니다.
- `synchronizeOnboardingStepCompletion()`은 practice 진입 때 value·checked·open 조건이 이미 충족됐는지 일반적으로 검사합니다. panel형 action은 실제 실행 전 자동 완료하지 않습니다.
- toggle 완료 뒤 `onboardingVisualTarget()`은 열린 disclosure의 첫 non-summary body를 결과 target으로 선택합니다. spotlight geometry는 body와 콘텐츠 viewport의 교차 영역을 사용해 긴 본문이 전체 화면을 덮지 않습니다.
- interactive debrief는 단계 제목과 `잘했어요!`·관찰 결과를 분리하고 녹색 result spotlight를 사용합니다. 마지막 읽기 단계도 사용자가 익힌 조사 흐름과 연습 데이터 종료를 명시합니다.
- copy·practice dock·spotlight geometry·success mark는 180~420ms one-shot animation만 사용하며 practice target pulse는 2회 뒤 정적 ring으로 남습니다. `prefers-reduced-motion`에서는 모든 새 animation을 제거합니다.

## v0.15.5 레퍼런스형 코치마크

- 제품 위에 뜨던 흰색 auto-height sheet와 내부 스크롤, 장별 진행률, 위치·무엇·언제, 펼침 설명과 텍스트 버튼 묶음을 제거했습니다.
- briefing·debrief는 전체 dim, 최소 52×44px target spotlight, 점선 화살표, 제목과 한 문장, 원형 종료·다음 버튼과 `현재 / 38`만 렌더링합니다.
- practice는 modal·dim·`inert`를 해제하고 실제 target의 고대비 pulse ring과 한 줄 지시만 유지합니다. panel형 캡처 데모만 원형 실행 버튼을 함께 표시합니다.
- 상호작용 30개는 실제 click/change/input/toggle 뒤 자동 debrief로 전환하고, 읽기 전용 8개는 fake practice·확인·debrief 없이 한 번의 briefing으로 완료합니다.
- 기존 38단계 fixture 격리, focus trap·복원, 실제 store·provider·Semantic Inspector·clipboard·export 비접근 계약을 유지합니다.
- 최소 상태 키는 `st-devtools:onboarding:v5`이고 `skipped` 또는 `completed`만 저장합니다.

## v0.15.4 briefing → practice → debrief 단계 흐름

- v0.15.3의 항상 표시되는 guided rail을 제거하고 38개 단계 각각에 `briefing → practice → debrief` phase state를 둡니다.
- briefing은 제품 화면을 dim하고 실제 target만 spotlight한 modal surface에서 목적·위치·짧은 설명을 제공합니다. debrief는 같은 시각 경계에서 감지된 결과와 의미·다음 조사 연결을 표시합니다.
- practice는 dim·modal·`inert`를 해제하고 실제 제품 화면과 compact task dock만 유지합니다. 현재 단계와 관계없는 control도 사용할 수 있고 실제 button·input·select·disclosure `summary` 이벤트만 관찰해 완료를 판정합니다.
- 첫 초대·briefing·debrief는 focus trap과 제품 영역 `inert`/`aria-hidden`을 사용하고, practice 진입과 이전·다음·건너뛰기·종료 때 phase별 focus를 정리하거나 시작 전 위치로 복구합니다.
- 모바일의 190~260px rail clamp를 제거했습니다. 320px·390px 폭에서는 briefing·task dock·debrief를 내용 기반 auto-height sheet로 표시하고 viewport를 넘는 본문만 내부 스크롤합니다.
- 캡처 상태는 색상 점과 함께 짧은 copy·pill을 표시하며 연습 session에서 `대기 → 감지 → 저장 중 → 저장됨` 순서가 눈에 보이도록 갱신합니다.
- 캡처 3·전송 프롬프트 10·규칙 검사 7·기록 6·변경 비교 7·검색 5의 6개 주제·38단계, JSON → XML 사건, 920·1,080·1,248 토큰 fixture는 유지합니다.
- 현재 최소 상태 키는 `st-devtools:onboarding:v4`이고 `skipped` 또는 `completed`만 저장합니다. 실제 snapshot store·provider·Semantic Inspector·clipboard·export 비접근과 종료 시 live 상태 복구 계약도 유지합니다.

## v0.15.3 guided learning rail 전면 재설계

- 첫 실행 초대만 modal dialog와 `inert` 경계를 사용합니다. 실습을 시작하면 modal overlay를 닫고 실제 콘텐츠와 guided learning rail을 같은 workspace에 렌더링합니다.
- 데스크톱은 실제 콘텐츠 옆 side rail, 좁은 화면은 콘텐츠 위 top rail을 사용합니다. rail은 현재 장·6개 장 여정·전체/장별 진행률·현재 할 일·완료 기준·이전·다음·건너뛰기를 한곳에 유지합니다.
- floating coach panel·spotlight·대상 주변 자동 배치와 scroll/resize geometry 추적을 실습 경로에서 제거했습니다. 따라서 콘텐츠를 스크롤해도 안내가 화면 위를 따라다니거나 제품 control을 덮지 않습니다.
- 캡처 3·전송 프롬프트 10·규칙 검사 7·기록 6·변경 비교 7·검색 5의 6개 주제·38단계는 유지합니다. 전체 흐름은 `답변 형식이 JSON에서 XML로 바뀐 이유 찾기` 한 사건을 캡처부터 원본 검색까지 추적하도록 연결했습니다.
- 단계 완료 감지는 click/change/input/toggle 이벤트를 관찰할 뿐 현재 단계와 관계없는 control을 비활성화하거나 click/focus를 차단하지 않습니다. 사용자는 분리 연습 session 안에서 다른 제품 화면도 안전하게 탐색할 수 있습니다.
- target은 전체 카드가 아니라 실제 button·input·select 또는 disclosure의 직접 `summary`를 가리킵니다. rail의 `화면에서 보기`는 필요한 탭을 선택하고 target을 스크롤한 뒤 가능한 요소에 focus합니다.
- 새 rail 제안을 한 번 표시할 수 있도록 당시 최소 상태 키를 `st-devtools:onboarding:v3`로 올렸고 `skipped` 또는 `completed`만 저장했습니다.
- 920·1,080·1,248 토큰 fixture와 별도 mutable view session, 실제 snapshot store·provider·Semantic Inspector·clipboard·export 비접근, 종료 시 live 탭·선택·타임라인·캡처 상태 복구 계약을 유지합니다.

## v0.15.2 hands-on 안내 위치·가독성 안정화

- onboarding overlay는 패널 내부를 제외한 window 하위 scroll event를 capture 단계에서 수신하고, `requestAnimationFrame`으로 연속 위치 계산을 한 번으로 합칩니다.
- `ResizeObserver`가 현재 대상·안내 패널·콘텐츠 영역을 추적하며 단계 변경과 종료 때 관찰 대상을 정리합니다.
- 위치 엔진은 window와 대상의 교차 영역만 강조합니다. 교차 영역이 없으면 강조를 숨기고 가장 가까운 위·아래 가장자리에 복귀 전용 패널을 배치합니다.
- 데스크톱은 우·좌·아래·위, 700px 이하 화면은 아래·위 순서로 가용 공간을 평가하며, 들어가지 않으면 가장 넓은 방향을 선택해 본문 최대 높이를 제한합니다.
- 단계 본문은 행동 카드가 먼저 오고, 기능 정의·사용 시점은 native `details` 안에 둡니다. spotlight는 전체 화면 dim 대신 이중 테두리와 행동 라벨을 사용합니다.
- 1280×720, 390×844, 320×640 브라우저 좌표 검증과 offscreen·scroll listener·observer cleanup 회귀 계약을 갖습니다.

## v0.15.1 실제 제품 UI hands-on 온보딩 v2

- 8~12분 hands-on 실습이 캡처 3·전송 프롬프트 10·규칙 검사 7·기록 6·변경 비교 7·검색 5의 6개 주제·38단계로 실제 UI 대상을 순서대로 강조합니다.
- 각 단계는 `무엇인가요?`·`언제 쓰나요?`·직접 수행할 `할 일`을 분리합니다. 상호작용 단계는 실제 click/change/input/toggle을 완료해야 다음으로 이동하며 `이 단계 건너뛰기`를 선택할 수 있습니다.
- immutable fixture는 920·1,080·1,248 토큰의 실제와 닮은 스냅샷 3개, full privacy·provider/model·request/payload·range/provenance를 포함합니다. 두 번째에서 세 번째로 갈 때 소스 추가·수정·삭제와 JSON/XML 형식 충돌, 한국어 검색 일치가 모두 발생합니다.
- `createOnboardingSession()`은 실제 `timeline`·`selectedId`·`activeTab`과 분리된 mutable view state를 만듭니다. 초기에는 스냅샷 2개를 보이고 캡처 연습 뒤에만 세 번째를 session timeline에 추가하며 실제 제품 renderer와 로컬 rules/diff/search 경로가 이를 읽습니다.
- 실습은 실제 snapshot store의 추가·삭제·보관 작업과 provider·Semantic Inspector·clipboard·export를 호출하거나 변경하지 않습니다. 종료 시 session을 제거하고 live 탭·선택·타임라인·캡처 상태를 복구하며 실습 중 도착한 live 캡처가 있으면 후속 refresh합니다.
- 첫 실행 제안은 `new` 상태에서 한 번만 시도하고 전체 건너뛰기·완료만 `st-devtools:onboarding:v2`에 저장합니다. 중간 진행률·시각·연습 원문은 저장하지 않습니다.
- AI 의미 검사 또는 공식 Provider 평가가 활성 상태면 실습을 열지 않으며 실습 중 새 AI 실행도 차단합니다. 초대 dialog의 focus trap·복원·Escape·screen reader 상태와 hands-on coachmark·모바일 bottom sheet를 제공합니다.

## v0.14.1 공식 Provider harness·구조 경로 평가

- 규칙 검사 AI 연결 설정의 접힌 고급 도구에서 고정 합성 corpus 16건을 현재 연결 또는 선택 프로필로 한 건씩 실행합니다. 1회 smoke와 3회 품질 판정을 구분하며 자동 일괄 실행은 없습니다.
- harness는 `index.js`가 만든 동일 `SemanticInspector`만 주입받아 기존 adapter와 `SemanticCaptureGate`를 공유합니다. 별도 adapter·gate·fetch·SDK·API key 입력 경로는 없습니다.
- 각 사례는 `prepare → 구조 closure exact gate → 합성 원문/identity/digest 미리보기 → 초기화된 1회 동의 → cache 초기화 → inspect` 순서를 따릅니다. provider/model/route/profile identity 변경, 선택 profile의 current fallback, cache hit, 보정된 evidence offset과 구조 양성 응답의 atom/relation 귀속 누락은 실패로 중단합니다.
- 준비 identity는 adapter의 실제 전송 route에 결속됩니다. profile이 전송 직전에 사라지거나 current route가 profile로 바뀌면 capture gate를 열거나 provider를 호출하기 전에 실패합니다.
- 결과는 즉시 target/category/source/atom/relation/evidence offset만 평가기에 투영하고 원문·raw response·quote·제안 설명·opaque profile ID를 상태나 영구 저장소에 남기지 않습니다. 최대 48회, 응답 상한 2,048, 직렬 1건, 자동 retry 없음입니다.
- 동의 완료·전송 시도·검증 완료 수를 별도로 표시합니다. 논리 취소나 timeout 뒤에도 underlying provider 요청이 끝날 때까지 inspector 단위 lease를 유지해 새 일반 검사·평가 세션이 겹치지 않게 합니다.
- 1회 결과는 smoke일 뿐 공식 통과가 아니며, 같은 public provider/model/route 조합에서 3회 모두 통과해야 해당 단일 연결 셀의 품질 통과로 표시합니다. 다른 provider family나 모델로 일반화하지 않습니다.
- corpus version·16개 case ID·SHA-256 manifest를 고정합니다. 공식 suite의 구조 경로 분포는 실제 relation 제품 target 2건, 실제 atom을 운반하는 평가 bridge 1건, 구조가 없는 source bridge 13건입니다.
- 구조 제품 경로 fixture는 10건입니다. 조건·예외·역할·지시문·포맷의 실제 분석 relation 6건과 동일 언어·호환 역할·말투·안전 음성 경계 4건을 거쳐 `prepare()`의 source/atom/relation closure와 ID를 검사합니다.
- 확인된 공백: 말투와 안전 의미는 현재 정적 atom 분류가 없어 실제 relation-backed 일반 AI target을 만들지 못합니다. canonical provider corpus의 해당 사례는 source bridge를 사용하므로 이 결과를 구조 경로 통과로 표기하지 않습니다.
- provider timeout보다 gate ticket이 먼저 만료되지 않도록 호출별 ticket TTL은 timeout에 30초 여유를 둡니다.

## v0.14.0 합성 의미 평가·실제 provider 절차

- 합성 평가 corpus는 v2로 올라가며 6건에서 16건으로 늘어났습니다. 조건·예외·말투·역할·안전마다 충돌해야 하는 양성 1건과 충돌하면 안 되는 음성 1건을 추가하고 신규 사례를 한국어 5건·영어 5건으로 교차 배치했습니다.
- reference evidence의 quote와 source exact slice·기대 범위가 일치하는지, 다섯 의미 축의 양성/음성 쌍과 언어 균형이 유지되는지 자동 검사합니다.
- corpus `releaseGates`는 전체 평균과 별도로 각 축의 양성 exact issue match·기대 근거 pair 전부 적중·불필요한 근거 없음과 음성 제안 0건을 강제합니다. 한 축의 실패가 다른 축의 성적으로 희석되지 않습니다.
- corpus v2는 `releaseGates`가 필수라 구 평가기가 새 fixture를 지원 버전으로 오인하지 않습니다. 현 평가기는 gate가 없는 legacy v1만 종전 집계로 명시 지원합니다.
- category·target·source가 같은 복수 issue는 최대 issue 적중 수를 우선하고 그 안에서 근거 pair 적중 수가 최대가 되는 bounded 일대일 대응을 사용합니다.
- AI 고정 지침은 적용 범위·조건·예외를 먼저 비교하고, 양립 가능한 말투·서로 다른 참가자 역할·안전한 대안과 실제 금지 우회를 구분하도록 보강했습니다.
- 실제 provider 평가는 OpenAI·Anthropic·Google 계열과 현재 연결·Connection Manager 경로의 행렬, 개인정보 모드·매회 동의·identity·self-capture·비용·중단 기준을 갖춘 수동 절차로 분리했습니다.
- v0.14.0 당시 로컬 target 없는 음성 사례의 live 평가 공백은 v0.14.1 공식 harness로 해소했습니다. 다만 특정 provider/model의 실제 결과는 CI에서 호출하지 않으므로 사용자가 3회 세션을 끝내기 전까지 `미평가`입니다.

## v0.13.1 읽기 전용 복사·캐릭터/페르소나 구조 오탐 패치

- 프롬프트 원문·생성 설정·payload와 AI 제안을 각각 명확한 이름의 버튼으로 복사하며 SillyTavern 원본이나 정적 검사 상태를 변경하지 않습니다.
- Clipboard API 권한 거부 시 bounded fallback을 사용하고 성공·실패 알림을 분리합니다. 원문 복사 UI는 `full` 스냅샷에만 표시합니다.
- 정적 중복 검사는 source type과 character field를 기준으로 캐릭터 설명·성격과 페르소나 사이의 공통 프로필 문장만 제외합니다. 시나리오·첫 메시지·예시 대화·시스템·확장 소스는 기존처럼 비교합니다.
- AI 요청에는 원본 metadata 대신 제한된 `profileKind`만 전달하며, system prompt와 합성 평가 corpus도 서로 다른 참가자의 평행한 프로필 구조만으로 유사·중복·충돌을 제안하지 않는 음성 경계를 포함합니다.

## v0.13.0 AI 품질·provider 호환성 보강

- `semantic-evaluation.js`가 합성·익명 corpus의 검증된 AI 제안을 기대 issue와 일대일 대응해 유용성·오탐률과 같은 source에서 IoU 0.5 이상인 근거 pair 적중률을 계산합니다. 누락 사례·안전 provenance 위반·bounded 상한 초과는 실패로 닫고 보고서에는 원문과 quote를 넣지 않습니다.
- OpenAI 계열의 choices·Responses 출력, Anthropic content block, Google candidates parts와 공개 Connection Manager profile의 알려진 content 형식을 배열 prototype·길이·own key·data descriptor를 확인하는 bounded 절차로 정규화하고 알 수 없는 envelope는 거부합니다. 정규화 중 응답 객체가 제공한 iterator·slice·toJSON·accessor는 호출하지 않습니다.
- 이 검증은 SillyTavern 공개 API가 반환한 plain data를 다루는 경계이며, 같은 페이지 realm에 이미 삽입된 hostile Proxy의 meta trap 자체를 별도 process처럼 sandbox하지는 않습니다.
- HTTP 상태와 구조화된 공개 code만으로 인증·요청 한도·네트워크·timeout·일시 장애·기타 거부를 안정된 `SEMANTIC_*` code와 고정 reason으로 분류하며 원래 provider 오류 문구는 전달하지 않습니다.
- 구조화된 content filter·safety 거부와 지원하지 않는 응답 구조를 구분합니다. UI에는 한국어 설명, 공유 가능한 진단 code·reason, 사람이 읽는 근거 source 이름을 표시하고 검사 상태에 live status와 `aria-busy`를 제공합니다.

## v0.12.4 규칙·설정 UI 패치

- 미연결 활성 소스 알림은 `enabled` 또는 `configuredEnabled`가 루트·메타데이터에서 명시적으로 true이고 어떤 경계에서도 false가 아닌 소스만 포함합니다. 따라서 요청에 없는 캐릭터 첫 메시지처럼 활성 상태를 확인할 수 없는 소스는 오탐으로 표시하지 않습니다.
- 설정 패널은 모바일 폼·섹션 제목·그룹 내용·필드의 여백을 줄이되 고급 설정 disclosure의 44px 최소 터치 영역을 유지합니다.

## v0.12.3 안정화 패치

- 탭 이동과 데이터 변경의 분석 revision 수명주기를 분리해 AI 실행은 화면 전환에 유지하고 스냅샷·정책·설정 변경에서만 취소합니다.
- AI 추가 프롬프트와 응답 프리필은 별도 bounded 로컬 설정으로 저장하며, 고정 JSON·근거 계약 뒤에만 추가되고 요청 digest·캐시·호출별 동의 미리보기에 포함됩니다.
- 근거 검증은 AI offset이 틀린 경우에도 정확한 인용문이 선택 원문에 존재할 때만 bounded 검색으로 위치를 재정렬합니다. 원문에 없는 인용과 알 수 없는 ID·필드·스키마는 계속 전체 응답을 폐기합니다.
- Chat Completion `openai_max_context`와 공개 Text Completion 별칭을 캡처하며 요청 설정에 명시된 한도가 있으면 스냅샷 통계에서 우선합니다.
- 사용자 가격표 편집과 UI 재계산은 제거했습니다. 과거 키는 롤백 호환을 위해 자동 삭제하지 않지만 읽어 적용하지 않습니다.
- 성장 그래프는 최근 구간의 상대 편차가 18% 미만일 때만 확대 눈금을 사용하고 그 이상에서는 0 기준으로 복귀합니다.

## v0.12.2 프롬프트·검사 흐름 정리

- `context` renderer의 독립 탭 진입점을 제거하고 `explorer → timeline → diff → rules → search` 다섯 기능을 하단 tablist에 연결함. 이전 `last-tab=context` 값은 기존 탭 검증 fallback을 통해 전송 프롬프트로 이동함
- 요청 상세에서 유지할 `snapshot.request.settings`와 chat-completion `snapshot.payload` 또는 text-completion `snapshot.finalText`를 전송 프롬프트 아래의 lazy disclosure로 옮김. 스냅샷 schema·privacy 변환·archive 형식은 변경하지 않음
- configured prompt 그룹은 기본으로 접고 `source.included === true`인 실제 요청 포함 항목만 보는 필터를 추가함. 전체 source map은 유지해 필터가 최종 프롬프트 mapping을 훼손하지 않음
- 접힌 final source group을 먼저 mount한 뒤 범위를 찾도록 이동 경로를 보강하고 소스별 안정 색을 카드와 최종 범위에 함께 적용함
- 일반 설정의 테마는 변경 즉시 저장하며 AI 사용 여부·연결 프로필·응답 상한은 규칙 검사 흐름으로 이동함. AI 모드 전환만으로 provider 호출을 시작하지 않고 기존 대상 선택·미리보기·호출별 동의 경계를 유지함
- 규칙 검사 설정과 비교 정책은 결과 목록 아래에서 제거하고 제목의 설정 버튼이 여는 전용 dialog에 배치함

## v0.12.1 단층 하단 내비게이션 교정

- v0.12.0의 4개 그룹·조건부 하위 탭·그룹별 마지막 탭 상태를 제거하고 여섯 실제 renderer를 `전송 프롬프트`·`규칙 검사`·`기록`·`변경 비교`·`요청 상세`·`검색` 하단 tablist에 일대일로 연결함
- 선택 상태·roving `tabindex`·좌우 화살표·Home·End 이동을 여섯 기능 전체에서 하나의 계약으로 통일하고 기존 `last-tab` 값은 실제 탭 ID 그대로 재사용함
- 패널을 `헤더 / 스크롤 콘텐츠 / 고정 하단 내비게이션` 3행으로 구성하고 각 콘텐츠 화면에 실제 기능 이름 제목과 hover·focus·click 설명 tooltip을 추가함
- `전송 프롬프트`의 첫 블록은 총 토큰·컨텍스트 사용률 progress·남은 컨텍스트·provider/model·스냅샷 선택기를 합친 단일 요청 요약 카드로 구성함
- 700px 이하에서는 `100vw`·`100dvh` 앱 셸과 하단 safe area를 사용함. 모바일은 저장된 데스크톱 geometry를 복원하지 않고 geometry를 기록하지 않으며 pointer drag를 시작하지 않음
- 430px 이하 헤더 action의 터치 영역을 44px로 고정하고 상단 safe area를 반영함. 패널의 더 구체적인 form selector가 뒤에 선언된 호스트 `!important` 배경·색 규칙보다 우선함
- 데스크톱 geometry·resize·drag, 설정 모달, 캡처·저장·개인정보 모드와 Rule Inspector·선택적 AI의 대상 선택·미리보기·호출별 동의 경계는 변경하지 않음

## v0.12.0 초보자 중심 UI/UX 개편

- 각 화면의 우선 행동을 먼저 보이는 토스식 `한 화면·한 우선 행동` 정보 구조와 아이콘이 있는 `프롬프트`·`검사`·`기록`·`도구` 네 작업 탭을 적용함
- 헤더 이름 옆에 캡처 상태 점을 배치하고 상태 문구·접근 가능한 이름을 함께 유지함. 카드와 disclosure 요약 제목은 좌측 정렬하고 도움말 아이콘의 시각 크기를 줄임
- 패널 자체의 고대비 밝은/어두운 색 토큰을 사용하고 SillyTavern 호스트 테마의 광범위한 control·table·상태색 규칙으로부터 내부 UI를 격리함
- 설정 모달의 입력칸 자동 포커스를 제거하고 상단 닫기를 유지함. 자주 쓰는 설정은 펼치고 고급 설정만 접으며 백업·가져오기·저장소 관리는 단일 `데이터 도구` 진입점으로 정리함
- 검사 탭에 선택적 AI 의미 검사 opt-in을 인라인 배치함. 활성화는 설정 저장만 수행하며 provider 호출은 대상 선택·미리보기·호출별 동의 뒤에만 가능함
- 좁은 화면의 프롬프트 비교를 간결한 표 배치로 보강함. 빠른 시작과 tooltip은 유지하지만 코치마크·워크스루 온보딩은 아직 구현하지 않음

## v0.11.4 실제 요청 `undefined` 정규화 패치

- SillyTavern의 Chat Completion·Text Completion 생성 데이터가 정상적으로 포함하는 선택적 `undefined` 필드를 `null`로 정규화해 privacy `invalid-value` 실패를 제거함
- 메시지 `name`, OpenAI의 `logit_bias`·`n`·`reasoning_effort`·`verbosity`, TextGen의 `n_probs`·guided 설정·sampler/grammar 선택 필드를 실제 이벤트 형태로 검증함
- sparse array hole도 dense `null`로 정규화하며 Date는 재정의된 인스턴스 메서드를 실행하지 않고 표준 값만 ISO 문자열로 변환함
- 저장 전 finalizing/privacy 실패는 캡처 처리 오류로 설명하고, 저장할 snapshot이 없어 실행할 수 없는 재시도 버튼과 로컬 저장소 오류 오분류를 제거함

## v0.11.3 캡처 우선 저장 패치

- `SnapshotStore.updateSnapshot()`을 사용할 수 있는 실제 실행 환경에서는 최종 payload·finalText·usage와 단일 final source를 가진 최소 스냅샷을 먼저 privacy 변환·저장함
- `addSnapshot()` 직후 같은 partition과 ID를 `getSnapshot()`으로 다시 읽어 레코드·timeline index·schema migration을 함께 검증함
- 저장이 확인된 뒤 상세 source attribution과 tokenizer 계산을 유휴 작업으로 실행하고 같은 ID를 원자적으로 갱신함. generation lifecycle·provider usage 후속 갱신은 현재 저장값을 보존함
- finalText 50만 자, 후보 source 원문 200만 자, 후보 400개, 추정 match work 5천만 자 비교를 넘으면 상세 분석을 건너뛰고 최소 스냅샷을 유지함
- 캡처 sanitizer는 getter 예외와 unsupported primitive·binary view·비정상 숫자를 bounded JSON 값으로 바꿔 privacy validator와 IndexedDB structured clone 실패를 막음
- 개인정보 없는 `capture-status.phase`로 `finalizing`·`privacy`·`storage`·`storage-verify`를 구분하고 단계별 한국어 결과를 표시함

## v0.11.2 패치

- prompt tokenizer가 끝나지 않으면 패널 세션의 최초 probe를 5초로 제한하고 같은 세션의 이후 토큰 수를 UTF-8 byte/3.35로 추정해 저장을 계속함
- 개인정보 변환과 `store.addSnapshot()`을 각각 30초로 제한하고, 저장 전 예외·event callback 실패·저장 timeout을 모두 개인정보 없는 `failed`로 종결함. 정상 경로는 `saved`로 종결함
- 동시 캡처는 하나의 tokenizer probe를 공유하며 요청 준비 실패는 pending timer와 generation ledger prompt까지 함께 정리함
- 헤더 도움말 버튼·모달을 제거해 새로고침·설정·닫기만 유지하고, 필드별 tooltip과 빈 상태 빠른 시작은 보존함
- disclosure 제목을 좌측 정렬로 통일하되 기본 펼침 표시자를 유지하고 패널 범위의 button·select·`.menu_button` 폭·flex·writing-mode를 SillyTavern 전역 테마에서 방어함
- SillyTavern 공개 `ConnectionManagerRequestService`의 지원 프로필을 이름으로 선택하는 AI 연결 설정을 추가함. 설정에는 불투명 profile ID만 저장하며 API 키·URL·연결 비밀값은 읽거나 저장하지 않음
- 프로필 기능 미지원·저장 프로필 소실은 요청 전에 현재 연결을 사용하지만, 선택한 프로필 요청 실패 뒤에는 현재 연결로 재시도하지 않아 이중 provider 호출·과금을 막음
- 준비·전송 사이에는 provider/model뿐 아니라 현재 연결/프로필 경로와 opaque profile ID까지 다시 비교하고, 이 identity 전체를 cache digest에 포함함. 프로필 목록의 일시적 조회 실패는 설정의 저장 ID를 지우지 않음

## v0.11.1 패치

- 활성 AI semantic gate와 긴 일반 채팅이 겹칠 때 기존 256개 문자열 탐색 한계 때문에 prompt 전체가 `ambiguous`로 폐기되어 fallback 스냅샷도 만들어지지 않던 회귀 수정
- gate 탐색 상한을 2MiB·8,192개 노드·4,096개 문자열로 유지해 일반적인 장문 채팅을 판별하고, 이 상한을 넘겨 exact AI 요청 여부를 확인할 수 없는 입력은 계속 fail-closed
- `capture-status` 이벤트는 동결된 `{ state, promptType?, stage?, at }`만 전달하며 원문·snapshot/chat ID·provider/model·오류 메시지를 전달하지 않음
- 6개 기능 탭을 `프롬프트`·`검사`·`기록`·`도구` 4개 작업과 세부 탐색으로 재구성하고 빠른 시작·도움말·캡처 상태 표시 추가
- 규칙 결과를 설정보다 먼저 배치하고 AI·분석 상세·규칙 설정·비교 정책은 펼칠 때 렌더링하며, 검색 필터·타임라인 저장 관리·설정 고급 항목은 disclosure로 정리

## 구현 완료

### 캡처와 provenance

- Chat Completion·Text Completion 요청 준비 이벤트를 우선 사용하고 prompt-ready 이벤트를 대체 경계로 사용하는 읽기 전용 캡처
- 요청 객체 원본을 수정하지 않는 복제, credential·Authorization·URL query 비밀값·PEM 개인 키 정제와 미디어 data URL 생략
- 생성 lifecycle, 요청 경계, 선택한 생성 소스와 확인할 수 없는 upstream provider, usage·correlation 개인정보를 분리한 스키마 v7
- source의 JSON pointer·message index·role·원본 값 범위·최종 문자 범위와 assistant prefill 확정·추정 상태
- 캐릭터·프리셋·설정 프롬프트·요청 메시지·로어북·tool·멀티모달 소스 분해와 실제 포함 상태
- v1~v6 레코드의 지연 v7 이전, 성공 레코드만 1회 write-back하고 손상 레코드는 원본 보존
- generation별 불투명 handle과 개수·수명 제한 ledger에 prompt·request·lore·lifecycle·usage 상태 격리
- 양쪽의 같은 공개 ID만 정확 연결하고, ID 충돌·한쪽 누락은 실패로 닫으며 id-less prompt→request에만 유형별 FIFO 사용
- tokenizer Promise는 최초 5초 probe 뒤 미종료 시 byte/3.35 추정으로 전환하고 개인정보 변환·저장 Promise는 각각 30초 뒤 실패로 닫아 캡처 상태가 `saved` 또는 `failed`로 끝남

### Usage·비용과 correlation

- `provider-reported`·`local-estimate`·`unlinked`·`unavailable` 상태와 입력·출력·캐시·합계·근거 이벤트·연결 시각의 엄격한 정규형
- OpenAI·Anthropic·Google·호환 usage shape의 제한된 parser와 음수·NaN·과대·모순·prototype 오염 거부
- 새 스냅샷의 로컬 prompt tokenizer 입력 추정과 유효한 `MESSAGE_RECEIVED`의 단일 활성 generation 출력 추정
- response usage는 같은 공개 ID로만 연결하고 ID가 없거나 모호하면 별도 미연결 상태로 남기며 response FIFO 금지
- 공식 SillyTavern 공개 이벤트에는 provider response usage와 대응 provider request ID가 없다는 기본 capability matrix
- provider 직접 보고 비용과 과거 비용 출처를 스키마에서 구분하며, v0.12.3 이후에는 사용자 가격표를 읽어 새 비용을 계산하지 않음
- lifecycle·usage 후속 쓰기의 snapshot ID·partition 불변 원자적 `updateSnapshot()` 경로
- v7 이전에서 raw `capture/request.correlationId`와 요청 correlation key를 제거하고 `hadCorrelationId`만 보존

### 저장 정책과 무결성

- 채팅별 개수 1~5,000개, 보관 기간 최대 3,650일, 전체 대략적 용량 최대 2GiB 설정
- `기간 → 채팅별 개수 → 전체 용량` 순서의 결정적 GC와 삭제 전 집계 미리보기
- 각 채팅의 최신 정상 스냅샷, 방금 저장한 스냅샷, 손상·고아 레코드 보호
- 미리보기 revision과 저장 mutation revision이 다르면 삭제하지 않는 stale-plan 거부
- 구버전 배열에서 삭제할 항목은 전체 스키마 이전하지 않고 남길 최신 항목만 개별 레코드로 이전
- 누락 레코드 참조, 손상 레코드, 유효한 고아 레코드, 잘못된 인덱스, 구버전 중복·충돌 컨테이너 진단
- 누락 참조 제거, 유효 고아 재인덱싱, chat index·저장 요약 재구성과 검증된 구버전 중복 컨테이너 제거
- 손상 레코드 raw와 충돌하는 구버전 컨테이너는 수정·삭제하지 않고 보존
- 손상 인덱스와 유효 legacy timeline이 공존해도 한 번의 복구로 active index·요약을 완결하고 재실행은 no-op
- 보존된 legacy 충돌 원본의 바이트를 저장 요약과 global-byte retention의 보호 용량으로 포함
- 시작·백그라운드 정리는 기간·용량만 자동 유지하고 채팅별 개수 축소는 설정의 revisioned preview·확인에서만 실행
- ST DevTools 데이터의 대략적 JSON 바이트와 브라우저 오리진 전체 사용량·quota를 별도 범위로 표시

### 개인정보 캡처와 공유

- `전체 원문(full)`, `원문 제거본(redacted)`, `메타데이터만(metadata)` 캡처 모드
- redacted 모드에서 prompt-bearing 문자열을 문자 수·바이트·SHA-256 placeholder로 바꾸고 원시 채팅/요청/source 식별자를 불투명 참조로 교체
- metadata 모드에서 payload·request body·source·lore·preset 등 프롬프트 구조를 제거하고 lifecycle·provider trace·통계 요약만 유지
- 더 비공개인 스냅샷을 덜 비공개인 모드로 되돌리는 변환 거부
- redacted·metadata만 허용하는 공유 문서, 포함 필드 미리보기와 원본 문자열 seed 재등장 시 fail-closed 검사
- 개인정보 입력의 크기·깊이·노드·문자 수 상한, 순환 구조·unsafe prototype key 거부

### 백업·병합·복원

- 항목마다 실제 privacy mode를 보존하고 `mixed per-entry privacy`를 표현하는 snapshot archive schema v2
- archive 전체 크기·깊이·채팅/항목 수·필드·privacy 선언·중복 ID·SHA-256 digest 검증
- 안전한 schema v1 제거본의 v2 이전과 원문이 섞인 것으로 확인된 v1 archive 거부
- 기본 merge, 같은 ID·digest 중복 건너뛰기, 다른 내용의 ID 충돌을 `둘 다 유지` 또는 `건너뛰기`로 처리
- archive digest에서 유도한 확인 문자열을 직접 입력해야 하는 전체 replace
- `SnapshotStore.runExclusiveImport()`로 가져오기 전체를 저장 mutation lock에 직렬화하고 중간 보관 정리 없이 적용한 뒤 read-back 검증
- 쓰기·read-back 실패 시 가져오기 전 raw key/value 전체를 복원하고 fingerprint로 다시 확인하는 rollback
- full 요청 archive에서만 private snapshot의 raw local partition을 entry digest·replace token·충돌 키에 포함하고 실제 저장 파티션으로 복원
- redacted·metadata archive의 raw partition 기록을 거부하고, rollback 자체 실패는 `rollback-failed`와 `restored: false`로 구분
- 가져오기 뒤 정책 초과분은 자동 삭제하지 않고 best-effort 미리보기 경고로 설정의 명시적 정리 흐름에 연결

### 성능과 진단

- 100개 이상의 타임라인·소스 목록에서 viewport와 overscan 행만 렌더링하는 가상 목록
- 측정 행 높이·추정 높이를 함께 처리하는 Fenwick tree와 `aria-setsize`·`aria-posinset`·키보드 대상 복원
- 검색·diff·규칙 분석의 입력 상한, module Worker, timeout·취소·오류 시 종료와 revision이 지난 결과 폐기
- snapshot/configuration digest만 key로 사용하는 항목 수·대략적 바이트·TTL 제한 메모리 전용 LRU cache
- Worker 사용 불가 시 같은 입력 검증 계약을 사용하는 로컬 fallback
- 두 진단 JSON의 허용 목록 집계·토큰·스냅샷 메타데이터 비교, 범위·보고서 버전 비호환 경고
- 비교 결과에서 내부 snapshot/chat ID를 제거하고 count key·변경 목록 수를 제한

### Rule Inspector V3와 기존 도구

- 실제 요청에 포함된 지시 소스를 원자·관계·클러스터로 구조화하는 로컬 규칙 검사
- 전체·프리셋·캐릭터·채팅 비교 정책 프로필, 그룹 동작·이름 규칙·수동 지정과 변경 미리보기
- 확정·후보·근거 부족 판정, 유효·오탐·범위별 항상 무시·세션 숨김과 로컬 감사 기록
- 탐색기·타임라인·프롬프트/로어북 diff·컨텍스트·검색·진단 내보내기와 모바일·키보드 UI

### 선택적 AI Semantic Inspector

- `st-devtools:preferences:v5`의 기본 OFF opt-in, 64~2,048 범위의 응답 토큰 상한과 선택적 opaque connection profile ID
- 사용자가 직접 선택한 정적 finding·지시 cluster만 준비하고 아무 대상도 자동 선택하지 않는 UI
- full snapshot만 허용하며 redacted·metadata v7 입력은 UI와 core 모두 준비 전에 거부
- 개인정보 메타데이터 없이 v7로 지연 이전된 과거 기록도 원문 보존 상태를 추측하지 않고 AI 준비 전에 거부하며, AI 검사는 새 full snapshot 재캡처 필요
- target에서 실제 active source·atom·relation closure를 계산하고 closure 밖 source는 label·제외 이유만 preview에 표시
- closure에 필요한 source의 정확한 전체 content, 제외 목록, provider/model identity, 입력 토큰 추정, 응답 상한, 고정 지시·사용자 추가 지시·프리필 preview
- 필수 source에 민감 토큰이 있으면 offset을 바꾸는 부분 redaction 대신 요청 전체를 거부
- 미리보기마다 선택 해제되는 호출별 1회 동의, 취소 시 provider call 0회와 retry의 새 prepare/preview/consent
- 공개 Connection Manager profile `sendRequest()` 또는 현재 연결 `getContext().generateRaw()` 중 하나만 사용하는 provider adapter와 준비·inspect 사이 identity 변경 fail-closed
- 공개 Connection Manager 서비스의 지원 프로필 목록과 이름 선택, 선택한 Chat/Text Completion 프로필의 `sendRequest()` 호출 및 현재 연결을 변경하지 않는 라우팅
- Text Completion profile route는 consent prompt 문자열을 그대로 전달하고 `includeInstruct: false`로 추가 prompt 재구성을 막으며, sampler preset은 유지
- 프로필 표시값은 bounded ID·name·provider·model·completion type만 허용하고 설정에는 opaque ID만 저장. credential·API URL·private Connection Manager 설정에는 접근하지 않음
- 프로필 API가 없거나 저장된 ID가 더 이상 resolve되지 않으면 요청 전 현재 연결을 사용하지만, profile `sendRequest()`가 실패한 뒤에는 현재 연결 `generateRaw()`로 fallback하지 않음
- provider만 확인되는 partial identity는 model·비용을 추측하지 않고, provider identity 자체가 unavailable이면 unsupported
- protocol·필드·크기·깊이·노드·허용 enum·known ID를 검사하는 strict JSON response validator
- 모든 evidence의 source ID·start/end·quote가 전송 source의 정확한 substring인지 검증하고 하나라도 틀리면 전체 response 거부
- 정적 finding·review·policy·ignore와 분리된 memory-only `AI 제안`, 자동 적용·수정·판정 기능 없음
- protocol/provider/model/cap/prompt digest 기반 bounded memory cache. 전체 raw prompt·provider response와 전용 source content·evidence quote 필드는 비저장이지만 정규화 제안 텍스트는 TTL 동안 유지
- exact prompt/prompt type의 nonce identity ticket 호출과 exact duplicate를 이용한 self-capture gate, TTL·capacity와 모호한 동시 id-less 요청 fail-closed
- logical timeout·cancel 이후 늦은 결과 폐기와 retry별 새 nonce. 이미 시작된 provider 계산 자체의 강제 중단은 보장하지 않음

## 검증 범위

### 릴리스 전 자동 검증 대상

- 정책 적용 순서, 보호 항목, 초과 상태, 대규모 경량 인덱스와 stale 미리보기 거부
- 누락·고아·손상·구버전 중복/충돌 진단과 손상 raw 보존, 복구의 반복 실행 안전성
- 세 개인정보 모드의 비가역 경계, 원문 seed 검사와 과대·순환·변조 입력 거부
- mixed privacy archive, merge·중복·충돌·replace 확인, 동시 캡처 직렬화와 raw rollback
- 실제 `SnapshotStore` full backup 왕복의 private partition 복원, partition/digest 변조 거부와 rollback 실패 상태
- Worker 성공·오류·timeout·취소·stale 시 종료, cache 상한·만료·원문 없는 key
- 5,000개 가상 목록 window와 진단 비교의 ID 미노출·출력 상한
- 캡처 모드별 UI 기능 차단, 설정 preview-first 순서와 origin quota/확장 추정치 구분
- ledger의 동시 generation·ID 충돌·FIFO 경계·unlinked usage와 atomic snapshot update
- usage·provider 보고 비용 정규형·과거 비용 출처 읽기 호환과 v1~v6→v7 개인정보 이전
- AI 기본 OFF·V1~V4→V5 설정 이전, full-only와 secret-bearing required source의 fail-closed
- target closure·정확한 preview·현재 identity 재확인, strict JSON/known-ID/evidence offset 검증과 memory-only cache
- 동의 취소 no-send, retry 새 동의, logical timeout·abort와 늦은 결과 폐기
- nonce gate identity-exact consume·TTL·capacity·exact duplicate 억제, explicit-ID 정상 요청 보존과 모호한 id-less 동시성 fail-closed
- tokenizer 미종료 1회 probe·로컬 추정 저장, privacy/storage 미종료 timeout과 모든 캡처 terminal 상태
- Connection Manager 프로필 표시 필드·opaque ID 저장, Chat/Text 프로필 라우팅, 미지원·소실 시 현재 연결과 profile 요청 실패의 무재시도
- 다섯 기능 하단 tablist·헤더 상태 점·화면 제목 tooltip과 규칙 검사 화면 AI 모드·설정 dialog의 접근성 계약
- `100vw`·`100dvh` 모바일 앱 셸, safe area와 모바일 geometry 복원·저장·drag 방지
- 내부 밝은/어두운 색 토큰과 공격적인 호스트 테마 격리, 430px 프롬프트 비교 표와 설정 포커스·데이터 도구 정보 구조

### 릴리스 전 결정적 UI 샌드박스 검토 대상

- 전체 원문·원문 제거본·메타데이터 fixture의 탭별 안내와 사용 불가 기능 차단
- 보관 정책·privacy mode·저장 도구가 있는 설정/도구 패널의 모바일·데스크톱 배치
- 저장 실패·임시 메모리·요약 재계산·테마 전환 fixture와 진단 가져오기 성공/거부 상태
- mixed privacy fixture를 사용하는 archive·safe share·진단 비교 조작 경로
- usage 상태·provider 보고 비용 출처·capability matrix와 과거 비용 출처 읽기 호환, 모바일 배치
- 실제 `SemanticInspector`·strict validator·memory cache에 결정적 fake adapter를 주입한 AI preview·동의·성공·오류·취소
- `semanticCore=true`, validated result count와 provider/network call 0회 dataset으로 샌드박스 경계 확인
- 헤더 새로고침·설정·닫기 세 버튼, 좌측 정렬 disclosure와 여러 SillyTavern 테마·430px에서 패널 control 폭·writing-mode 방어
- 다섯 기능 고정 하단 내비게이션과 상태 점·기능별 제목, 프롬프트 요청 원본 disclosure와 규칙 검사 설정 dialog, 모바일 간결 비교 표

샌드박스는 가짜 저장 backend와 결정적 semantic adapter를 사용합니다. Semantic Inspector 코어의 closure·preview·strict response/evidence 검증·memory cache는 실제 구현을 통과하지만 SillyTavern의 실제 `generateRaw`, 사용자의 IndexedDB, 브라우저 비공개 모드와 provider 응답 품질·과금은 대신 검증하지 않습니다.

### 실제 SillyTavern에서 사용자 확인이 필요한 것

- 사용 중인 브라우저의 IndexedDB에서 v0.9.x 데이터가 그대로 열리고 정책 적용·새 캡처가 함께 안전하게 직렬화되는지
- 기간·용량 축소 미리보기 수와 적용 뒤 실제 저장 건수, quota 부족·비공개 모드의 오류 및 재시도 동작
- 각 privacy mode를 고른 뒤 새로 생성한 Chat/Text Completion 스냅샷의 표시와 기능 제한
- 전체 backup을 별도 테스트 데이터로 merge·충돌 유지·replace했을 때 새로고침 뒤에도 결과가 유지되는지
- 실제 provider/model별 구조 provenance, 선택 소스, assistant prefill과 캡처 lifecycle 정확성
- 단일·동시 generation에서 `MESSAGE_RECEIVED` 출력 추정이 다른 스냅샷에 섞이지 않는지
- provider가 직접 보고한 비용의 표시와 비용이 없는 스냅샷의 `계산 불가`, 과거 비용 출처의 읽기 호환
- AI 설정의 기본 OFF, full snapshot 선택, 선택한 프로필 또는 현재 연결의 실제 provider/model preview와 매 호출 선택 해제 동의
- 동의 취소 시 요청이 발생하지 않고 성공 결과가 정적 finding·review·policy를 바꾸지 않는지
- 실제 provider별 JSON schema 지원·오류 code·응답 상한과 취소 뒤 provider 계산/청구의 실제 동작
- AI 호출 중 일반 generation을 겹쳤을 때 AI self-capture가 생기거나 일반 generation의 snapshot이 사라지지 않는지
- 일반 요청이 10초 안에 `saved` 또는 `failed`로 끝나고 tokenizer가 느린 환경에서도 `processing`에 영구 고정되지 않는지
- AI 연결 프로필을 선택·저장·재진입했을 때 같은 이름이 선택되고 실제 profile route를 사용하는지, 프로필 삭제·요청 실패 때 이중 호출이 없는지
- 밝은·어두운 사용자 테마와 약 430px에서 헤더 세 버튼·disclosure·패널 버튼이 세로 글자나 강제 전체 폭으로 깨지지 않는지

## 부분 구현 또는 알려진 경계

### 저장·개인정보·복원

- 전체 용량은 직렬화한 JSON의 대략적 바이트이며 IndexedDB의 실제 디스크 점유량과 같지 않습니다.
- origin quota는 SillyTavern과 같은 origin의 다른 데이터를 포함하므로 ST DevTools 전용 잔여 공간이 아닙니다.
- 최신 정상 레코드와 손상·고아 원본 보호 때문에 사용자가 정한 용량보다 큰 상태가 의도적으로 남을 수 있습니다.
- 무결성 복구는 인덱스·요약을 고치지만 손상 snapshot body를 수리·격리·삭제하지 않습니다.
- redacted는 원문 제거 방식이지 일반 개인정보 탐지기가 아닙니다. placeholder의 digest는 낮은 엔트로피 문자열에 대한 사전 대입 위험을 없애지 않습니다.
- 공유용 seed 검사는 입력에서 수집한 문자열의 재등장을 찾는 방어선이며 모든 개인정보·비밀값 부재를 증명하지 않습니다.
- privacy mode는 새 캡처에 적용됩니다. 기존 full 스냅샷은 설정 변경만으로 자동 변환되지 않습니다.
- metadata 스냅샷은 원문 구조가 없으므로 탐색·diff·검색·Rule Inspector를 복원할 수 없습니다.
- 전체 archive는 원문을 포함할 수 있습니다. safe share와 전체 backup은 목적과 위험이 다릅니다.
- raw rollback은 가져오기 전 브라우저 저장 상태를 복원하지만 저장 backend 자체가 계속 실패하거나 quota가 완전히 소진된 상황까지 복구를 보장하지 않습니다.

### 성능·진단

- Worker를 사용할 수 없는 환경의 local fallback은 입력을 제한하고 timeout 상태를 제공하지만 이미 시작한 동기 계산을 선점 중단할 수는 없습니다.
- 가상 목록은 100개 이상에서 적용되며 브라우저의 실제 폰트·확장 테마로 행 높이가 급변하는 경우 사용자 환경 확인이 필요합니다.
- 메모리 cache는 새로고침하면 사라지며 분석 결과를 영구 저장하지 않습니다.
- 진단 비교는 허용된 메타데이터 변화만 보여 줍니다. 원본 스냅샷 복원이나 archive 병합 기능이 아닙니다.

### 캡처와 Rule Inspector

- 공개 ID가 없는 FIFO는 prompt→request 호환에만 남습니다. 동시 generation의 response usage나 로컬 출력값을 FIFO로 붙이지 않습니다.
- 공식 SillyTavern 공개 이벤트는 provider response usage와 대응 provider request ID를 제공하지 않으므로 기본 설치의 provider usage·비용은 `unavailable`입니다. 별도 integration이 같은 공개 ID를 제공할 때만 adapter를 사용할 수 있습니다.
- `MESSAGE_RECEIVED`의 `extra.token_count`는 provider 보고 usage가 아니라 로컬 출력 추정치이며 하나의 활성 generation을 안전하게 고를 수 없으면 미연결 또는 산정 불가로 남습니다.
- provider 서버가 변환한 최종 HTTP body와 내부 upstream provider는 공개 프런트엔드 이벤트만으로 확정할 수 없습니다.
- 정적 Rule Inspector는 명시적 언어·형식·역할·포함/금지·이전 지시 무시 표현을 중심으로 하며 자연어 의미 전체를 이해하지 않습니다.
- 조건·예외의 논리 관계, 말투·정체성·안전·메모리 의미 충돌과 실제 우선순위 승자는 아직 판정하지 않습니다.
- v0.9.1 이전 스냅샷에는 프리셋·캐릭터·채팅 범위 지문이 없고 v0.9.2 이전 스냅샷에는 구조 provenance가 없습니다.

### AI Semantic Inspector

- AI 검사는 full snapshot의 선택된 closure 원문을 선택한 Connection Manager 프로필 또는 현재 provider에 전송하는 기능입니다. redacted·metadata에서 사용할 수 없고 일반 개인정보 익명화 도구가 아닙니다.
- 선택 가능한 프로필 목록은 SillyTavern 공개 서비스가 제공하는 범위뿐이며 ST DevTools는 opaque ID 외 credential·URL·연결 비밀값을 저장하지 않습니다. 프로필 API가 없거나 선택한 ID가 요청 전에 사라지면 현재 연결을 사용합니다.
- partial identity는 provider만 표시하고 model·비용을 추측하지 않습니다. identity unavailable 또는 준비 뒤 identity 변경은 fail-closed입니다. 선택한 프로필 요청이 시작된 뒤 실패해도 현재 연결로 재시도하지 않습니다.
- 입력 토큰은 로컬 추정이고 응답 상한은 비용 상한과 같지 않습니다. ST DevTools는 AI 검사 비용을 추정하지 않으며 provider의 실제 계산·청구를 보증하지 않습니다.
- AbortSignal과 timeout은 호출자에게 논리적으로 취소를 제공하고 늦은 결과를 버리지만, 공개 `generateRaw()`가 이미 시작한 provider 계산·전송·과금을 물리적으로 중단한다고 보장하지 않습니다.
- self-capture nonce gate는 호출별 ticket의 AI prompt·prompt type exact match와 그 semantic 호출의 exact duplicate만 제외합니다. 모호한 id-less 동시 요청은 fail-closed이므로 일부 capture가 미연결 상태로 남을 수 있지만 다른 pending 요청을 추측 소비하지 않습니다.
- v0.11.1 gate는 최대 2MiB·8,192개 노드·4,096개 문자열을 검사합니다. 기존 256개 문자열 경계를 넘는 일반 장문 채팅은 정상 캡처하고, 새 상한도 넘어 exact nonce를 확인할 수 없으면 AI 원문 저장을 피하기 위해 prompt 단계에서 `skipped-safety`로 닫습니다.
- AI 결과와 선택은 메모리 전용이며 새로고침하면 사라집니다. cache는 전체 raw prompt·provider response와 전용 `source.content`·`evidence.quote` 필드를 저장하지 않지만 title·summary·rationale 같은 정규화 제안 텍스트는 TTL 동안 유지하고 모델이 반복한 원문 표현을 포함할 수 있습니다. 영구 결과 이력·감사 로그 또는 익명화 경계가 아닙니다.
- strict schema와 evidence offset 검증은 응답이 준비된 원문을 정확히 인용했는지 확인하는 경계입니다. 제안의 사실성·유용성·안전성 또는 자연어 의미 판단의 정확도를 보증하지 않습니다.
- v0.13.0 provider envelope 정규화는 공개 API에서 알려진 bounded 응답 구조만 지원합니다. 알 수 없는 wrapper를 재귀적으로 추측하거나 provider 오류 메시지·response body를 진단에 노출하지 않습니다.
- 합성 평가 corpus는 평가기와 고정 reference 결과의 결정성을 검증합니다. CI에서 실제 provider를 호출하지 않으므로 특정 model의 현재 품질·호환성·과금·안전성을 보증하지 않습니다.

## 아직 미구현

### v0.15.x 이후 방향

- 말투·안전 의미의 정적 atom·relation 양성/음성 경계를 과잉 탐지 없이 추가하는 분류 설계
- title·summary·rationale의 의미 정확성을 다루는 bounded 사람 검토 rubric
- 실제 초보자 검토에서 확인되는 briefing 길이·practice task dock·debrief 결과 설명과 모바일 sheet 밀도 보정

선택형 온보딩의 기본 계약은 v0.15.1에서 완료했고 v0.15.3의 고정 guided rail은 v0.15.4에서 단계별 briefing·practice·debrief 흐름으로 교체했습니다. hands-on 실습은 실제 제품 renderer와 control을 사용하지만 분리 더미 session만 조작하며 실제 store·provider·clipboard·export에는 접근하지 않습니다. Prompt Playground, Dependency Graph, Lore Trigger Simulator와 Extension Debug Panel은 현재 구현 범위가 아니며 특정 버전 완료 항목으로 약속하지 않습니다.

## 다음 구현 우선순위

1. 말투·안전 구조 atom 분류는 합성 양성/음성 사례와 오탐 budget을 먼저 고정한 뒤 제품 경로에 연결합니다.
2. 실제 provider에서 확인된 호환 문제는 원문 없이 code·reason·provider family·route만으로 v0.14.x 패치를 만듭니다.
3. 온보딩은 실제 초보자 검토 뒤 briefing·practice·debrief 카피와 모바일 sheet 흐름을 보정하되 6개 주제·38단계와 view-session 격리·종료 시 live view 복구 경계를 기본값으로 유지합니다.
