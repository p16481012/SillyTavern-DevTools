# v0.10.1 사용자 실사용 체크리스트

v0.10.1은 generation별 상관관계, 로컬 usage 추정, 사용자 가격 override와 스키마 v7 개인정보 경계를 추가합니다. 아래 항목은 실제 SillyTavern 이벤트·채팅 메시지·IndexedDB·브라우저 UI에서 확인해야 하는 검토 절차입니다. 공식 SillyTavern 공개 이벤트에는 provider response usage와 대응 provider request ID가 없으므로, 기본 설치에서 provider 보고 usage가 나타나는 것을 성공 조건으로 삼지 않습니다.

## 시작 전

- [ ] ST DevTools 제목에 `v0.10.1`이 표시된다.
- [ ] 중요한 스냅샷은 먼저 `전체 원문 백업`으로 내려받아 공유되지 않는 위치에 보관한다.
- [ ] lifecycle·가격·복원 검사는 실제 보관분과 분리한 테스트 채팅 또는 테스트 브라우저 프로필에서 한다.
- [ ] SillyTavern 버전, 브라우저, Chat/Text Completion, 선택 source와 model을 기록한다.

## 단일 generation lifecycle

- [ ] 새 메시지를 한 번 생성하면 스냅샷의 생성 상태가 `시작 → 종료` 흐름과 맞고 같은 snapshot ID가 유지된다.
- [ ] 생성 도중 중단하면 해당 스냅샷만 `중단`으로 바뀌고 직전 스냅샷의 lifecycle은 변하지 않는다.
- [ ] request-ready 이벤트가 있는 경로에서는 요청 캡처 상태와 사용한 이벤트가 실제 생성 경로와 맞다.
- [ ] prompt-only 대체 경로에서는 provider 요청 본문을 확보했다고 표시하지 않고 대체 캡처임을 설명한다.
- [ ] OpenRouter·proxy·사용자 지정 API의 내부 upstream provider는 공개 근거 없이 업체명으로 확정되지 않는다.

## 로컬 입력·출력 usage

- [ ] 새 스냅샷의 입력 토큰은 `local-estimate`와 `local-prompt-tokenizer` 출처로 표시되고 출력·캐시·합계는 근거가 생기기 전 `알 수 없음`으로 남는다.
- [ ] `MESSAGE_RECEIVED` 뒤 현재 메시지의 `extra.token_count`가 유효하고 하나의 활성 generation만 선택 가능한 경우 출력 토큰이 로컬 추정치로 합쳐진다.
- [ ] 출력 토큰이 합쳐져도 provider 보고값·청구 금액·캐시 토큰으로 잘못 표시되지 않는다.
- [ ] 메시지에 유효한 `extra.token_count`가 없으면 출력값을 임의 계산하지 않고 `산정 불가`로 남는다.
- [ ] UI의 capability matrix에서 공식 response event·stream usage·public response correlation·provider 비용이 기본적으로 `지원 안 함`으로 표시된다.
- [ ] 별도 integration을 설치하지 않은 기본 SillyTavern에서 provider-reported usage가 나타나면 원문이나 API key 없이 재현 정보를 기록한다.

## 동시 generation과 실패로 닫히는 연결

- [ ] 가능하다면 두 generation을 겹쳐 실행해 각 스냅샷의 생성 유형·로어북·중단/종료 상태가 서로 바뀌지 않는지 확인한다.
- [ ] 동시 generation 중 `MESSAGE_RECEIVED`만으로 대상을 하나로 고를 수 없으면 출력 토큰이 어느 스냅샷에도 임의 연결되지 않는다.
- [ ] 공개 ID가 없는 prompt→request 호환 연결은 동작하더라도 response usage를 FIFO로 붙이지 않는다.
- [ ] 공개 ID가 충돌하거나 한쪽 이벤트에만 있는 경우 다른 pending generation으로 fallback하지 않고 미연결·산정 불가 상태를 유지한다.
- [ ] 동시 생성 종료 뒤 새 단일 generation을 만들면 오래된 session의 lore·usage·lifecycle이 새 스냅샷에 재사용되지 않는다.

## 가격 override 추가·삭제·재로드

- [ ] 설정에서 테스트용 provider·model·통화, 입력/출력 백만 토큰 단가와 기준일을 추가하고 적용한다.
- [ ] 설정을 닫았다 다시 열어 값이 유지되고, SillyTavern을 새로고침한 뒤에도 같은 값이 로드된다.
- [ ] 해당 provider·model이 정확히 일치하는 스냅샷에서 알려진 토큰 항목만 비용 계산에 사용된다.
- [ ] provider 또는 model 철자 하나를 다르게 저장하면 유사 항목을 추측하지 않고 비용이 `산정 불가`로 남는다.
- [ ] 같은 provider·model에 USD와 KRW처럼 둘 이상의 통화를 저장하면 UI가 통화를 임의 선택하지 않고 `산정 불가`로 남는다.
- [ ] 일부 단가만 입력한 경우 계산 가능한 부분은 `하한`으로 표시되고 완전한 예상 비용처럼 표시되지 않는다.
- [ ] 캐시 입력 단가를 비워 둔 항목은 기본 입력 단가 규칙을 사용하며, 캐시 토큰 자체가 없으면 캐시 비용을 만들지 않는다.
- [ ] 가격 항목을 삭제하고 적용한 뒤 설정 재진입·새로고침에서도 사라지고 기존 스냅샷의 비용은 다시 `산정 불가`가 된다.
- [ ] 설정 어디에도 OpenAI·Anthropic·Google 등의 최신 가격이 자동 입력되거나 내장 가격표로 갱신되지 않는다.

테스트 단가는 실제 청구 가격과 다른 작은 임의값을 사용해도 됩니다. 스크린샷이나 이슈에는 실제 계정·조직·proxy 식별자와 결제 정보를 포함하지 마세요.

## 스키마 v7·개인정보·archive 이전

- [ ] 업데이트 직후 대표적인 v0.10.0 이하 스냅샷이 원문·snapshot ID·시간을 유지한 채 열린다.
- [ ] 구버전 `stats.totalTokens`는 입력 전용 `legacy-snapshot-token-count` 로컬 추정치로 보이고 출력·캐시·provider 비용은 추측되지 않는다.
- [ ] 새 스냅샷과 이전된 스냅샷을 JSON으로 검토할 때 `capture.correlationId`·`request.correlationId`에 raw ID가 남지 않고 `hadCorrelationId` boolean만 남는다.
- [ ] 요청 본문의 알려진 root·metadata correlation key는 제거되지만 프롬프트 도메인 데이터의 일반 `id`는 사라지지 않는다.
- [ ] full·redacted·metadata 스냅샷이 섞인 기존 archive를 테스트 프로필에 병합하면 privacy mode와 usage 상태가 유지된다.
- [ ] 같은 archive를 다시 병합하면 중복 항목이 늘지 않고, 전체 교체는 정확한 확인 문자열 없이는 시작되지 않는다.
- [ ] archive 가져오기 또는 v7 이전에 실패한 항목은 성공으로 표시되지 않으며 정상 형제 스냅샷은 계속 열린다.
- [ ] redacted·metadata 공유 문서에 raw correlation ID, 요청 원문, 가격 설정 전체가 새로 포함되지 않는다.

## 원자적 후속 갱신과 저장 실패

- [ ] generation 종료 또는 출력 usage가 캡처 저장보다 늦게 도착해도 같은 snapshot ID의 lifecycle·usage만 갱신된다.
- [ ] 후속 갱신 뒤 타임라인 정렬, 전체 스냅샷 수와 대략적 용량이 새로고침 전후에 일치한다.
- [ ] 저장 실패가 자연스럽게 발생하면 다른 snapshot으로 갱신을 옮기지 않고 실패 상태를 표시한다.
- [ ] 재시도 시 새 snapshot을 중복 생성하지 않고 기존 저장 identity를 유지한다.

## 모바일·좁은 화면 UI

- [ ] 약 430px 폭에서 설정의 가격 항목 추가·삭제·단가·통화·기준일 입력이 가로로 잘리거나 패널 밖으로 나가지 않는다.
- [ ] 컨텍스트 usage 카드의 네 토큰 항목, 상태, 비용·출처·기준일이 겹치지 않고 긴 model/provider 이름이 안전하게 줄바꿈된다.
- [ ] capability matrix를 펼치고 닫을 수 있으며 도움말이 화면 경계를 벗어나지 않는다.
- [ ] 가격 설정 오류 뒤 적용 버튼이 영구 비활성화되지 않고 수정·취소·재진입이 가능하다.
- [ ] 키보드 focus가 가격 항목 추가·삭제, 적용·취소와 usage capability 토글에서 보인다.

## 문제 보고 시 남길 정보

- [ ] SillyTavern·ST DevTools·브라우저 버전과 일반/비공개 창 여부를 기록한다.
- [ ] 단일/동시 generation, Chat/Text Completion, 선택 source·model과 lifecycle 순서를 기록한다.
- [ ] usage 문제는 상태, 화면에 표시된 source event, 입력·출력 값의 존재 여부만 기록한다.
- [ ] 가격 문제는 실제 금액 대신 exact/mismatch/multi-currency 중 어떤 경우인지와 통화 코드만 기록한다.
- [ ] 이전·복원 문제는 원본 snapshot schema, privacy mode, merge/replace와 오류 code만 기록한다.
- [ ] prompt 원문·API key·raw request/response ID·전체 archive·IndexedDB raw 값은 이슈에 첨부하지 않는다.

## 다음 버전

v0.11.0은 기본 꺼짐 상태에서 사용자가 고른 로컬 finding·cluster만 호출별 동의 후 전송하고, 엄격한 근거 검증을 통과한 결과를 정적 검사와 분리해 보여 주는 선택적 AI Semantic Inspector를 계획하고 있습니다. 아직 v0.10.1의 완료 기능이 아닙니다.
