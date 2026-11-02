# @dungsil/dsh-plugin-korean-ime

DeepSeek Harness 대화 입력창의 한국어 IME Enter 처리를 제공합니다.

- Enter로 한글 조합을 확정하면 메시지를 전송합니다.
- Shift/Alt+Enter와 다른 입력창의 기본 동작은 변경하지 않습니다.
- UI 언어와 무관하게 작동합니다. 한국어 번역은 포함하지 않습니다.
- DOM에서는 후보 확정과 전송 의도를 구분할 수 없으므로, Enter로 IME 후보를 선택하면서 조합을 끝내는 경우에도 전송합니다.

한국어 UI 플러그인을 설치하면 이 구성 요소도 함께 설치됩니다. **플러그인 → 설치됨 → 한국어 UI → 구성 요소 → 한국어 IME**에서 따로 끌 수 있습니다. 비활성화하면 DSH의 기본 IME 처리로 돌아갑니다.

번역 없이 IME 처리만 설치하려면 다음 명령을 사용하세요. `web`은 사용할 프로필 이름으로 바꾸세요.

```sh
dsh plugin --profile web add @dungsil/dsh-plugin-korean-ime
```
