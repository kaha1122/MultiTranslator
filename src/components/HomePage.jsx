import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, BookOpen, Languages, Video, Library, Headphones } from 'lucide-react';
import { useT } from '../utils/i18n';
import { getToday } from '../hooks/useDailyProgress';
import { useWeeklyCardStats } from '../hooks/useWeeklyCardStats';
import './HomePage.css';

const HomePage = ({ user, weeklyData, todayCount, todaySaveCount = 0, todayPronCount = 0, todayListenCount = 0, dailyGoal, dailyCardLimit = 10, dailyPronLimit = 20, dailyListenLimit = 10, sourceLang, onNavigate, isActive }) => {
    const t = useT(sourceLang);
    const today = getToday();
    const dayLabels = t('daily.days').split(',');
    const { stats, monthly, targets, monthlyTargets, loading: statsLoading } = useWeeklyCardStats(user, isActive);
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
            icon: <MapPin size={24} />,
            emoji: '💬',
            color: '#6366f1',
            bgColor: '#eef2ff',
            borderColor: '#c7d2fe',
            titleKey: 'home.sceneTitle',
            descKey: 'home.sceneDesc',
            subDescKey: 'home.sceneSubDesc',
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
    const cardPercent = Math.min((todaySaveCount / dailyCardLimit) * 100, 100);
    const pronPercent = Math.min((todayPronCount / dailyPronLimit) * 100, 100);
    const listenPercent = Math.min((todayListenCount / dailyListenLimit) * 100, 100);

    return (
        <div className="home-page">
            {/* 섹션 1: 주간 목표 별 */}
            <div className="home-section home-weekly">
                <h3 className="home-section-title">{t('home.weeklyGoal')}</h3>
                <div className="home-weekly-stars">
                    {weeklyData.map((d, i) => {
                        const isToday = d.date === today;
                        const isFuture = d.date > today;
                        let icon = '○';
                        if (d.achieved) icon = '⭐';
                        else if (!isFuture && d.date < today) icon = '🌙';
                        return (
                            <div key={d.date} className={`home-star-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''}`}>
                                <span className="home-star-label">{dayLabels[i] || ''}</span>
                                <span className="home-star-icon">{icon}</span>
                                {!isFuture && <span className="home-star-count">{d.count || 0}</span>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 섹션 2: 오늘의 진도 — 3개 게이지 */}
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
            </div>

            {/* 섹션 3: 상단 폴더 탭 + 하단 콘텐츠 */}
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
                                                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
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

            {/* 섹션 4: 이번 주 학습 통계표 */}
            <div className="home-section home-stats">
                <div className="home-stats-header">
                    <h3 className="home-section-title">{t('home.weeklyStats')}</h3>
                    <button className="home-stats-link" onClick={() => onNavigate('stats')}>{t('home.viewStats')}</button>
                </div>
                {statsLoading ? (
                    <div className="home-stats-loading">...</div>
                ) : (
                    <div className="home-stats-table-wrap">
                        <table className="home-stats-table">
                            <thead>
                                <tr>
                                    <th rowSpan={2}></th>
                                    <th colSpan={3} className="home-stats-group-header">📖 {t('home.word')}</th>
                                    <th colSpan={3} className="home-stats-group-header">🎭 {t('home.dialogue')}</th>
                                </tr>
                                <tr>
                                    <th>{t('home.diffB')}</th>
                                    <th>{t('home.diffI')}</th>
                                    <th>{t('home.diffH')}</th>
                                    <th>{t('home.diffB')}</th>
                                    <th>{t('home.diffI')}</th>
                                    <th>{t('home.diffH')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="home-stats-row-label">{t('home.tWeek')}</td>
                                    <td>{stats.vocab.basic}/{targets.vocab}</td>
                                    <td>{stats.vocab.intermediate}/{targets.vocab}</td>
                                    <td>{stats.vocab.high}/{targets.vocab}</td>
                                    <td>{stats.scene.basic}/{targets.scene}</td>
                                    <td>{stats.scene.intermediate}/{targets.scene}</td>
                                    <td>{stats.scene.high}/{targets.scene}</td>
                                </tr>
                                <tr>
                                    <td className="home-stats-row-label">{t('home.tMonth')}</td>
                                    <td>{monthly.vocab.basic}/{monthlyTargets.vocab}</td>
                                    <td>{monthly.vocab.intermediate}/{monthlyTargets.vocab}</td>
                                    <td>{monthly.vocab.high}/{monthlyTargets.vocab}</td>
                                    <td>{monthly.scene.basic}/{monthlyTargets.scene}</td>
                                    <td>{monthly.scene.intermediate}/{monthlyTargets.scene}</td>
                                    <td>{monthly.scene.high}/{monthlyTargets.scene}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HomePage;
