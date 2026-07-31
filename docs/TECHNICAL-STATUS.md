# v0.10.1 기술 구현 현황

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

### Usage·비용과 correlation

- `provider-reported`·`local-estimate`·`unlinked`·`unavailable` 상태와 입력·출력·캐시·합계·근거 이벤트·연결 시각의 엄격한 정규형
- OpenAI·Anthropic·Google·호환 usage shape의 제한된 parser와 음수·NaN·과대·모순·prototype 오염 거부
- 새 스냅샷의 로컬 prompt tokenizer 입력 추정과 유효한 `MESSAGE_RECEIVED`의 단일 활성 generation 출력 추정
- response usage는 같은 공개 ID로만 연결하고 ID가 없거나 모호하면 별도 미연결 상태로 남기며 response FIFO 금지
- 공식 SillyTavern 공개 이벤트에는 provider response usage와 대응 provider request ID가 없다는 기본 capability matrix
- provider 직접 보고 비용 또는 사용자의 provider·model·currency 정확 일치 가격 override만 허용하고 내장 가격표 없음
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
- usage·pricing 상한·정규형·정확 일치와 v1~v6→v7 개인정보 이전

### 릴리스 전 결정적 UI 샌드박스 검토 대상

- 전체 원문·원문 제거본·메타데이터 fixture의 탭별 안내와 사용 불가 기능 차단
- 보관 정책·privacy mode·저장 도구가 있는 설정/도구 패널의 모바일·데스크톱 배치
- 저장 실패·임시 메모리·요약 재계산·테마 전환 fixture와 진단 가져오기 성공/거부 상태
- mixed privacy fixture를 사용하는 archive·safe share·진단 비교 조작 경로
- usage 상태·비용 출처·capability matrix, 가격 override 추가·삭제·재로드와 모바일 배치

샌드박스는 가짜 저장 backend와 fixture를 사용합니다. 실제 SillyTavern 이벤트, 사용자의 IndexedDB, 브라우저 비공개 모드와 provider 응답을 대신 검증하지 않습니다.

### 실제 SillyTavern에서 사용자 확인이 필요한 것

- 사용 중인 브라우저의 IndexedDB에서 v0.9.x 데이터가 그대로 열리고 정책 적용·새 캡처가 함께 안전하게 직렬화되는지
- 기간·용량 축소 미리보기 수와 적용 뒤 실제 저장 건수, quota 부족·비공개 모드의 오류 및 재시도 동작
- 각 privacy mode를 고른 뒤 새로 생성한 Chat/Text Completion 스냅샷의 표시와 기능 제한
- 전체 backup을 별도 테스트 데이터로 merge·충돌 유지·replace했을 때 새로고침 뒤에도 결과가 유지되는지
- 실제 provider/model별 구조 provenance, 선택 소스, assistant prefill과 캡처 lifecycle 정확성
- 단일·동시 generation에서 `MESSAGE_RECEIVED` 출력 추정이 다른 스냅샷에 섞이지 않는지
- 가격 override의 provider·model·currency 정확 일치, 불일치와 복수 통화 산정 불가 상태

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

## 아직 미구현

### v0.11.0 예정

- 기본 꺼짐 상태의 선택적 AI Semantic Inspector
- 사용자가 선택한 로컬 finding/cluster만 대상으로 하는 호출별 전송 동의와 provider·model·토큰·비용 미리보기
- provider 중립 adapter와 엄격한 구조화 결과 계약
- source·atom·relation ID와 정확한 quote offset 검증, 알 수 없는 근거가 하나라도 있으면 전체 제안 거부
- 정적 결과와 분리된 AI 제안, 자동 수정·정책 변경·항상 무시 금지
- raw 요청/응답을 남기지 않는 digest cache와 AI 호출의 신뢰된 단일 사용 캡처 억제

### 이후 범위

- Prompt Playground의 임시 편집·재조립·실시간 diff·폐기
- Prompt Dependency Graph, Lore Trigger Simulator, Extension Debug Panel
- 문장 재배열을 포함하는 fuzzy provenance와 지원 범위를 넓힌 멀티모달 추정
- 정보 구조 안정화 뒤 코치마크·단계별 워크스루

## 다음 구현 우선순위

1. v0.11.0에서 전송 동의·근거 검증·캡처 억제를 갖춘 선택적 AI 분석을 추가합니다.
2. 각 버전은 자동 테스트와 결정적 샌드박스를 통과한 뒤 다음 버전으로 넘어가고, 실제 provider·IndexedDB 경계는 사용자 체크리스트로 별도 확인합니다.
