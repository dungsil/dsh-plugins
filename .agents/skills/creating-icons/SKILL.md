---
name: creating-icons
description: Creates and updates dsh UI control icons using the repository's Lucide-based SVG rules and shared icon exports. Use when adding, editing, replacing, or reviewing UI icons in dsh-plugins.
---

# Creating Icons

dsh의 기존 look and feel을 유지하면서 공통 아이콘을 재사용하거나 Lucide 규칙에 맞는 SVG 아이콘을 작성합니다.

## 1. 기존 아이콘을 먼저 확인합니다

- `tools/ui/src/icons.ts`와 `tools/ui/src/icons-dom.ts`, `tools/ui/src/icons/`에서 재사용할 수 있는 아이콘을 찾습니다.
- DSH가 제공하는 아이콘은 기존 공통 컴포넌트를 재사용합니다. 필요한 아이콘이 아직 노출되지 않았다면 `tools/ui`에서 명시적으로 재노출합니다.
- 플러그인은 `@deepseek-ai/dsh-client-ui-primitives`를 직접 가져오지 않습니다. React에서는 `@dungsil/dsh-ui/icons`, DOM 메뉴에서는 `@dungsil/dsh-ui/icons/dom`의 기존 내보내기와 헬퍼를 우선 사용합니다.
- 자체 아이콘이 필요하면 [Lucide 아이콘 디자인 가이드](https://lucide.dev/guide/design/icon-design-guide)와 아래 규칙을 따릅니다. 이 스킬은 UI 컨트롤 아이콘에 적용하며, 플러그인 로고나 브랜드 이미지 제작에는 적용하지 않습니다.

## 2. SVG를 작성합니다

아이콘별 SVG 파일을 `tools/ui/src/icons/`에 저장합니다. 파일명은 용도보다 도형을 설명하는 영어 lower-kebab-case로 작성합니다. 예를 들어 `model-settings.svg` 대신 `circle-to-squares.svg`를 사용합니다.

SVG 루트에는 다음 속성을 모두 명시합니다.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m4 13 5 5L20 6"/>
</svg>
```

- 도형은 24×24 좌표계에 중심 정렬된 선으로 작성합니다. 선을 포함한 외곽 여백은 최소 1px, 연결되지 않은 도형 간 간격은 최소 2px로 유지합니다.
- 사각형의 모서리 반경은 크기가 8px 이상이면 2px, 그보다 작으면 1px로 설정합니다.
- 시각적 중심·부피·밀도를 기존 아이콘과 맞추고, 곡선은 매끄럽게 연결하며 가능한 한 픽셀 격자에 정렬합니다.
- SVG 내부에는 기본 도형(`path`, `line`, `polygon`, `polyline`, `circle`, `ellipse`, `rect`)과 좌표·크기 속성만 사용합니다. `transform`, 필터, `use`, 개별 도형의 색상·선 속성은 사용하지 않습니다.
- 경로 좌표의 소수점 정밀도는 최대 세 자리로 제한합니다.

## 3. 공통 모듈을 통해 연결합니다

- 사용처에 맞게 `tools/ui/src/icons.ts` 또는 `tools/ui/src/icons-dom.ts`의 기존 패턴으로 아이콘을 내보냅니다. 플러그인별로 SVG를 복제하지 않습니다.
- SVG는 클라이언트 빌드에서 문자열로 인라인합니다. 소비하는 패키지의 기존 빌드 설정을 확인하고, 필요한 경우 `.svg`에 대한 `text` 로더를 사용합니다.
- DOM에서는 기존 `createIconGlyph`를 사용하고, React에서는 기존 컴포넌트 패턴을 따릅니다. 마크업으로 삽입하는 SVG는 빌드에 포함된 신뢰할 수 있는 정적 자산으로 한정합니다.
- 실제 표시 크기는 사용처의 CSS나 컴포넌트 속성으로 조절하며, SVG의 24×24 좌표계는 변경하지 않습니다.
- 아이콘만 있는 컨트롤의 접근성 이름은 해당 버튼에 지정합니다. 새 UI 문구를 추가하면 영어·한국어·중국어 로케일을 모두 제공합니다.

## 4. 결과를 검증합니다

- SVG 루트 속성, 허용된 도형과 속성, 여백·간격·모서리 반경·좌표 정밀도를 검사합니다.
- 영향받는 패키지의 타입 검사와 테스트를 실행하고, 최신 플러그인을 빌드하여 SVG가 인라인되는지 확인합니다.
- 현재 작업 세션과 분리된 검증용 `web` 프로필에 최신 빌드를 설치하고 활성화합니다. 현재 작업 세션의 번들은 변경하거나 제거하지 않습니다.
- 실제 dsh 세션에서 아이콘을 사용하는 상태를 실행하여 실제 표시 크기, 정렬, 선 두께, 주변 아이콘과의 일관성 및 버튼의 접근성 이름을 확인합니다. 스크린샷을 캡처한 뒤 직접 검사하며, 상호작용이 바뀌면 해당 동작도 검증합니다. UI 문구가 바뀌면 영어·한국어·중국어 표시도 각각 확인합니다.
- 검증한 dsh 버전, 세션, 절차와 결과를 대화나 요청받은 PR 본문에 기록합니다. 실행하지 못한 검증은 사유와 함께 명시하고, 자동 검사 통과만으로 실제 세션 검증을 완료했다고 표시하지 않습니다.
