import React, { useEffect } from 'react';
import { ArrowLeft, Mail, Shield, FileText } from 'lucide-react';
import { getT } from '../../utils/i18n';
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

const EMAIL = 'SystemAdmin@PronunFit.com';

// 언어 코드 → toLocaleDateString locale 매핑
const DATE_LOCALES = {
    ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', 'zh-CN': 'zh-CN',
    vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE', es: 'es-ES',
    ru: 'ru-RU', 'pt-BR': 'pt-BR',
};

// ── 공통 레이아웃: 뒤로가기 버튼 + 제목 헤더 ──────────────────────────────────
function LegalLayout({ icon: Icon, title, onBack, backLabel, children }) {
    useEffect(() => {
        const handleKey = (e) => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key === 'Escape') { e.preventDefault(); onBack(); }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onBack]);

    return (
        <div className="legal-container">
            <div className="legal-header">
                <button className="legal-back-btn" onClick={onBack} aria-label={backLabel}>
                    <ArrowLeft size={20} />
                </button>
                <div className="legal-title-row">
                    <Icon size={20} className="legal-title-icon" />
                    <h1 className="legal-title">{title}</h1>
                </div>
            </div>

            <div className="legal-body">
                {children}
            </div>

            <div className="legal-footer">
                <p>PronunFit · <a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
            </div>
        </div>
    );
}

// ── 1. 개인정보처리방침 (Privacy Policy) ────────────────────────────────────────
export function PrivacyPolicyPage({ onBack, sourceLang = 'ko' }) {
    const t = (key) => getT(sourceLang, `legal.${key}`);
    const dateLocale = DATE_LOCALES[sourceLang] || 'en-US';
    const today = new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <LegalLayout icon={Shield} title={t('privacyTitle')} onBack={onBack} backLabel={t('backLabel')}>
            <p className="legal-date">{t('privacyLastUpdate')}: {today}</p>

            <section className="legal-section">
                <h2>{t('privacyS1Title')}</h2>
                <p>{t('privacyS1Desc')}</p>
                <ul>
                    <li>{t('privacyS1Item1')}</li>
                    <li>{t('privacyS1Item2')}</li>
                    <li>{t('privacyS1Item3')}</li>
                    <li>{t('privacyS1Item4')}</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>{t('privacyS2Title')}</h2>
                <ul>
                    <li>{t('privacyS2Item1')}</li>
                    <li>{t('privacyS2Item2')}</li>
                    <li>{t('privacyS2Item3')}</li>
                    <li>{t('privacyS2Item4')}</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>{t('privacyS3Title')}</h2>
                <p>{t('privacyS3Desc')}</p>
                <ul>
                    <li>
                        <strong>Google Firebase</strong> – {t('privacyS3Firebase').replace('Google Firebase – ', '')}
                        {' '}(<a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{t('privacyS3GooglePrivacy')}</a>)
                    </li>
                    <li>
                        <strong>Google AdSense</strong> – {t('privacyS3AdSense').replace('Google AdSense – ', '')}
                        {' '}(<a href="https://policies.google.com/technologies/ads" target="_blank" rel="noreferrer">{t('privacyS3GoogleAds')}</a>)
                    </li>
                    <li><strong>Vercel Analytics</strong> – {t('privacyS3Vercel').replace('Vercel Analytics – ', '')}</li>
                    <li><strong>Google Gemini API</strong> – {t('privacyS3Gemini').replace('Google Gemini API – ', '')}</li>
                </ul>
                <p>
                    {t('privacyS3Cookie')}{' '}
                    <a href="https://adssettings.google.com" target="_blank" rel="noreferrer">{t('privacyS3CookieLink')}</a>
                    {t('privacyS3CookieSuffix')}
                </p>
            </section>

            <section className="legal-section">
                <h2>{t('privacyS4Title')}</h2>
                <p>{t('privacyS4Desc')}</p>
            </section>

            <section className="legal-section">
                <h2>{t('privacyS5Title')}</h2>
                <p>{t('privacyS5Desc')}</p>
            </section>

            <section className="legal-section">
                <h2>{t('privacyS6Title')}</h2>
                <ul>
                    <li>{t('privacyS6Item1')}</li>
                    <li>{t('privacyS6Item2')}</li>
                    <li>{t('privacyS6Item3')} <a href={`mailto:${EMAIL}`}>{EMAIL}</a></li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>{t('privacyS7Title')}</h2>
                <p>
                    {t('privacyS7Desc')}<br />
                    <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
                </p>
            </section>
        </LegalLayout>
    );
}

// ── 2. 이용약관 (Terms of Service) ────────────────────────────────────────────
export function TermsOfServicePage({ onBack, sourceLang = 'ko' }) {
    const t = (key) => getT(sourceLang, `legal.${key}`);
    const dateLocale = DATE_LOCALES[sourceLang] || 'en-US';
    const today = new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <LegalLayout icon={FileText} title={t('termsTitle')} onBack={onBack} backLabel={t('backLabel')}>
            <p className="legal-date">{t('termsLastUpdate')}: {today}</p>

            <section className="legal-section">
                <h2>{t('termsS1Title')}</h2>
                <p>{t('termsS1Desc')}</p>
            </section>

            <section className="legal-section">
                <h2>{t('termsS2Title')}</h2>
                <ul>
                    <li>{t('termsS2Item1')}</li>
                    <li>{t('termsS2Item2')}</li>
                    <li>{t('termsS2Item3')}</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>{t('termsS3Title')}</h2>
                <ul>
                    <li>{t('termsS3Item1')}</li>
                    <li>{t('termsS3Item2')}</li>
                    <li>{t('termsS3Item3')}</li>
                </ul>
            </section>

            <section className="legal-section">
                <h2>{t('termsS4Title')}</h2>
                <p>{t('termsS4Desc')}</p>
            </section>

            <section className="legal-section">
                <h2>{t('termsS5Title')}</h2>
                <p>{t('termsS5Desc')}</p>
            </section>

            <section className="legal-section">
                <h2>{t('termsS6Title')}</h2>
                <p>{t('termsS6Desc')}</p>

                <h3>{t('termsS6Sub1')}</h3>
                <ul>
                    <li>{t('termsS6Sub1Item1')}</li>
                    <li>{t('termsS6Sub1Item2')}</li>
                    <li>{t('termsS6Sub1Item3')}</li>
                </ul>

                <h3>{t('termsS6Sub2')}</h3>
                <ul>
                    <li>{t('termsS6Sub2Item1')}</li>
                    <li>{t('termsS6Sub2Item2')}</li>
                    <li>{t('termsS6Sub2Item3')}</li>
                </ul>

                <h3>{t('termsS6Sub3')}</h3>
                <ul>
                    <li>{t('termsS6Sub3Item1')}</li>
                    <li>{t('termsS6Sub3Item2')}</li>
                </ul>

                <h3>{t('termsS6Sub4')}</h3>
                <ul>
                    <li>{t('termsS6Sub4Item1')}</li>
                    <li>{t('termsS6Sub4Item2')}</li>
                </ul>

                <p>{t('termsS6RefundContact').replace('{email}', '')}
                    <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
                </p>
            </section>

            <section className="legal-section">
                <h2>{t('termsS7Title')}</h2>
                <p>
                    {t('termsS7Desc')}{' '}
                    <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
                </p>
            </section>
        </LegalLayout>
    );
}

// ── 3. 연락처 (Contact) ────────────────────────────────────────────────────────
export function ContactPage({ onBack, sourceLang = 'ko' }) {
    const t = (key) => getT(sourceLang, `legal.${key}`);

    return (
        <LegalLayout icon={Mail} title={t('contactTitle')} onBack={onBack} backLabel={t('backLabel')}>

            <div className="contact-card">
                <div className="contact-icon-wrap">
                    <Mail size={32} color="#00a884" />
                </div>
                <h2 className="contact-app-name">PronunFit</h2>
                <p className="contact-desc">{t('contactDesc')}</p>

                <a href={`mailto:${EMAIL}`} className="contact-email-btn">
                    <Mail size={18} />
                    {EMAIL}
                </a>
            </div>

            <div className="contact-info-grid">
                <div className="contact-info-item">
                    <span className="contact-info-label">{t('contactServiceName')}</span>
                    <span className="contact-info-value">PronunFit</span>
                </div>
                <div className="contact-info-item">
                    <span className="contact-info-label">{t('contactServiceDesc')}</span>
                    <span className="contact-info-value">{t('contactServiceValue')}</span>
                </div>
                <div className="contact-info-item">
                    <span className="contact-info-label">{t('contactEmail')}</span>
                    <span className="contact-info-value">{EMAIL}</span>
                </div>
                <div className="contact-info-item">
                    <span className="contact-info-label">{t('contactPhone')}</span>
                    <span className="contact-info-value">{t('contactPhoneValue')}</span>
                </div>
                <div className="contact-info-item">
                    <span className="contact-info-label">{t('contactResponseTime')}</span>
                    <span className="contact-info-value">{t('contactResponseValue')}</span>
                </div>
            </div>

        </LegalLayout>
    );
}
