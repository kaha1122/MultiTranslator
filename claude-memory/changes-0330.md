---
name: changes-0330
description: 2026-03-30 메뉴 순서/라벨 전면 개편, 자주색 테마, 학습기록 분리, 탭 타이틀바 교체, 스크롤바 숨김
type: project
---

# 2026-03-30 변경사항 (v1.3.96)

## 1. 메뉴 순서 및 라벨 전면 변경
- **홈 탭 학습메뉴**: vocab→scene→listening→translation→video (5개)
- **학습기록 섹션 신설**: library(단어장)를 학습메뉴에서 분리하여 별도 "학습기록" 박스로 이동
- **사이드바 순서**: home→vocab→scene→listening→translation→video→library→stats
- **TAB_ORDER (도트/스와이프)**: `['home','vocab','scene','listening','translation','video','library','stats']`
- **번호 접두사 추가**: 00.홈, 01.단어학습, 02.대화연습, 03.듣기연습, 04.다중언어번역기, 05.동영상, 06.단어장, 07.통계
- **라벨 변경**: "보이스 사전" → "다중언어번역기" (전 언어 공통)
- 10개 언어 i18n 전체 업데이트 (ko/en/ja/zh-CN/vi/fr/de/es/ru/pt-BR)
- `home.recordSection` 키 신규 추가 (학습기록 섹션 타이틀)

## 2. 자주색(Purple) 테마 적용
- **홈 폴더 라벨**: `.home-folder-tab-label` color → `#7B2D8E` (비활성시), 활성시 원래 폴더 테마색(`var(--folder-color)`) 유지
- **사이드바 메뉴**: `.sidebar-nav-item` color → `#7B2D8E`, active/hover → `#5B1A6E` + `background: #f5f0ff`
- **설정/Q&A 제외**: `sidebar-nav-util` 클래스 추가하여 검은색(`#475569`) 유지, active시 기존 녹색 테마
- **폴더 테마색 원복**: 각 폴더의 color/bgColor/borderColor는 원래값 유지 (green/indigo/purple/amber/rose/cyan)

## 3. 탭 타이틀바 교체
- **제거**: 기존 마키(좌→우 흐르는 텍스트) `tab-context-bar` + `.marquee-inner` 애니메이션 삭제
- **신규**: `.tab-title-bar` — 각 탭별 아이콘 + 컬러 좌측선 + 자주색 탭 이름
  - 아이콘: 🏠홈/📖단어/🎭대화/🎧듣기/🔤번역/🎬동영상/⭐단어장/📊통계
  - 좌측선 색상: 각 탭 테마색 (home=#00a884, vocab=#059669, scene=#6366f1, listening=#7c3aed, translation=#d97706, video=#e11d48, library=#0891b2, stats=#6366f1)
  - 배경: 해당 테마색 10% 투명도 그라데이션
  - 글씨: `font-size: 1.1rem`, `font-weight: 800`, `color: #7B2D8E`
  - 가운데 정렬 (`justify-content: center`)

## 4. 스크롤바 숨김
- `.app-container`에 스크롤바 숨김 처리 (스크롤 기능 유지)
  - `scrollbar-width: none` (Firefox)
  - `-ms-overflow-style: none` (IE/Edge)
  - `::-webkit-scrollbar { display: none }` (Chrome/Safari/Edge)

## 변경 파일 목록
- `src/App.jsx` — TAB_ORDER, 사이드바 순서, 탭 타이틀바 (TAB_STYLE 객체)
- `src/App.css` — tab-title-bar 스타일, 사이드바 자주색, sidebar-nav-util, 스크롤바 숨김
- `src/components/HomePage.jsx` — folders 배열 순서, recordFolders 분리
- `src/components/HomePage.css` — 폴더 라벨 자주색
- `src/locales/*.json` (10개) — 번호 접두사, 라벨 변경, recordSection 키 추가

## 버전/배포
- v1.3.96: Vercel production + staging, Capgo production 배포 완료
