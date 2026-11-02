# @dungsil/dsh-plugin-korean-ime

DeepSeek Harness 대화 입력창의 한국어 IME Enter 처리를 제공합니다.

- Enter로 한글 조합을 확정하면 메시지를 전송합니다.
- Shift/Alt+Enter와 다른 입력창의 기본 동작은 변경하지 않습니다.
- UI 언어와 무관하게 작동합니다. 한국어 번역은 포함하지 않습니다.
- DOM에서는 후보 확정과 전송 의도를 구분할 수 없으므로, Enter로 IME 후보를 선택하면서 조합을 끝내는 경우에도 전송합니다.
