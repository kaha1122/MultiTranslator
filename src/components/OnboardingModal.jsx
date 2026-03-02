import React, { useState, useEffect } from 'react';
import { Mic, Bookmark, Globe, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './OnboardingModal.css';

const OnboardingModal = ({ isOpen, onClose }) => {
    // Esc 키로도 닫을 수 있게 설정
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="onboarding-overlay" onClick={onClose}>
                <motion.div
                    className="onboarding-modal"
                    onClick={(e) => e.stopPropagation()} // 모달 내부를 눌러도 닫히지 않도록 이벤트 전파 차단
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                >
                    <button className="onboarding-close-btn" onClick={onClose} aria-label="Close">
                        <X size={24} color="#64748b" />
                    </button>

                    <div className="onboarding-header">
                        <h2>환영합니다! 🎉</h2>
                        <p>Multi-Translator를 100% 활용하는 3가지 방법을 1분만에 알아보세요.</p>
                    </div>

                    <div className="onboarding-features">
                        {/* 기능 1: 발음 학습 */}
                        <div className="feature-item">
                            <div className="feature-icon feature-mic">
                                <Mic size={28} color="#3b82f6" />
                            </div>
                            <div className="feature-text">
                                <h3>듣고 따라하며 완벽한 발음 만들기</h3>
                                <ul>
                                    <li>원어민의 발음을 먼저 듣고 익혀보세요.</li>
                                    <li>따라 읽어보면 AI가 <strong>정확도, 유창성, 운율</strong>을 평가합니다!</li>
                                    <li>내 목소리를 다시 들으며 약점을 점검하세요.</li>
                                </ul>
                            </div>
                        </div>

                        {/* 기능 2: 반복 학습 및 라이브러리 (저장) */}
                        <div className="feature-item">
                            <div className="feature-icon feature-save">
                                <Bookmark size={28} color="#10b981" />
                            </div>
                            <div className="feature-text">
                                <h3>카드를 저장하고 반복해서 복습하기</h3>
                                <ul>
                                    <li>번역된 카드를 <strong>스와이프</strong> 하거나 길게 꾹 누르면 담깁니다.</li>
                                    <li>Library(보관함)에서 나만의 목표 점수를 세우세요!</li>
                                    <li>과거 발음 기록과 비교하며 실력 향상을 확인하세요.</li>
                                </ul>
                            </div>
                        </div>

                        {/* 기능 3: 다국어 학습 */}
                        <div className="feature-item">
                            <div className="feature-icon feature-globe">
                                <Globe size={28} color="#8b5cf6" />
                            </div>
                            <div className="feature-text">
                                <h3>여러 언어를 동시에 정복하기</h3>
                                <ul>
                                    <li>영어, 중국어, 일본어 등 최대 <strong>3가지 언어</strong>를 나란히 띄워놓고 구조를 비교하며 학습할 수 있습니다.</li>
                                </ul>
                            </div>
                        </div>
                    </div>

                    <button className="onboarding-start-btn" onClick={onClose}>
                        시작하기 🚀
                    </button>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default OnboardingModal;
