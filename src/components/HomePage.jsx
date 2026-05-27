import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Languages, Video, Library, Headphones, MessageCircle } from 'lucide-react';
import { useT } from '../utils/i18n';
import { getToday } from '../hooks/useDailyProgress';
import './HomePage.css';

const HomePage = ({ user, weeklyData, todayCount, todaySaveCount = 0, todayPronCount = 0, todayListenCount = 0, todayFreeTalkCount = 0, dailyGoal, dailyPronLimit = 20, dailyFreeTalkLimit = 2, dailyListenLimit = 3, sourceLang, onNavigate, isActive }) => {
    const t = useT(sourceLang);
    const today = getToday();
    const dayLabels = t('daily.days').split(',');
    const [openFolder, setOpenFolder] = useState('vocab');

    const folders = [
        {
            id: 'vocab',
            icon: <BookOpen size={24} />,
            emoji: '📖',
            color: '#059669',
            bgColor: '#f0fdf4',
            borderColor: '#a7f3d0',
            titleKey: 'home.vocabTitle',
            descKey: 'home.vocabDesc',
            subDescKey: 'home.vocabSubDesc',
        },
        {
            id: 'scene',
            icon: <MessageCircle size={24} />,
            emoji: '💬',
            color: '#f59e0b',         // 사이드바/탭바와 동일 amber
            bgColor: '#fef3c7',        // amber 100 (translation #fffbeb 보다 진하게 — 시각 구분)
            borderColor: '#fcd34d',    // amber 300
            titleKey: 'home.sceneTitle',
            descKey: 'home.sceneDesc',
            subDescKey: 'home.sceneSubDesc',
        },
        {
            id: 'listening',
            icon: <Headphones size={24} />,
            emoji: '🎧',
            color: '#7c3aed',
            bgColor: '#f5f3ff',
            borderColor: '#ddd6fe',
            titleKey: 'home.listeningTitle',
            descKey: 'home.listeningDesc',
            subDescKey: 'home.listeningSubDesc',
        },
        {
            id: 'translation',
            icon: <Languages size={24} />,
            emoji: '🔤',
            color: '#d97706',
            bgColor: '#fffbeb',
            borderColor: '#fde68a',
            titleKey: 'home.translationTitle',
            descKey: 'home.translationDesc',
            subDescKey: 'home.translationSubDesc',
        },
        {
            id: 'video',
            icon: <Video size={24} />,
            emoji: '🎬',
            color: '#e11d48',
            bgColor: '#fff1f2',
            borderColor: '#fecdd3',
            titleKey: 'home.videoTitle',
            descKey: 'home.videoDesc',
            subDescKey: 'home.videoSubDesc',
        },
    ];

    const recordFolders = [
        {
            id: 'library',
            icon: <Library size={24} />,
            emoji: '📚',
            color: '#0891b2',
            bgColor: '#ecfeff',
            borderColor: '#a5f3fc',
            titleKey: 'home.libraryTitle',
            descKey: 'home.libraryDesc',
            subDescKey: 'home.librarySubDesc',
        },
    ];

    const gaugePercent = Math.min((todayCount / dailyGoal) * 100, 100);
    const isComplete = todayCount >= dailyGoal;
    const pronPercent = Math.min((todayPronCount / dailyPronLimit) * 100, 100);
    const listenPercent = Math.min((todayListenCount / dailyListenLimit) * 100, 100);
    const freeTalkPercent = Math.min((todayFreeTalkCount / dailyFreeTalkLimit) * 100, 100);

    return (
        <div className="home-page">
            {/* 섹션 1: 학습 메뉴 (folders) — 신규 사용자 첫 화면에 즉시 노출 */}
            <div className="home-section home-folders-section">
                <h3 className="home-section-title">{t('home.folders')}</h3>
                {folders.map(folder => {
                    const isActive = openFolder === folder.id;
                    return (
                        <div
                            key={folder.id}
                            className={`home-folder-unit ${isActive ? 'active' : ''}`}
                            style={{
                                '--folder-color': folder.color,
                                '--folder-bg': folder.bgColor,
                                '--folder-border': folder.borderColor,
                            }}
                        >
                            {/* 탭 헤더 */}
                            <button
                                className={`home-folder-tab ${isActive ? 'active' : ''}`}
                                onClick={() => setOpenFolder(isActive ? null : folder.id)}
                            >
                                <div className="home-folder-tab-icon" style={{ background: isActive ? folder.bgColor : '#f1f5f9', color: folder.color }}>
                                    {folder.icon}
                                </div>
                                <span className="home-folder-tab-label">{t(folder.titleKey)}</span>
                            </button>

                            {/* 콘텐츠 (같은 카드 안) */}
                            <AnimatePresence>
                                {isActive && (
                                    <motion.div
                                        className="home-folder-content"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.25 }}
                                    >
                                        <div className="home-folder-content-inner">
                                            {/* 애니메이션 이미지 */}
                                            <div className="home-folder-anim">
                                                <motion.span
                                                    className="home-folder-emoji"
                                                    animate={{ scale: [1, 1.15, 1], y: [0, -6, 0] }}
                                                    transition={{ duration: 2, ease: 'easeInOut' }}
                                                >
                                                    {folder.emoji}
                                                </motion.span>
                                            </div>

                                            {/* 큰 글씨 설명 */}
                                            <p className="home-folder-desc-main">{t(folder.descKey)}</p>
                                            {/* 작은 글씨 설명 */}
                                            <p className="home-folder-desc-sub">{t(folder.subDescKey)}</p>

                                            {/* 하단 이동 버튼 */}
                                            <button
                                                className="home-folder-cta"
                                                style={{ background: folder.color }}
                                                onClick={() => onNavigate(folder.id)}
                                            >
                                                {t('home.goBtn')} →
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>

            {/* 섹션 2: 학습기록 */}
            <div className="home-section home-folders-section">
                <h3 className="home-section-title">{t('home.recordSection')}</h3>
                {recordFolders.map(folder => {
                    const isActive = openFolder === folder.id;
                    return (
                        <div
                            key={folder.id}
                            className={`home-folder-unit ${isActive ? 'active' : ''}`}
                            style={{
                                '--folder-color': folder.color,
                                '--folder-bg': folder.bgColor,
                                '--folder-border': folder.borderColor,
                            }}
                        >
                            <button
                                className={`home-folder-tab ${isActive ? 'active' : ''}`}
                                onClick={() => setOpenFolder(isActive ? null : folder.id)}
                            >
                                <div className="home-folder-tab-icon" style={{ background: isActive ? folder.bgColor : '#f1f5f9', color: folder.color }}>
                                    {folder.icon}
                                </div>
                                <span className="home-folder-tab-label">{t(folder.titleKey)}</span>
                            </button>
                            <AnimatePresence>
                                {isActive && (
                                    <motion.div
                                        className="home-folder-content"
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.25 }}
                                    >
                                        <div className="home-folder-content-inner">
                                            <div className="home-folder-anim">
                                                <motion.span
                                                    className="home-folder-emoji"
                                                    animate={{ scale: [1, 1.15, 1], y: [0, -6, 0] }}
                                                    transition={{ duration: 2, ease: 'easeInOut' }}
                                                >
                                                    {folder.emoji}
                                                </motion.span>
                                            </div>
                                            <p className="home-folder-desc-main">{t(folder.descKey)}</p>
                                            <p className="home-folder-desc-sub">{t(folder.subDescKey)}</p>
                                            <button
                                                className="home-folder-cta"
                                                style={{ background: folder.color }}
                                                onClick={() => onNavigate(folder.id)}
                                            >
                                                {t('home.goBtn')} →
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>

            {/* 섹션 3: 이번주 학습현황 — 통계 탭과 동일 시각 양식 (✅ 체크 + 사각형 배경) */}
            <div className="home-section home-weekly">
                <h3 className="home-section-title">{t('home.weeklyGoal')}</h3>
                <div className="home-weekly-stars">
                    {weeklyData.map((d, i) => {
                        const isToday = d.date === today;
                        const isFuture = d.date > today;
                        const achieved = d.achieved;
                        const count = d.count || 0;
                        const missed = !isFuture && !achieved && d.date < today;
                        const classes = ['home-star-day'];
                        if (achieved) classes.push('achieved');
                        else if (missed && count > 0) classes.push('partial');
                        if (isFuture) classes.push('future');
                        if (isToday) classes.push('today');
                        let icon;
                        if (isFuture) icon = '';
                        else if (achieved) icon = '✅';
                        else if (d.date < today) icon = count > 0 ? '🌙' : '·';
                        else icon = '○';
                        return (
                            <div key={d.date} className={classes.join(' ')}>
                                <span className="home-star-label">{dayLabels[i] || ''}</span>
                                <span className="home-star-icon">{icon}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 섹션 4: 오늘의 진도 — 4개 게이지 (카드/발음/듣기/Free Talking) */}
            <div className="home-section home-gauge">
                <span className="home-gauge-title">{t('home.todayProgress')}</span>

                {/* 카드 달성 */}
                <div className="home-gauge-row">
                    <span className="home-gauge-row-label">🎯</span>
                    <div className="home-gauge-track">
                        <motion.div
                            className={`home-gauge-fill ${isComplete ? 'complete' : ''}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${gaugePercent}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                    </div>
                    <span className={`home-gauge-count ${isComplete ? 'complete' : ''}`}>{todayCount}/{dailyGoal}</span>
                </div>

                {/* 발음 연습 */}
                <div className="home-gauge-row">
                    <span className="home-gauge-row-label">🎙</span>
                    <div className="home-gauge-track">
                        <motion.div
                            className="home-gauge-fill pron"
                            initial={{ width: 0 }}
                            animate={{ width: `${pronPercent}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                    </div>
                    <span className="home-gauge-count pron">{todayPronCount}/{dailyPronLimit}</span>
                </div>

                {/* 듣기 조회 */}
                <div className="home-gauge-row">
                    <span className="home-gauge-row-label">🎧</span>
                    <div className="home-gauge-track">
                        <motion.div
                            className="home-gauge-fill listen"
                            initial={{ width: 0 }}
                            animate={{ width: `${listenPercent}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                    </div>
                    <span className="home-gauge-count listen">{todayListenCount}/{dailyListenLimit}</span>
                </div>

                {/* Free Talking */}
                <div className="home-gauge-row">
                    <span className="home-gauge-row-label">💬</span>
                    <div className="home-gauge-track">
                        <motion.div
                            className="home-gauge-fill freetalk"
                            initial={{ width: 0 }}
                            animate={{ width: `${freeTalkPercent}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                    </div>
                    <span className="home-gauge-count freetalk">{todayFreeTalkCount}/{dailyFreeTalkLimit}</span>
                </div>
            </div>

        </div>
    );
};

export default HomePage;
