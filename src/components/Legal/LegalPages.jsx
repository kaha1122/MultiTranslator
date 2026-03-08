import React, { useEffect } from 'react';
import { ArrowLeft, Mail, Shield, FileText } from 'lucide-react';
import './LegalPages.css';

// ─────────────────────────────────────────────────────────────────────────────
// LegalPages.jsx
// 목적: Google AdSense 승인 및 법적 요건을 충족하기 위한 3가지 페이지를 담은 컴포넌트
//   - PrivacyPolicyPage : 개인정보처리방침 (AdSense 필수)
//   - TermsOfServicePage: 이용약관
//   - ContactPage       : 연락처
//
// 사용 방법: App.jsx에서 viewMode === 'privacy' / 'terms' / 'contact' 일 때 각각 렌더링
// ─────────────────────────────────────────────────────────────────────────────

// ── 공통 레이아웃: 뒤로가기 버튼 + 제목 헤더 ──────────────────────────────────
function LegalLayout({ icon: Icon, title, onBack, children }) {
    useEffect(() => {
        history.pushState({ page: 'legal' }, '');
        const handlePop = () => onBack();
        const handleKey = (e) => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key === 'Backspace' || e.key === 'Escape') {
                e.preventDefault();
                history.back();
            }
        };
        window.addEventListener('popstate', handlePop);
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('popstate', handlePop);
            window.removeEventListener('keydown', handleKey);
        };
    }, [onBack]);

    return (
        <div className="legal-container">
            {/* 상단 뒤로가기 헤더 */}
            <div className="legal-header">
                <button className="legal-back-btn" onClick={onBack} aria-label="뒤로가기">
                    <ArrowLeft size={20} />
                </button>
                <div className="legal-title-row">
                    <Icon size={20} className="legal-title-icon" />
                    <h1 className="legal-title">{title}</h1>
                </div>
            </div>

            {/* 본문 내용 */}
            <div className="legal-body">
                {children}
            </div>

            {/* 하단 앱 정보 */}
            <div className="legal-footer">
                <p>PronunFit · <a href="mailto:PronunFit@yahoo.com">PronunFit@yahoo.com</a></p>
            </div>
        </div>
    );
}

// ── 1. 개인정보처리방침 (Privacy Policy) ────────────────────────────────────────
// AdSense를 달면 Google이 쿠키를 사용하기 때문에 이 페이지가 반드시 있어야 합니다.
export function PrivacyPolicyPage({ onBack }) {
    // 오늘 날짜를 "2025년 3월 2일" 형식으로 표기
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <LegalLayout icon={Shield} title="개인정보처리방침" onBack={onBack}>
            <p className="legal-date">최종 업데이트: {today}</p>

            <section className="legal-section">
                <h2>1. 수집하는 개인정보</h2>
                <p>PronunFit은 서비스 제공을 위해 다음 정보를 수집합니다:</p>
                <ul>
                    <li>이메일 주소 (회원가입 및 로그인 시)</li>
                    <li>닉네임, 전화번호, 주소 (선택 입력 사항)</li>
                    <li>번역 및 발음 연습 기록 (서비스 향상 목적)</li>
                    <li>기기 정보 및 브라우저 정보 (서비스 개선 목적)</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>2. 개인정보 이용 목적</h2>
                <ul>
                    <li>회원 인증 및 계정 관리</li>
                    <li>번역 · 발음 연습 서비스 제공</li>
                    <li>학습 기록(보관함) 저장 및 조회</li>
                    <li>서비스 개선 및 통계 분석</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>3. 제3자 서비스 및 광고</h2>
                <p>본 앱은 다음 제3자 서비스를 사용하며, 이들은 독자적인 개인정보처리방침을 가집니다:</p>
                <ul>
                    <li>
                        <strong>Google Firebase</strong> – 로그인 인증 및 데이터 저장
                        (<a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google 개인정보처리방침</a>)
                    </li>
                    <li>
                        <strong>Google AdSense</strong> – 광고 제공 (쿠키 및 관심 기반 광고 사용)
                        (<a href="https://policies.google.com/technologies/ads" target="_blank" rel="noreferrer">Google 광고 정책</a>)
                    </li>
                    <li>
                        <strong>Vercel Analytics</strong> – 방문자 통계 분석
                    </li>
                    <li>
                        <strong>Google Gemini API</strong> – AI 번역 팁 생성
                    </li>
                </ul>
                <p>
                    Google AdSense는 쿠키(Cookie)를 사용하여 사용자의 관심사에 맞는 광고를 표시할 수 있습니다.
                    사용자는 <a href="https://adssettings.google.com" target="_blank" rel="noreferrer">Google 광고 설정</a>에서
                    맞춤형 광고를 비활성화할 수 있습니다.
                </p>
            </section>

            <section className="legal-section">
                <h2>4. 데이터 보관 기간</h2>
                <p>
                    회원 탈퇴 요청 시 또는 서비스 종료 시까지 보관하며,
                    탈퇴 후에는 지체 없이 파기합니다.
                </p>
            </section>

            <section className="legal-section">
                <h2>5. 쿠키(Cookie) 사용</h2>
                <p>
                    본 서비스는 로그인 세션 유지 및 광고 제공을 위해 쿠키를 사용합니다.
                    브라우저 설정에서 쿠키를 비활성화할 수 있으나,
                    일부 서비스 기능이 제한될 수 있습니다.
                </p>
            </section>

            <section className="legal-section">
                <h2>6. 이용자의 권리</h2>
                <ul>
                    <li>개인정보 열람, 수정, 삭제 요청 가능</li>
                    <li>광고 맞춤 설정 거부 가능</li>
                    <li>문의: <a href="mailto:PronunFit@yahoo.com">PronunFit@yahoo.com</a></li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>7. 문의</h2>
                <p>
                    개인정보 관련 문의 사항은 아래 이메일로 연락해 주세요.<br />
                    <a href="mailto:PronunFit@yahoo.com">PronunFit@yahoo.com</a>
                </p>
            </section>
        </LegalLayout>
    );
}

// ── 2. 이용약관 (Terms of Service) ────────────────────────────────────────────
export function TermsOfServicePage({ onBack }) {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <LegalLayout icon={FileText} title="이용약관" onBack={onBack}>
            <p className="legal-date">최종 업데이트: {today}</p>

            <section className="legal-section">
                <h2>1. 서비스 소개</h2>
                <p>
                    PronunFit은 다국어 번역 및 발음 연습을 위한 학습 보조 서비스입니다.
                    본 약관에 동의하시면 서비스를 이용하실 수 있습니다.
                </p>
            </section>

            <section className="legal-section">
                <h2>2. 계정 및 가입</h2>
                <ul>
                    <li>정확한 정보로 가입해야 하며, 타인 명의 도용은 금지됩니다.</li>
                    <li>계정 보안(비밀번호 관리)은 사용자 본인의 책임입니다.</li>
                    <li>만 14세 미만은 법정대리인의 동의가 필요합니다.</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>3. 서비스 이용 규칙</h2>
                <ul>
                    <li>불법적인 목적의 번역 요청은 금지됩니다.</li>
                    <li>서비스를 악의적으로 사용하거나 시스템에 과부하를 주는 행위는 금지됩니다.</li>
                    <li>타인의 개인정보를 무단으로 입력하는 행위는 금지됩니다.</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>4. 서비스 변경 및 중단</h2>
                <p>
                    운영상 필요에 따라 서비스 내용을 변경하거나 일시 중단할 수 있으며,
                    사전 고지를 원칙으로 합니다.
                </p>
            </section>

            <section className="legal-section">
                <h2>5. 면책 조항</h2>
                <p>
                    AI 번역 결과는 참고용이며, 중요한 문서나 업무에 단독으로 사용 시 발생하는
                    문제에 대해 PronunFit은 책임을 지지 않습니다.
                </p>
            </section>

            <section className="legal-section">
                <h2>6. 문의</h2>
                <p>
                    이용약관 관련 문의:&nbsp;
                    <a href="mailto:PronunFit@yahoo.com">PronunFit@yahoo.com</a>
                </p>
            </section>
        </LegalLayout>
    );
}

// ── 3. 연락처 (Contact) ────────────────────────────────────────────────────────
export function ContactPage({ onBack }) {
    return (
        <LegalLayout icon={Mail} title="연락처" onBack={onBack}>

            <div className="contact-card">
                <div className="contact-icon-wrap">
                    <Mail size={32} color="#00a884" />
                </div>
                <h2 className="contact-app-name">PronunFit</h2>
                <p className="contact-desc">
                    서비스 이용 중 궁금하신 점, 문의 사항, 버그 제보 등 어떤 것이든
                    아래 이메일로 연락해 주세요. 최대한 빠르게 답변드리겠습니다.
                </p>

                {/* 이메일 버튼 - 누르면 이메일 앱 열림 */}
                <a
                    href="mailto:PronunFit@yahoo.com"
                    className="contact-email-btn"
                >
                    <Mail size={18} />
                    PronunFit@yahoo.com
                </a>
            </div>

            <div className="contact-info-grid">
                <div className="contact-info-item">
                    <span className="contact-info-label">서비스명</span>
                    <span className="contact-info-value">PronunFit</span>
                </div>
                <div className="contact-info-item">
                    <span className="contact-info-label">제공 서비스</span>
                    <span className="contact-info-value">다국어 번역 · 발음 연습</span>
                </div>
                <div className="contact-info-item">
                    <span className="contact-info-label">이메일</span>
                    <span className="contact-info-value">PronunFit@yahoo.com</span>
                </div>
                <div className="contact-info-item">
                    <span className="contact-info-label">응답 시간</span>
                    <span className="contact-info-value">평일 기준 1~2 영업일</span>
                </div>
            </div>

        </LegalLayout>
    );
}
