# ST DevTools 구현 로드맵

이 문서는 v0.16.1 코드 기준으로 완료 범위와 다음 방향을 나눈 예상 계획입니다. 버전 번호는 기능 의존 관계를 나타내며 일정 약속은 아닙니다.

## 현재 기준선

v0.16.1은 도움말을 `기본 사용법`·`고급 기능 가이드`·`기능 설명서`로 재편합니다. 전체 안내와 기능별 부분 투어, 실제 화면형 비교 정책·AI 의미 검사 고급 코치마크, 툴팁에서 상세 문서로 이어지는 deep link를 하나의 읽기 전용·더미 격리 경계 안에 제공합니다.

## v0.16.1 — 세 갈래 도움말·부분 투어·고급 코치마크 · 완료

- 도움말 첫 화면을 기본 사용법·고급 기능 가이드·기능 설명서 세 경로로 단순화
- 전체 안내 외에 프롬프트 13·기록 6·비교 7·검사 7·검색 5단계를 각각 바로 다시 시작하는 아코디언 제공
- 부분 투어별 준비 checkpoint로 중간 기능부터 시작해도 필요한 더미 snapshot·선택·결과가 보이도록 구성
- 비교 정책과 AI 의미 검사를 실제 검사 화면 형태의 coachmark 미니 튜토리얼로 전환
- 고급 가이드의 설정 저장·snapshot store·provider 요청·비용 경로 비접근과 고정 더미 결과 보장
- 기능별·고급 투어의 완료·중단이 첫 실행 전체 안내의 전역 완료·건너뛰기 상태를 오염하지 않도록 분리
- 짧은 툴팁의 `자세히 보기`를 기능 설명서 topic deep link로 연결하고 FAQ·요청 상세·구조 검사·provider 평가·저장 도구 문서 보강
- 모바일 320px·390px, 밝음·어두움 테마, keyboard focus·Escape·원래 focus 복원 회귀 검증
- 다음 후보: 기능 설명서 문서 내 실제 화면 위치 이동, 사용자 검색어·FAQ 보강, 실사용 고급 가이드 주제 우선순위 수집

## v0.16.0 — 기능 도움말·연습실·교체 비교 · 완료

- 상단 기존 안내 control을 현재 화면·전체 문서·연습실을 제공하는 단일 도움말 허브로 전환
- 다섯 주요 화면과 캡처·저장·개인정보 설정의 기능 문서, 검색과 최근 읽은 문서 추가
- 실제 설정을 저장하지 않는 비교 정책 이름 규칙·대안 그룹 실습 추가
- 실제 provider를 호출하지 않는 AI 의미 검사 미리보기·동의·검증 결과 시뮬레이션 추가
- 양쪽 요청에 포함된 동일 source의 내용·배치 변화인 `수정`과 대안 옵션 1:1 전환인 `교체` 분리
- 정책·옵션·활성 cardinality가 모호할 때 `추가`·`삭제`로 안전하게 fallback
- 다음 후보: 실사용 문구·검색어 보강, 도움말 문서의 화면 내 deep link 범위 확대, 실제 대안 그룹 사례 회귀 수집

## v0.15.8 — 이전 이동·비교 강조 보정 · 완료

- 설명·결과·직접 체험에서 사용할 수 있는 논리 단계 단위 `이전` 이동 추가
- 이미 완료한 상호작용 단계로 돌아갈 때 결과 설명으로 복귀해 재조작과 진행 정체 방지
- 하단 기능 탭 높이·모바일 viewport·본문 끝 target을 고려한 이전·다음 control 안전 영역 적용
- 변경 비교 practice의 기준·비교 선택과 추가·수정·삭제·전체 차이 spotlight 유지
- disclosure의 clipping을 피하도록 practice에서는 카드 전체, debrief에서는 펼쳐진 본문을 강조
- 비동기 diff 렌더 뒤 target 재연결과 320×640·390×844 실브라우저 회귀 검증

## v0.15.7 — 직접 체험형 코치마크 흐름 보정 · 완료

- 설명·결과와 practice의 종료 control을 우측 상단 한 위치로 통일하고 하단의 중복 종료 제거
- 호스트 테마가 `[hidden]`을 덮어써도 현재 phase의 종료 control 하나만 표시하도록 격리 강화
- 상호작용 단계의 별도 `직접 해보기` 전환을 제거하고 설명과 실제 조작을 한 practice 화면에 결합
- 읽기 전용 단계와 조작 완료 debrief에서만 `다음`을 사용해 반복 이동 축소
- capture-phase click을 다음 task에서 session·step·phase guard와 함께 판정해 `요청 포함만` 첫 클릭 완료 보장
- 320px·390px 실제 브라우저 폭에서 단일 종료 control, 가로 overflow와 dock 내부 스크롤 없음 검증

## v0.15.6 — 코치마크 설명·결과 피드백 보완 · 완료

- 시작 초대를 JSON·XML 기술 사례가 아닌 ‘예상과 다른 답변의 원인 찾기’라는 사용자 목표 중심으로 재작성
- briefing을 기능 의미와 사용 시점 또는 확인 행동의 두 문장 구조로 보강
- 캡처 실행 control을 이름이 보이는 가로 버튼과 진행 중 상태로 변경하고 320px에서 세로 배치
- 이미 충족된 checked·open·value 상태를 practice 진입 때 동기화해 반복 조작 제거
- disclosure 완료 뒤 펼쳐진 본문 영역을 result spotlight 대상으로 전환
- interactive debrief와 최종 단계에 성공 문구·단계 맥락·관찰 결과를 분리
- copy·dock·spotlight·성공 ring을 one-shot animation으로 연결하고 reduced-motion 정적 대체 적용

## v0.15.5 — 레퍼런스형 코치마크 단순화 · 완료

- 흰색 설명 sheet·장별 진행률·위치·무엇/언제 펼침·텍스트 버튼 묶음 제거
- 암전 화면의 실제 target ring·점선 화살표·제목과 한 문장, 원형 종료·다음 내비게이션 적용
- 밝은 체험 화면의 target pulse·한 줄 지시와 실제 이벤트 완료 뒤 자동 debrief 적용
- 직접 조작할 것이 없는 8개 단계를 한 번의 briefing으로 축소
- target 최소 52×44px와 320px·390px 가용 공간 기반 coachmark 배치 적용
- 온보딩 상태 키를 `st-devtools:onboarding:v5`로 갱신

## v0.15.4 — 단계별 briefing·practice·debrief · 완료

- 38개 단계에 briefing·practice·debrief phase를 적용하고 항상 표시되던 desktop side/mobile top rail 제거
- briefing의 screen dim·실제 target spotlight·짧은 목적 설명과 debrief의 결과·추가 설명을 분리
- practice에서 dim·modal·`inert`를 해제하고 compact task dock만 남겨 실제 control을 직접 조작
- 정확한 click/change/input/toggle 관찰로 완료를 판정하되 현재 단계와 관계없는 control의 click/focus를 차단하지 않음
- 320px·390px 모바일에서 190~260px clamp 대신 내용 기반 auto-height sheet와 viewport 초과 본문 스크롤 적용
- 캡처 상태의 점·copy·pill로 `대기 → 감지 → 저장 중 → 저장됨` 전환을 색상 외 정보로 표시
- 초대·briefing·debrief의 modal/inert/focus trap, practice의 interactive focus, 종료 시 시작 focus 복구 경계를 phase별로 분리
- 기존 6개 주제·38단계·JSON → XML 사건·3개 fixture와 store/provider/clipboard/export 비접근 계약 유지
- 최소 온보딩 상태 키를 `st-devtools:onboarding:v4`로 갱신하고 건너뛰기·완료만 저장

## v0.15.3 — guided learning rail 전면 재설계 · 완료

- 첫 실행 초대만 modal로 유지하고 실습 본문은 실제 콘텐츠와 나란한 complementary rail로 전환
- 데스크톱 side rail과 좁은 화면 top rail에 현재 장·전체/장별 진행률·현재 할 일·완료 기준·이전·다음·건너뛰기를 일관되게 표시
- floating coach panel·spotlight·대상 주변 자동 배치·scroll/resize geometry 추적 제거
- JSON → XML 형식 변경 한 사건을 캡처 → 실제 전송 내용 → 충돌 근거 → 변경 시점 → 두 요청 비교 → 원본 검색으로 잇는 6개 장 서사
- 기존 캡처 3·전송 프롬프트 10·규칙 검사 7·기록 6·변경 비교 7·검색 5의 38단계와 920·1,080·1,248 토큰 fixture 유지
- 현재 단계와 관계없는 control 비활성화 및 잘못된 click/focus 차단 제거, 실제 이벤트 관찰만으로 완료 판정
- 전체 카드 대신 실제 button·input·select·disclosure `summary`를 직접 강조하고 rail의 `화면에서 보기`로 탭·스크롤·focus 복구
- 실제 snapshot store·provider·Semantic Inspector·clipboard·export 비접근과 종료 시 live view 복구 계약 유지

## v0.15.2 — hands-on 위치·가독성 안정화 · 완료

- 캡처 단계부터 검색 단계까지 실제 내부 스크롤 컨테이너의 scroll event를 추적하고 한 frame에 한 번만 위치를 다시 계산
- 대상·패널·콘텐츠 크기 변화를 관찰하며 대상과 겹치지 않는 방향을 선택하고 작은 화면에서는 사용 가능한 높이만큼 안내 본문을 스크롤
- 화면 밖 대상은 stale spotlight를 남기지 않고 가장자리 복귀 상태로 축소
- 전체 화면 dim을 제거하고 이중 강조 테두리·행동 라벨·14px 이상 본문·1.7 행간 적용
- 행동 카드 우선, 기능 설명·사용 시점은 선택형 disclosure로 재배치

## v0.15.1 — 실제 제품 UI hands-on 온보딩 v2 · 완료

- 첫 실행 1회 제안, 명시적 건너뛰기, 완료, 헤더 나침반 버튼 재시작
- 캡처 3·전송 프롬프트 10·규칙 검사 7·기록 6·변경 비교 7·검색 5의 6개 주제·38단계 정보 구조
- 각 단계의 `무엇인가요?`·`언제 쓰나요?`·직접 수행할 `할 일`, 실제 화면 대상 spotlight와 대상이 없을 때 중앙 fallback
- 상호작용 단계별 `이 단계 건너뛰기`, 이전·다음·완료와 전체 안내 건너뛰기
- 초기 스냅샷 2개와 연습 캡처 후 세 번째 스냅샷을 갖는 별도 mutable view session을 실제 제품 renderer에 연결
- provider/model/토큰·포함 상태·provenance·JSON/XML 충돌·토큰 성장·추가/수정/삭제 diff·한국어 검색을 실제 control로 수행
- 모든 단계의 `연습 데이터 · 저장·전송 안 함` 표기와 실제 tab·selection·timeline·snapshot store 무변경
- AI 의미 검사·공식 Provider 평가와 동시 실행 금지, 실제 provider·clipboard·export 호출 0 경계
- 종료 시 live tab·selectedId·timeline·capture status 복구와 실습 중 도착한 live 변경의 후속 refresh
- `skipped`·`completed`만 기록하는 버전 지정 최소 상태; 진행 단계·시각·내용 미저장
- Escape·이전·다음·완료, focus trap·복원·screen reader 상태, 모바일 bottom sheet
- 샌드박스 전용 hands-on hook과 실제 click/change/input/toggle·호출 0·상태 격리 회귀 검증

## v0.14.1 — 공식 Provider harness·구조 경로 평가 · 완료

- 제품에 포함된 고정 합성 corpus만 받는 in-process 평가 세션과 사례별 미리보기·초기화된 1회 동의
- 동일 inspector/adapter/capture gate 공유, 직렬 1건, 최대 48회, 자동 retry·route fallback 없음
- cache 전후 초기화와 `cached:false`, provider/model/route/profile identity 고정, selected profile의 current fallback 차단
- prepared identity와 실제 dispatch route 결속, underlying settlement까지 inspector 단위 중복 세션 차단
- 동의 수·전송 시도·검증 완료 수 분리, 빠른 연속 실행 단일화, 1회 smoke와 3회 공식 품질 판정 구분
- corpus v2·16 case SHA-256 manifest와 실제 relation 제품 target 2건·atom bridge 1건·source bridge 13건 표시
- structural gate의 target/source/atom/relation exact closure 및 구조 양성 응답의 atom/relation 귀속 검사
- raw prompt·response·quote·제안 설명·opaque profile ID 없이 반복별 집계와 최악 지표만 메모리에 표시
- 조건·예외·역할·지시·포맷의 실제 `analyzeSnapshotDetailed → atom/relation → prepare` closure 6건과 음성 경계 4건 자동 평가
- 말투·안전 정적 atom 분류 부재를 남은 구조 기능 공백으로 고정
- 공식 gate에서 provider evidence offset 보정 불허, timeout보다 30초 긴 capture gate ticket

## v0.14.0 — 의미 평가 corpus·실제 provider 절차 · 완료

- 기존 6건에 조건·예외·말투·역할·안전의 양성/음성 대조군 10건을 더한 합성 corpus v2 16건
- 신규 사례 한국어 5건·영어 5건과 범주별 언어 교차, source exact slice·evidence 범위 회귀
- 전체 평균으로 개별 축 실패가 희석되지 않도록 다섯 축의 양성 issue·근거 pair 완전 적중과 음성 무제안을 강제하는 `releaseGates`
- 동일 분류의 복수 issue에서도 근거 pair 적중을 최대화하는 결정적 일대일 대응과 gate 없는 legacy v1 명시 호환
- 적용 범위·예외·양립 가능한 말투·역할 분리·안전 우회를 구분하는 AI 고정 지침
- OpenAI·Anthropic·Google × 현재 연결·Connection Manager 수동 평가 행렬, 개인정보·동의·비용·중단·기록 절차
- v0.14.0에서는 전체 corpus live 평가를 당시 미구현이던 공식 in-process harness 전까지 `incomplete`로 남긴 판정 경계

## v0.13.1 — 읽기 전용 복사·캐릭터/페르소나 구조 오탐 패치 · 완료

- full 스냅샷의 개별 프롬프트 원문과 생성 설정·payload 복사
- AI 제안의 제목·요약·판단 이유를 수정본과 구분해 복사
- Clipboard API 권한 거부 fallback과 성공·실패 피드백
- 캐릭터 설명·성격과 페르소나의 평행한 프로필 구조 중복 오탐 억제 및 AI 음성 평가 사례

스키마 v7은 v6의 구조 provenance에 정규화된 usage·비용 출처와 correlation 개인정보 경계를 추가합니다. generation별 불투명 bounded ledger가 prompt·request·lore·lifecycle·usage를 격리하고, 같은 공개 ID가 양쪽에 있을 때만 정확히 연결합니다. 요청 호환용 FIFO는 response usage에 재사용하지 않습니다. 이전 레코드는 읽을 때 한 번만 v7으로 다시 저장하며, raw correlation ID를 제거하고 `hadCorrelationId`만 남긴 채 손상 레코드는 원본을 보존합니다.

저장은 기간·채팅별 개수·전체 대략적 용량 정책과 무결성 진단을 지원합니다. 대형 목록은 가상 렌더링하고 검색·diff·규칙 분석은 Worker와 메모리 cache를 사용합니다. 새 캡처는 전체 원문·원문 제거본·메타데이터 모드를 선택할 수 있으며, 안전 공유·혼합 privacy archive 병합/교체·진단 보고서 비교가 추가되었습니다.

선택적 AI Semantic Inspector는 사용자가 직접 고른 정적 finding·cluster의 로컬 근거만 매 호출 동의 후 선택한 SillyTavern Connection Manager 프로필 또는 현재 provider에 보냅니다. 설정에는 불투명 profile ID만 남기며 API 키·URL·연결 비밀값을 저장하지 않습니다. v0.12.3의 추가 프롬프트와 프리필은 로컬 일반 텍스트로 저장되고 고정 안전 계약과 분리됩니다. 엄격한 JSON·근거 검증을 통과한 제안도 정적 결과와 분리하며 자동 수정·판정·정책 변경에는 사용하지 않습니다. 규칙 검사 화면의 AI 모드는 사용 여부·연결 프로필·응답 상한을 한곳에서 다루지만 켜는 것만으로 전송하지 않습니다. 따라서 v0.14.1도 자연어 의미 전체나 프롬프트 품질을 보증하지 않습니다.

v0.13.0은 합성·익명 평가 corpus와 유용성·오탐률·근거 범위 pair 적중률 기준을 추가하고, 알려진 OpenAI 계열·Anthropic·Google 계열 응답 envelope를 bounded 문자열로 정규화합니다. 인증·요청 한도·네트워크·timeout·일시 장애·거부는 provider 원문을 노출하지 않는 안정된 진단 코드로 구분합니다. 고정 corpus 회귀는 평가 기반의 일관성을 확인하지만 실제 provider·model 품질을 보증하지 않습니다.

## v0.8.7 — 안정성·보안 하드닝 · 완료

목표는 다음 대규모 Rule Inspector 변경 전에 데이터 손실·멈춤·민감 정보 경계를 분명하게 만드는 것입니다.

- IndexedDB와 임시 메모리 저장 상태를 화면에 표시하고 임시 저장의 새로고침 소실 가능성 안내
- ST DevTools가 저장한 전체 데이터 삭제와 용량 요약
- 검색 debounce, 사용자 정규식 길이·복잡도 제한과 느린 정규식 격리 기반
- 값 내부 토큰·Authorization·URL query·서비스 계정 개인 키를 포함한 민감 정보 제거 보강
- 스냅샷 내보내기 전 원문 포함 경고와 포함 필드 미리보기
- 취소·중단·시간 초과 생성과 정상 전송을 구분하는 최소 캡처 상태
- 실제 브라우저 저장소, 모바일·테마·키보드 smoke test와 sanitizer·정규식 fuzz

스냅샷 lifecycle 필드를 포함한 스키마 v5, 저장 변경 전역 잠금과 인덱스 비의존 전체 삭제까지 구현했습니다. 사용자 검토는 일반적인 패치 검토만 권장하며 샌드박스와 CI를 우선 사용합니다.

## v0.8.8 — 저장 요약 성능 회귀 패치 · 완료

- 패널 열기와 스냅샷 갱신 경로에서 모든 채팅 timeline 전체 직렬화 제거
- 현재 채팅 타임라인 우선 렌더링과 타임라인 탭에서만 실행되는 비차단 저장 요약
- 기존 데이터 최초 보정의 짧은 작업 분할, 중복 요청 병합과 mutation 충돌 시 안전한 폐기
- 보정 완료 뒤 추가·교체·삭제·비우기의 채팅 수·스냅샷 수·대략적 용량 증분 갱신
- request-ready 본문 정제 결과 재사용과 prompt-ready·로어 정제의 중복 순회 제거
- 대량 데이터 fast-path·event-loop 응답성·느린 요약 비차단 UI 회귀 테스트

사용자 검토는 오래 사용한 실제 IndexedDB에서 패널 열기·생성 종료·탭 이동이 더 이상 수 초간 멈추지 않는지만 확인합니다.

## v0.8.9 — Performance Foundation · 완료

- 채팅별 전체 배열 대신 스냅샷 단위 레코드와 채팅별 경량 인덱스
- 기존 배열 저장 데이터의 ID 보존·중단 후 재시도 가능한 지연 마이그레이션
- 헤더 톱니바퀴 설정과 최신 1~100개 자동 로드 범위(기본 20개)
- 전체 보관 수와 현재 로드 수를 분리한 타임라인·그래프 안내
- 닫힌 탐색기 원문·컨텍스트 JSON·소스별/전체 문자 diff 지연 렌더링
- 동일 문자열 토큰 계산 메모이제이션과 인덱스 전용 저장 요약
- 대용량 structured-clone 모의 저장소, 모바일 모달·포커스·설정 유지 브라우저 회귀 검증

v0.10.0에 예정했던 저장 레코드 분리와 렌더 지연·계산 재사용 일부를 Rule Inspector V3 전에 앞당겼습니다. 기간·총용량 정책, 가상 스크롤·Worker 분석·복원은 v0.10.0 범위에 남깁니다.

## v0.8.10 — 보관·읽기 정책 분리 · 완료

- 신규 기본 채팅별 보관 수 30개와 자동 불러오기 20개를 별도 설정
- 불러올 수를 보관 수 이하로 자동 제한하고 불러오기 변경은 비파괴로 유지
- 보관 수를 낮추기 전에 영향받는 채팅·삭제 개수·대략적 용량을 경량 인덱스로 미리 계산
- 사용자 확인 뒤 모든 채팅의 오래된 스냅샷을 전역 저장 잠금 안에서 정리
- v0.8.9 설정 또는 기존 스냅샷이 있으면 보관 100개를 승계해 업데이트만으로 데이터가 삭제되지 않는 호환 경로
- 보관 정리와 동시 캡처, 레거시 배열 변환, 저장 요약 증분 갱신 회귀 검증

## v0.8.11 — 설정 오류·테마 패치 · 완료

- 긴 매크로 템플릿의 정규식 지연 컴파일 오류가 구버전 스냅샷 마이그레이션과 설정 저장을 중단하지 않도록 방어
- 내부 패턴과 프롬프트 원문을 사용자 오류 알림에서 제외
- 자동·항상 밝게·항상 어둡게 패널 테마 설정과 영구 저장
- 기존 v0.8.10 설정은 데이터 변경 없이 자동 테마로 정규화

## v0.8.12 — 설정 적용 응답성 패치 · 완료

- 테마 전용 설정 적용에서 타임라인·저장소 재조회 제거
- 설정 저장 작업과 화면 새로고침을 분리하고 적용 버튼을 먼저 복구
- 연속 설정 변경의 타임라인 새로고침을 한 번으로 병합
- 구버전 배열 보관 미리보기의 전체 스키마 변환 제거
- 보관 축소 승인 뒤 삭제될 구버전 항목은 건너뛰고 최신 보관분만 이전
- 대형 구버전 데이터와 설정 버튼 상태의 자동·브라우저 회귀 검증

## v0.9.0 — Rule Inspector V3 기반 · 완료

사용자가 가장 중요하게 보는 Rule Inspector의 의미 분석 기반을 만드는 대규모 검토 버전입니다.

- 지시 원자: 대상, 행동·속성, 값, 긍정·금지, 범위, 조건, 예외, 우선순위
- 각 원자의 source ID·문자 범위·role·position·depth·추출 방식·신뢰도 보존
- 지시 가능한 소스, 참고 데이터, 대화 산출물, tool·multimodal placeholder의 검사 capability 분리
- 단일 집계 카드 대신 실제 충돌 쌍·클러스터와 근거 표시
- 판정 확정·후보·근거 부족 상태 분리
- 조건부 언어, 양립 가능한 역할, 인용·예시, tool schema 오탐 회귀 fixture
- 익명화된 한국어 golden corpus와 정밀도·재현율 기준

완료 기준: 모든 새 finding이 검증 가능한 source·range·method·confidence를 갖고 기존 비교 정책이 새 검사 범주에도 적용되어야 합니다.

사용자 검토: 실제 한국어 프롬프트 묶음으로 오탐·누락을 집중 검토합니다.

구현 결과:

- 언어·형식·역할·설명/인용/이모지/코드 블록·이전 지시 무시 표현을 원자로 추출
- 조건·예외·우선순위와 source ID·원문/최종 문자 범위·role·position·depth·추출 방식·0~1 신뢰도 보존
- 지시 소스만 쌍 비교하고 참고 데이터·대화 산출물·tool 데이터·멀티모달 표시·최종 합성 결과는 capability에 따라 분리
- 비교 정책을 원자 쌍 생성 단계에 적용하고 실제 충돌 쌍·연결 클러스터·근거 레코드 생성
- 확정·후보·근거 부족 판정과 접힌 원자 상세·사람이 읽을 수 있는 클러스터 요약 표시
- 예시·인용·코드 블록·조건부 언어·양립 역할·tool schema 오탐을 포함한 익명화 golden corpus 구축
- 원자 500개·관계 200개·우선순위 경고 100개 분석 상한과 원자 카드 100개 렌더 상한 적용
- golden corpus 정밀도·재현율 95% 이상 기준과 300개 소스 성능 회귀 테스트 추가

## v0.9.1 — 비교 정책 V2와 검토 흐름 · 완료

- 그룹 정의의 mode·검사 범위와 이름 matcher를 분리해 설정 불일치 방지
- 이름 규칙 편집, 입력 중 미리보기와 여러 소스의 일괄 수동 지정
- global·preset·character·chat 정책 프로필과 적용 우선순위 표시
- 규칙·정책의 버전 지정 JSON 내보내기·가져오기·마이그레이션
- finding의 안정적인 식별자와 `유효`, `오탐`, `항상 무시`, `이번만 숨김`
- 정책 변경 전후 결과 미리보기와 로컬 감사 기록
- identifier가 없는 과거 소스를 위한 안정적인 보조 fingerprint

사용자 검토: 실제 프리셋·캐릭터·채팅별 정책 상속과 오탐 재적용을 확인합니다.

구현 결과:

- 그룹 정의의 동작·검사 범위와 이름 matcher를 분리하고 matcher 실시간 일치 수·편집·순서 변경과 여러 소스 일괄 수동 지정 구현
- 전체·프리셋·캐릭터·채팅 프로필, 같은 범위 우선순위와 좁은 범위부터의 fallback 구현
- 원시 프리셋·캐릭터·채팅 ID 대신 프리셋 API와 채팅 소유자를 포함한 버전 지정 범위 지문값을 새 스냅샷에 저장
- 구형 raw 범위 fallback과 전역 정책은 유지하되, 과거에 캡처되지 않은 프리셋 API·캐릭터·그룹 소유자 범위는 새 캡처 없이 추정하지 않음
- identifier 우선 수동 지정과 소스 순서·오프셋에 독립적인 보조 지문값, 모호한 동일 지문값의 안전한 미적용 구현
- 규칙·정책과 선택적인 검토 판정의 JSON 내보내기·검증 후 초안 가져오기, 적용 시 read-back 검증과 실패 시 백업 복원 시도, V1 정책의 결정적 V2 이전 구현
- 검사 결과의 안정적인 의미 키, 유효·오탐·범위별 항상 무시·이번만 숨김·복원과 로컬 감사 기록 구현
- 저장 전 변경 전후 규칙 설정을 독립적으로 분석하는 결과·정책 배정 미리보기와 100개 카드 상한·revision cache 구현

실사용 확인 절차는 [`USER-TEST-CHECKLIST.md`](USER-TEST-CHECKLIST.md)를 따릅니다.

## v0.9.2 — 구조 provenance와 diff 스키마 v6 · 완료

- JSON pointer, message index, role과 기존 문자 범위를 함께 기록
- 전송 계열, 선택한 생성 소스, 근거 위치와 `upstream provider 미확인`을 분리
- assistant prefill의 확정·추정 상태 분리
- source role·depth·position·enabled 메타데이터 diff
- 같은 UID 로어북의 내용·키·위치·순서 변경
- 스키마 v1~v5→v6 지연 마이그레이션, 성공 레코드의 1회 write-back과 인덱스·저장 요약 바이트 보정
- 손상 레코드 원본 보존, 정상 형제 격리 로드와 원문·식별자를 UI에 전달하지 않는 개수 안내
- 구조 위치 최대 50개와 기본 접힘 상세, 생성 경로·배치 메타데이터·로어북 변경의 모바일 안전 UI

사용자 검토: 대표 Chat Completion·Text Completion provider에서 새 구조 위치와 생성 경로를 확인하고, v0.9.2 이전 스냅샷이 원문·ID 손실 없이 열리며 기록하지 않은 위치를 추정하지 않는지 확인합니다.

## v0.10.0 — 저장·성능·개인정보 기반 · 완료

- 기간·채팅별 개수·총용량 순서의 보관 정책, origin quota와 확장 추정치 분리, preview-first garbage collection
- 누락 참조·유효 고아·잘못된 인덱스·구버전 중복/충돌 진단과 손상·충돌 raw 보존 복구
- 타임라인·소스 가상 스크롤, 분석 cache와 Worker 기반 검색·diff·규칙 검사
- 전체 원문·원문 제거본·메타데이터 전용 캡처 모드와 모드별 기능 제한
- 원문 제거본·메타데이터만 허용하는 공유 export, 포함 범위 미리보기와 seed leak fail-closed 검사
- 개인정보 모드가 섞인 보관분을 보존하는 schema v2 archive, 기본 병합·중복 제거·충돌 정책·명시적 전체 교체
- 배타적 가져오기, read-back 검증과 실패 시 건강한 항목만 재생성하지 않는 raw 저장 상태 rollback
- 허용된 집계·메타데이터만 사용하는 진단 보고서 간 비교

사용자 검토: 실제 SillyTavern IndexedDB에서 기간·용량 삭제 결과, 비공개 모드별 새 캡처, 전체 백업의 복원과 실패 상황을 확인합니다.

## v0.10.1 — 캡처 상관관계와 usage · 완료

- generation별 불투명 handle과 개수·수명 제한 session ledger로 pending prompt·request·lore·generation type·취소·종료·usage 상태 격리
- prompt와 request 양쪽에 같은 공개 ID가 있을 때만 정확 연결하고 충돌·한쪽 ID·오래된 session은 실패로 닫음
- 공개 ID가 없는 prompt→request 호환에만 유형별 FIFO를 사용하고 response usage에는 FIFO를 사용하지 않음
- 공식 SillyTavern 공개 이벤트에는 provider response usage와 대응 provider request ID가 없음을 capability matrix에서 `unsupported`로 선언
- 새 스냅샷의 로컬 입력 추정과 안전하게 하나의 generation을 고를 수 있는 `MESSAGE_RECEIVED` 출력 추정, provider 보고·미연결·산정 불가 상태 분리
- OpenAI·Anthropic·Google·호환 usage parser와 별도 공개 integration용 exact-ID response adapter 제공. 기본 이벤트에는 미연결
- 당시 provider 직접 보고 비용과 exact 사용자 override 경계를 분리했으며, v0.12.3에서 사용자 가격표 UI와 신규 재계산 경로를 제거
- 스키마 v7에서 raw correlation ID 제거, `hadCorrelationId` 보존과 구버전 토큰의 입력 전용 로컬 추정 이전
- lifecycle·usage 후속 반영의 snapshot identity 보존 원자적 update와 provider capability matrix UI

provider 서버가 후처리한 최종 HTTP packet과 내부 upstream은 공개 hook 또는 별도 companion 없이는 확정하지 않습니다.

## v0.11.0 — 선택적 AI Semantic Inspector · 완료

- 신규·기존 사용자 모두 기본 OFF이며 설정에서 직접 켜고 finding·cluster를 수동 선택해야만 준비
- `full` 스냅샷만 허용하고 redacted·metadata는 UI와 코어 양쪽에서 fail-closed
- 선택 대상의 source·atom·relation closure만 구성하고 정확한 전체 원문·제외 소스/이유·현재 provider/model·예상 입력·응답 상한을 사전 표시
- 미리보기마다 선택 해제되는 호출별 1회 동의, 취소 no-send와 retry의 새 준비·미리보기·동의
- 공개 `getContext().generateRaw()` 전용 adapter와 준비·전송 사이 provider/model identity 변경 거부
- strict JSON field/size/depth/ID 검증과 모든 evidence offset·quote의 실제 source substring 일치 확인
- 정적 결과와 분리된 `AI 제안 — 자동 적용되지 않음`, 자동 수정·판정·항상 무시·정책 변경 금지
- 전체 raw prompt·provider response와 전용 source content·evidence quote 필드는 보관하지 않되, 원문 표현을 반복할 수 있는 정규화 제안 텍스트는 제한된 TTL 동안 유지하는 memory-only digest cache
- 논리적 timeout·취소와 늦은 결과 폐기. 이미 시작된 provider 계산을 강제 중단한다고 주장하지 않음
- prompt 유형·원문 exact match의 nonce ticket 호출과 exact duplicate를 이용한 self-capture 억제, TTL·용량 제한과 모호한 동시 id-less 요청의 fail-closed
- 실제 코어·strict validator·cache에 결정적 fake adapter를 주입하고 provider/network를 호출하지 않는 성공·오류·취소 샌드박스

AI는 그룹·포함 여부·프롬프트 순서를 다시 추측하지 않습니다. `검사 가능 소스 → 사용자 정책 → 로컬 원자·후보 → 사용자 선택·전송 동의 → 선택적 AI → 근거 검증` 순서를 유지합니다.

사용자 검토: 실제 provider별 미리보기 identity, 비용, 취소 한계, 설명 품질과 오탐을 v0.11.1 체크리스트로 확인합니다.

## v0.11.1 — 캡처 회귀 수정·쉬운 UI · 완료

- 활성 AI semantic gate 중 기존 256개 문자열 경계를 넘은 긴 일반 채팅의 prompt가 폐기되어 스냅샷이 누락되던 회귀 수정
- 2MiB·8,192개 노드·4,096개 문자열의 새 bounded scan과 초과 입력 fail-closed 유지
- 원문·식별자·provider/model·오류 메시지가 없는 `capture-status`로 일반 저장, 저장 실패, AI 요청 제외와 안전상 건너뜀 구분
- `프롬프트`·`검사`·`기록`·`도구` 4개 작업 중심 탐색과 430px 모바일 배치
- 첫 사용 빠른 시작과 다시 열 수 있는 도움말, 규칙 결과 우선·고급 영역 lazy render
- 검색 필터, 타임라인 저장 관리와 설정 고급 항목 disclosure

## v0.11.2 — 캡처 종결·연결 프로필·UI 방어 · 완료

- prompt tokenizer의 미종료 Promise를 패널 세션의 공유 5초 probe로 판별하고 같은 세션을 UTF-8 byte/3.35 로컬 추정으로 전환
- 개인정보 변환·스냅샷 저장을 각각 30초로 제한하고 모든 캡처 경로를 원문 없는 `saved` 또는 `failed`로 종결
- 설정 옆 헤더 도움말·모달을 제거해 새로고침·설정·닫기만 유지하고, 필드별 tooltip과 빈 상태 빠른 시작은 보존
- disclosure 제목 좌측 정렬과 SillyTavern 테마의 button·select·`.menu_button` 폭·flex·writing-mode 덮어쓰기 방어
- 공개 Connection Manager 서비스의 지원 프로필 이름 선택, 설정 V1~V4를 V5로 이전해 opaque profile ID만 저장하고 credential·URL·비밀값 비저장
- 프로필 기능 미지원·저장 프로필 소실은 요청 전에 현재 연결을 사용하되, 시작된 프로필 요청 실패는 현재 연결로 재시도하지 않아 이중 호출·과금 방지

## v0.11.3 — 캡처 우선 저장 · 완료

- 정확한 payload와 finalText를 가진 최소 스냅샷을 privacy 변환·저장·재읽기한 뒤 상세 소스 분석을 같은 ID로 보강
- 상세 분석 작업량 상한과 getter·binary·비정상 숫자 등 비-JSON 요청 값 정규화
- finalizing·privacy·storage·storage-verify 단계별 캡처 상태 표시

## v0.11.4 — 실제 요청 선택 필드 저장 복구 · 완료

- OpenAI·TextGen 요청에 정상적으로 존재하는 `undefined` 선택 필드와 메시지 `name`을 `null`로 정규화
- sparse array·Date 경계를 보강하고 실제 이벤트 형태로 privacy 변환·저장·재조회 회귀 검증
- 저장 전 캡처 처리 실패와 실제 로컬 저장소 실패를 UI에서 구분

## v0.12.0 — 초보자 중심 UI/UX 개편 · 완료

- 토스식 `한 화면·한 우선 행동` 정보 구조와 아이콘이 있는 `프롬프트`·`검사`·`기록`·`도구` 네 작업 탭
- 헤더 이름 옆 캡처 상태 점, 좌측 정렬한 요약 제목과 시각 크기를 줄인 도움말
- 밝은/어두운 내부 고대비 색 토큰과 공격적인 SillyTavern 호스트 테마 규칙의 패널 내부 격리
- 입력칸 자동 포커스를 제거한 설정 모달, 상단 닫기, 펼쳐진 자주 쓰는 설정과 단일 `데이터 도구` 진입점
- 검사 탭의 inline AI opt-in. 활성화만으로는 provider 요청을 보내지 않으며 대상 선택·미리보기·호출별 동의 경계를 유지
- 좁은 모바일 화면의 간결한 프롬프트 비교 표

현재 빠른 시작과 tooltip은 완료된 온보딩으로 간주하지 않습니다. 코치마크·워크스루는 이번 정보 구조가 실제 사용자에게도 이해되는지 확인한 뒤 별도 범위로 구체화합니다.

v0.12.0의 4개 그룹과 조건부 하위 탭은 실제 기능을 다시 숨기고 그룹 버튼의 목적지를 불분명하게 만든다는 피드백에 따라 v0.12.1에서 폐기했습니다.

## v0.12.1 — 여섯 기능 단층 내비게이션 교정 · 완료

- `전송 프롬프트`·`규칙 검사`·`기록`·`변경 비교`·`요청 상세`·`검색`을 한 번에 보여 주는 고정 하단 tablist
- 그룹별 마지막 하위 탭 기억과 조건부 2차 탐색을 제거하고 모든 기능을 한 번에 직접 선택
- 중앙 콘텐츠만 스크롤하는 `헤더 / 콘텐츠 / 하단 내비게이션` 앱 셸과 기능별 제목·설명 tooltip
- `전송 프롬프트` 첫 화면에 요청 핵심 수치와 현재 요청 선택을 모은 단일 overview card
- 700px 이하 `100vw`·`100dvh` 모바일 셸, safe area 반영과 모바일 geometry 복원·저장 및 drag 방지
- 44px 모바일 헤더 action과 뒤에 선언된 강한 호스트 form 테마에도 유지되는 명암 대비
- 데스크톱 geometry·resize·drag와 기존 설정·캡처·개인정보·Rule Inspector·AI 동의 경계 유지

## v0.12.2 — 프롬프트·검사 흐름 정리 · 완료

- 비어 있는 정보가 많던 `요청 상세`를 없애고 `전송 프롬프트`·`기록`·`변경 비교`·`규칙 검사`·`검색` 다섯 기능으로 축소
- 생성 설정과 프롬프트 payload를 전송 프롬프트의 접힌 요청 원본 영역으로 이동
- 프리셋 기본 접힘, 전체/요청 포함 필터, 접힌 최종 프롬프트로의 위치 이동과 source별 mapping 색 보강
- 테마 즉시 저장, 일반 설정에서 AI 항목 제거, 규칙 검사 안의 로컬/AI 모드와 연결 설정 통합
- 규칙 설정·비교 정책을 제목의 설정 dialog로 이동하고 기존 캡처·개인정보·호출별 AI 동의 경계 유지

## v0.12.3 — 위치 이동·AI 연속성·표시 안정화 · 완료

- 툴팁 중앙 정렬, 구조 위치의 28px 조준 아이콘, 최종 프롬프트 중복 이동 버튼 제거와 접힌 최종 근거 자동 펼침
- AI 검사 중 탭 이동에도 요청·결과 유지, 사용자 추가 검사 프롬프트·응답 프리필의 bounded 로컬 저장과 호출별 동의 미리보기
- 정확한 인용문이 원문에 있을 때만 근거 offset을 bounded 재정렬하고, 완성 JSON 응답에는 프리필을 중복 결합하지 않음
- 사용자 가격표 UI·죽은 편집 코드·신규 비용 재계산을 제거하고 provider 보고 비용과 과거 스냅샷 읽기 호환만 유지
- Chat Completion 컨텍스트 한도 탐지, provider/model 줄바꿈, 새로고침 완료 상태, 작은 토큰 편차 확대 그래프와 native 체크박스 격리

## v0.12.4 — 활성 소스 판정·설정 밀도 보정 · 완료

- 실제 활성 플래그가 명시된 소스만 `연결 위치를 확인하지 못한 활성 소스` 알림 대상으로 제한해 캐릭터 그리팅 등 상태 미확인 소스의 오탐 제거
- 모바일 설정 폼·섹션·필드 여백을 압축하면서 disclosure의 44px 터치 영역 유지

## v0.13.0 — AI 품질 평가·호환성·실사용 보강 · 완료

- 합성·익명 corpus 5건과 AI 제안 유용성·오탐률·같은 source에서 IoU 0.5 이상인 근거 pair 적중률의 결정적 회귀 기준
- OpenAI 계열·Anthropic·Google 계열과 Connection Manager profile의 알려진 응답 envelope 정규화
- 인증·요청 한도·네트워크·timeout·일시 장애·거부·응답 구조 오류의 안정된 코드·고정 사유와 한국어 설명
- AI 근거 source 이름 표시, live status·`aria-busy`, 오류 진단 보조 텍스트와 요청 한도 샌드박스 fixture

## v0.13.x — 실제 provider 호환 패치 · 필요 시

- 실제 SillyTavern 연결 프로필에서 재현되는 추가 envelope·공개 오류 필드만 fixture와 함께 보강
- 원문 오류·credential을 수집하지 않고 안정된 코드와 provider family·route 종류만으로 문제 보고

## v0.14.x 후속 후보 — 의미 판정 범위 보강

- title·summary·rationale의 의미 정확성을 사람이 판정하는 bounded rubric
- 말투와 안전 의미를 과잉 탐지하지 않는 정적 atom·relation 분류와 제품 경로 양성/음성 fixture
- 실제 OpenAI·Anthropic·Google × current/profile 세션에서 확인된 bounded envelope 호환 패치
- provider 평가 세션의 원문 없는 로컬 내보내기는 실제 사용 필요가 확인될 때만 별도 설계

## v0.15.x 후속 후보 — 온보딩 문구·동선 보정

- 실제 초보자 검토에서 막히는 단계의 briefing 길이·practice 할 일·debrief 결과 설명과 320px·390px sheet 밀도 보정
- 제품 기능 추가 시 새 단계를 무조건 늘리지 않고 기존 6개 주제·38단계 중 가장 가까운 개념에 우선 편입
- 실제 snapshot store·provider·clipboard·export 비변경, 종료 시 live view 복구와 최소 상태 저장 경계 유지

hands-on 흐름은 프롬프트 원문이나 AI 전송을 자동 실행하지 않습니다.

## 장기 후보 · 버전 미정

Prompt Playground, Prompt Dependency Graph, Lore Trigger Simulator와 Extension Debug Panel은 평가·개인정보·원본 불변·접근성 경계가 확인된 뒤 각각 독립적으로 계획합니다.

## v1.0.0 — 안정화

- 지원 SillyTavern 버전 matrix
- schema migration·복원 rehearsal
- 개인정보 threat model과 내보내기 검토
- 접근성·시각 회귀와 성능 budget
- 저장 손상·캡처 실패 복구
- 한국어 Rule Inspector corpus의 목표 정확도
- 사용자 문서·용어·온보딩 고정

Visual Prompt Builder, Optimization Wizard와 원본 자동 적용은 Playground의 감사 기록·undo·안전 경계가 검증된 이후 1.x 연구 기능으로 둡니다.
