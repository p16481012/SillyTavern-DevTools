# ST DevTools 구현 로드맵

이 문서는 v0.8.7 코드와 자동 테스트를 기준으로 남은 기능을 나눈 예상 계획입니다. 버전 번호는 기능 의존 관계를 나타내며 일정 약속은 아닙니다.

## 현재 기준선

v0.8.7은 캡처한 요청을 읽기 전용으로 탐색·비교하고, 명시적인 언어·형식·역할·지시·정확 중복을 검사할 수 있습니다. 사용자 이름 규칙과 수동 지정으로 대안 프롬프트를 그룹화하며, 비활성 또는 실제 요청 미포함 소스를 비교에서 제외합니다. 저장 backend·용량과 캡처 종료 상태를 화면에 표시하고, 정규식 격리·캡처 전체 민감 정보 정제·내보내기 경고를 적용했습니다.

아직 Rule Inspector는 자연어 의미 전체를 이해하지 않습니다. 조건·예외·말투·정체성·안전·메모리·실제 우선순위와 같은 판단을 확장하려면 AI 연결보다 먼저 구조화된 로컬 근거가 필요합니다.

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

## v0.9.0 — Rule Inspector V3 기반

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

## v0.9.1 — 비교 정책 V2와 검토 흐름

- 그룹 정의의 mode·검사 범위와 이름 matcher를 분리해 설정 불일치 방지
- 이름 규칙 편집, 입력 중 미리보기와 여러 소스의 일괄 수동 지정
- global·preset·character·chat 정책 프로필과 적용 우선순위 표시
- 규칙·정책의 버전 지정 JSON 내보내기·가져오기·마이그레이션
- finding의 안정적인 식별자와 `유효`, `오탐`, `항상 무시`, `이번만 숨김`
- 정책 변경 전후 결과 미리보기와 로컬 감사 기록
- identifier가 없는 과거 소스를 위한 안정적인 보조 fingerprint

사용자 검토: 실제 프리셋·캐릭터·채팅별 정책 상속과 오탐 재적용을 확인합니다.

## v0.9.2 — 구조 provenance와 diff 스키마 v6

- JSON pointer, message index, role과 기존 문자 범위를 함께 기록
- 전송 계열, 선택한 생성 소스, 근거 위치와 `upstream provider 미확인`을 분리
- assistant prefill의 확정·추정 상태 분리
- source role·depth·position·enabled 메타데이터 diff
- 같은 UID 로어북의 내용·키·위치·순서 변경
- v4→v5 지연 마이그레이션, 왕복·손상 fixture와 복구 경계

사용자 검토: 대표 provider와 오래된 스냅샷의 provenance·migration 표본을 확인합니다.

## v0.10.0 — 저장·성능·개인정보 기반

- 채팅별 전체 배열 대신 snapshot 단위 record와 별도 index
- 개수·기간·용량 기준 보관 정책, quota 표시, garbage collection과 손상 복구
- 타임라인·소스 가상 스크롤, 분석 cache와 Worker 기반 검색·diff·규칙 검사
- 원문·민감 정보 제거본·메타데이터 전용 캡처 모드
- 공유용 제거본 export와 내보내기 전 데이터 미리보기
- 스냅샷 백업·복원·병합, 중복 제거와 스키마 검증
- 진단 보고서 간 비교

사용자 검토: 저장 마이그레이션과 개인정보·복원 흐름을 대규모로 확인합니다.

## v0.10.1 — 캡처 상관관계와 usage

- generation 단위 pending lore·generation type·취소 상태
- 공개 요청 ID 우선 연결과 ID가 없을 때의 명시적인 FIFO·미연결 상태
- SillyTavern 최소·현재 버전 이벤트 호환 matrix와 실제 IndexedDB E2E
- 공개 응답 event에서 같은 ID가 확인될 때만 usage를 정확 연결
- 정확·미연결·추정 usage와 비용을 구분하고 가격 출처·기준일·사용자 override 표시

provider 서버가 후처리한 최종 HTTP packet과 내부 upstream은 공개 hook 또는 별도 companion 없이는 확정하지 않습니다.

## v0.11.0 — 선택적 AI Semantic Inspector

- 로컬 정책과 Rule V3가 좁힌 후보만 사용자가 눌렀을 때 분석
- 전송할 원문·제외 항목·provider·model·예상 입력 토큰·비용 사전 확인
- provider 중립 adapter와 구조화 JSON 결과
- source·atom ID와 근거 substring 검증, 알 수 없는 ID 거부
- timeout·취소·retry와 snapshot·policy·model hash cache
- prompt injection을 포함할 수 있는 프롬프트 원문을 비신뢰 입력으로 처리
- 정적 결과와 분리된 `AI 제안` 표시, 자동 수정 금지
- AI 자체 호출이 새 스냅샷으로 다시 캡처되지 않도록 skip tag 또는 캡처 억제 범위

AI는 그룹·포함 여부·프롬프트 순서를 다시 추측하지 않습니다. `검사 가능 소스 → 사용자 정책 → 로컬 원자·후보 → 선택적 AI → 근거 검증` 순서를 유지합니다.

사용자 검토: 전송 동의, 비용, 설명 품질과 오탐을 대규모로 확인합니다.

## v0.12.0 — Prompt Playground MVP

- 스냅샷 복제본만 임시 편집
- 토큰·diff·Rule Inspector 재실행
- reset·discard와 patch export
- SillyTavern 실제 프롬프트·설정에는 쓰지 않는 경계
- AI 수정안도 미리보기 제안으로만 표시하고 사용자가 수동 채택

사용자 검토: 원본 불변성과 폐기·초기화 동작을 대규모로 확인합니다.

## v0.12.x — 고급 분석 도구

한 버전에 모두 묶지 않고 각각 독립 beta로 진행합니다.

1. Prompt Dependency Graph
2. Lore Trigger Simulator
3. Extension Debug Panel

Lore Trigger Simulator와 신뢰할 수 있는 dead lore 판정은 전체 lore 정의·trigger·비활성 상태의 읽기 전용 캡처 및 개인정보 동의가 선행되어야 합니다.

## v0.13.0 — 코치마크와 워크스루

정보 구조가 안정된 뒤 다음 세 가지 짧은 과정부터 제공합니다.

- 첫 스냅샷과 캡처 경계 확인
- 두 스냅샷 비교
- Rule Inspector 비교 정책 설정

모바일·키보드·screen reader, 건너뛰기·다시 보기·초기화와 로컬 완료 상태를 지원하며 사용 추적 telemetry는 기본으로 두지 않습니다.

## v1.0.0 — 안정화

- 지원 SillyTavern 버전 matrix
- schema migration·복원 rehearsal
- 개인정보 threat model과 내보내기 검토
- 접근성·시각 회귀와 성능 budget
- 저장 손상·캡처 실패 복구
- 한국어 Rule Inspector corpus의 목표 정확도
- 사용자 문서·용어·온보딩 고정

Visual Prompt Builder, Optimization Wizard와 원본 자동 적용은 Playground의 감사 기록·undo·안전 경계가 검증된 이후 1.x 연구 기능으로 둡니다.
