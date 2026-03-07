import { useEffect, useRef, useState } from 'react';
import './LandingPage.css';

const CONTENT = {
  ko: {
    login: '로그인',
    signUp: '회원가입',
    otherLogin: '다른 방법으로 로그인',
    usps: [
      { title: '무료로 원어민 발음을\n가장 빠르게 향상시키는 방법', sub: 'AI가 번역하고, 채점하고, 코치하고. 8개국 어학학습을 무료로.' },
      { title: 'AI와 듣고, 따라하고,\n점수 받고 완벽해지다', sub: '정확도·유창성·운율까지 5가지 지표로 원어민과의 차이를 한눈에 확인하세요.' },
      { title: '저장하고 다시 연습하는\n나만의 스마트 단어장', sub: '별표 하나로 저장, 보관함에서 꺼내어 발음 연습까지 이어집니다.' },
      { title: 'AI 맞춤 문장 추천으로 \n살아있는 언어 연습', sub: '장소와 상황에 맞게 AI가 문장을 읽어주면, 발음 연습을 통해 익히세요.' },
    ],
    tagline: '8개 국어 AI 발음 코치 · 무료',
    heroTitle: '원어민 발음을\n가장 빠르게 만드는 방법',
    heroSub: 'AI가 번역하고, 채점하고, 코치합니다. ',
    heroSubEm: '8개 국어, 무료로.',
    ctaStart: 'Google로 시작하기',
    stats: [{ num: '8', label: '지원 언어' }, { num: '100', label: '점 만점 채점' }, { num: '0원', label: '완전 무료' }],
    sectionLabel: '핵심 기능',
    sectionTitle: '왜 PronunFit인가요?',
    features: [
      { icon: '🆓', num: '01 · 완전 무료', title: '8개 국어 AI 발음 앱,<br />0원으로 시작', desc: '영어·한국어·일본어·중국어·베트남어·프랑스어·독일어·스페인어. 광고 없이, 숨겨진 비용 없이 — 가입만 하면 모든 기능이 무료입니다.', tag: '✓ 신용카드 불필요' },
      { icon: '🎙️', num: '02 · AI 발음 코치', title: '듣고 → 따라하고 →<br />점수 받고', desc: 'AI가 문장을 읽어주면 따라 말하세요. 정확도·유창성·운율까지 5가지 항목을 실시간으로 분석해 그래프로 보여드립니다.', tag: '✓ Azure AI 음성 분석' },
      { icon: '📚', num: '03 · 스마트 단어장', title: '저장하고, 찾고,<br />다시 연습하는 단어장', desc: '번역한 문장을 별표 하나로 저장하면 끝. 보관함에서 꺼내어 발음 연습까지 이어집니다.', tag: '✓ 학습 기록 자동 저장' },
      { icon: '🌍', num: '04 · 실제 콘텐츠 연습', title: '장소와 상황별 <br />살아있는 언어학습', desc: '장소와 상황에 맞게 AI가 학습 문장 생성하고 음성으로 재생, 실전 발음 연습이 가능합니다.문장으로 진짜 언어를 배우세요.', tag: '✓ 장소/상황별 어학 학습' },
    ],
    appLabel: '앱 살펴보기',
    appTitle: '이런 기능들이 기다리고 있어요',
    appCards: [
      { badge: '발음 분석 결과', title: 'AI가 음소 단위까지<br />정밀하게 분석합니다', desc: '말한 뒤 바로 점수가 나옵니다. 단어별·음소별 정확도를 신호등 색상으로 직관적으로 확인하고, AI 코치의 맞춤 피드백까지 받아보세요.', img: '/mockup_pronunciation.png', imgAlt: '발음 분석 결과 화면' },
      { badge: '언어 & 목표 설정', title: '내 상황에 맞게<br />언어와 목표를 설정하세요', desc: '8개 언어 중 원하는 언어를 최대 3개까지 선택하고, 목표 점수를 설정하면 AI가 그에 맞는 코칭을 제공합니다.', img: '/mockup_multilang.png', imgAlt: '다국어 설정 화면' },
      { badge: '장소/상황별 AI 학습', title: 'AI가 상황에 맞는 문장을<br />생성하고 음성으로 재생', desc: '공항, 호텔, 레스토랑 등 장소와 상황을 선택하면 AI가 영어 문장을 생성합니다. 음성으로 들으며 따라 말하고, 발음 점수까지 확인하세요.', img: '/mockup_scene.svg', imgAlt: '장소/상황별 AI 학습 화면' },
    ],
    ctaTitle: '지금 바로 시작하세요.',
    ctaHighlight: '무료로, 바로.',
    ctaSub: '회원가입 30초. 8개 국어 AI 발음 코치가 지금 여러분을 기다립니다.',
    footerNote: 'PronunFit · AI Pronunciation Coach · 가입 즉시 무료 이용',
    installPopup: '📲 앱을 설치 하시면,\n바로 접속 가능합니다',
  },
  en: {
    login: 'Log In',
    signUp: 'Sign Up',
    otherLogin: 'Other sign-in options',
    usps: [
      { title: 'The fastest way to master\nnative-level pronunciation — free', sub: 'AI translates, scores, and coaches you. 8 languages, completely free.' },
      { title: 'Listen · Repeat · Get scored\nand perfect your accent', sub: 'See accuracy, fluency, and prosody across 5 metrics to pinpoint the gap with native speakers.' },
      { title: 'Your smart vocabulary note —\nsave and practice again', sub: 'One tap to save, then pull it back for pronunciation drills anytime.' },
      { title: 'AI-tailored sentences for\nreal-world language practice', sub: 'AI generates sentences by location and situation, reads them aloud, and guides you through pronunciation drills.' },
    ],
    tagline: 'AI Pronunciation Coach · 8 Languages · Free',
    heroTitle: 'The fastest way to master\nnative-level pronunciation',
    heroSub: 'AI translates, scores, and coaches you. ',
    heroSubEm: '8 languages, completely free.',
    ctaStart: 'Start with Google',
    stats: [{ num: '8', label: 'Languages' }, { num: '100', label: 'Point scoring' }, { num: 'Free', label: 'Always free' }],
    sectionLabel: 'Key Features',
    sectionTitle: 'Why PronunFit?',
    features: [
      { icon: '🆓', num: '01 · Completely Free', title: 'AI pronunciation in 8 languages,<br />zero cost', desc: 'English · Korean · Japanese · Chinese · Vietnamese · French · German · Spanish. No ads, no hidden fees — sign up and unlock everything for free.', tag: '✓ No credit card required' },
      { icon: '🎙️', num: '02 · AI Pronunciation Coach', title: 'Listen → Repeat →<br />Get your score', desc: 'AI reads the sentence aloud — you repeat it. Get real-time analysis of accuracy, fluency, and prosody across 5 dimensions, visualized in a graph.', tag: '✓ Powered by Azure AI Speech' },
      { icon: '📚', num: '03 · Smart Vocabulary Note', title: 'Save, review,<br />and drill again', desc: 'Star any translated sentence to save it instantly. Open your library anytime and jump straight into pronunciation practice.', tag: '✓ Auto-saved learning history' },
      { icon: '🌍', num: '04 · Scene Practice', title: 'Practice by location & situation<br />with AI-generated sentences', desc: 'Select a scene — airport, hotel, restaurant, and more. AI generates and reads sentences aloud. Practice real-world pronunciation in context.', tag: '✓ AI scene-based learning' },
    ],
    appLabel: 'Explore the App',
    appTitle: 'Here\'s what\'s waiting for you',
    appCards: [
      { badge: 'Pronunciation Analysis', title: 'AI scores you down to<br />individual phonemes', desc: 'Get your score instantly after speaking. See per-word and per-phoneme accuracy color-coded like a traffic light, plus personalized coaching tips from AI.', img: '/mockup_pronunciation.png', imgAlt: 'Pronunciation analysis screen' },
      { badge: 'Language & Goal Setup', title: 'Set your languages<br />and target score', desc: 'Pick up to 3 of 8 languages and set your target score — AI tailors its coaching to match. Change your settings anytime.', img: '/mockup_multilang.png', imgAlt: 'Multi-language settings screen' },
      { badge: 'Scene Practice', title: 'AI generates and reads<br />scene-based sentences', desc: 'Choose from airports, hotels, restaurants and more. AI creates sentences for your scene and reads them aloud. Repeat, get scored, and master real-world pronunciation.', img: '/mockup_scene.svg', imgAlt: 'Scene practice screen' },
    ],
    ctaTitle: 'Start right now.',
    ctaHighlight: 'Free. Instant.',
    ctaSub: '30 seconds to sign up. Your AI pronunciation coach in 8 languages is ready.',
    footerNote: 'PronunFit · AI Pronunciation Coach · Free from day one',
    installPopup: '📲 Install the app\nfor instant access',
  },
  ja: {
    login: 'ログイン',
    signUp: '新規登録',
    otherLogin: '他の方法でログイン',
    usps: [
      { title: 'ネイティブ発音を最速で\n習得する方法 — 無料', sub: 'AIが翻訳・採点・コーチング。8言語、完全無料。' },
      { title: '聞いて・まねして・点数をもらい\n完璧な発音に', sub: '正確さ・流暢さ・韻律など5項目でネイティブとの差を一目で確認。' },
      { title: '保存してまた練習できる\nスマート単語帳', sub: '一タップで保存。保管庫からいつでも取り出して発音練習できます。' },
      { title: 'AIが場所と状況に合わせた\n文章で実践的に練習', sub: '場所や状況に合わせてAIが文章を生成し音声再生。発音練習で自然な表現を身につけましょう。' },
    ],
    tagline: 'AI発音コーチ · 8言語 · 無料',
    heroTitle: 'ネイティブ発音を\n最速で習得する方法',
    heroSub: 'AIが翻訳・採点・コーチングします。',
    heroSubEm: '8言語、完全無料。',
    ctaStart: 'Googleで始める',
    stats: [{ num: '8', label: '対応言語' }, { num: '100', label: '点満点採点' }, { num: '無料', label: '完全無料' }],
    sectionLabel: '主な機能',
    sectionTitle: 'なぜPronunFitなのか？',
    features: [
      { icon: '🆓', num: '01 · 完全無料', title: '8言語のAI発音アプリ、<br />0円でスタート', desc: '英語・韓国語・日本語・中国語・ベトナム語・フランス語・ドイツ語・スペイン語。広告なし、隠れた費用なし — 登録だけですべての機能が無料に。', tag: '✓ クレジットカード不要' },
      { icon: '🎙️', num: '02 · AI発音コーチ', title: '聞いて → まねして →<br />点数をもらう', desc: 'AIが文を読み上げるのを聞いてまねてください。正確さ・流暢さ・韻律など5項目をリアルタイムで分析してグラフで表示します。', tag: '✓ Azure AI音声分析' },
      { icon: '📚', num: '03 · スマート単語帳', title: '保存して・確認して・<br />また練習できる単語帳', desc: '翻訳した文をワンタップで保存するだけ。保管庫からいつでも取り出して発音練習まで続けられます。', tag: '✓ 学習履歴自動保存' },
      { icon: '🌍', num: '04 · シーン練習', title: '場所と状況別の<br />実践的な語学学習', desc: '空港・ホテル・レストランなど場面を選択。AIが学習文章を生成し音声で再生します。実戦的な発音練習が可能です。', tag: '✓ 場所・状況別語学学習' },
    ],
    appLabel: 'アプリを見てみる',
    appTitle: 'こんな機能が待っています',
    appCards: [
      { badge: '発音分析結果', title: 'AIが音素レベルまで<br />精密に分析します', desc: '話した後すぐにスコアが出ます。単語・音素ごとの正確さを信号機の色で直感的に確認し、AIコーチのカスタムフィードバックも受けられます。', img: '/mockup_pronunciation.png', imgAlt: '発音分析結果画面' },
      { badge: '言語・目標設定', title: '自分に合わせて<br />言語と目標を設定', desc: '8言語から最大3つを選び、目標スコアを設定するとAIがそれに合わせたコーチングを提供します。', img: '/mockup_multilang.png', imgAlt: '多言語設定画面' },
      { badge: 'シーン練習', title: 'AIが場面に合わせた<br />文章を生成・音声再生', desc: '空港・ホテル・レストランなど場面を選択。AIが文章を生成して音声で再生します。リピートして発音を採点、実戦的な表現を身につけましょう。', img: '/mockup_scene.svg', imgAlt: 'シーン練習画面' },
    ],
    ctaTitle: '今すぐ始めましょう。',
    ctaHighlight: '無料で、すぐに。',
    ctaSub: '登録30秒。8言語のAI発音コーチが今あなたを待っています。',
    footerNote: 'PronunFit · AI発音コーチ · 登録後すぐ無料利用',
    installPopup: '📲 アプリをインストールすると\nすぐにアクセスできます',
  },
  'zh-CN': {
    login: '登录',
    signUp: '注册',
    otherLogin: '其他登录方式',
    usps: [
      { title: '免费快速提升\n母语级发音的最佳方法', sub: 'AI翻译、评分、辅导。8种语言，完全免费。' },
      { title: '听 · 模仿 · 获得评分\n完善你的发音', sub: '通过5项指标了解准确度、流利度和韵律，一眼看出与母语者的差距。' },
      { title: '保存并反复练习的\n智能单词本', sub: '一键保存，随时从词库取出进行发音练习。' },
      { title: 'AI按场景推荐句子\n进行实战口语练习', sub: 'AI根据场景和情境生成句子并语音播放，通过发音练习掌握地道表达。' },
    ],
    tagline: 'AI发音教练 · 8种语言 · 免费',
    heroTitle: '快速提升\n母语级发音的最佳方法',
    heroSub: 'AI翻译、评分、辅导。',
    heroSubEm: '8种语言，完全免费。',
    ctaStart: '用Google开始',
    stats: [{ num: '8', label: '支持语言' }, { num: '100', label: '满分评分' }, { num: '免费', label: '完全免费' }],
    sectionLabel: '核心功能',
    sectionTitle: '为什么选择PronunFit？',
    features: [
      { icon: '🆓', num: '01 · 完全免费', title: '8种语言AI发音应用，<br />零成本开始', desc: '英语·韩语·日语·中文·越南语·法语·德语·西班牙语。无广告，无隐藏费用 — 注册即可免费使用所有功能。', tag: '✓ 无需信用卡' },
      { icon: '🎙️', num: '02 · AI发音教练', title: '听 → 模仿 →<br />获得评分', desc: 'AI朗读句子，你来模仿。实时分析准确度、流利度、韵律等5项指标，以图表直观呈现。', tag: '✓ Azure AI语音分析' },
      { icon: '📚', num: '03 · 智能单词本', title: '保存、查找、<br />反复练习', desc: '翻译的句子一键收藏。从词库取出后可继续进行发音练习。', tag: '✓ 学习记录自动保存' },
      { icon: '🌍', num: '04 · 场景练习', title: '按场景和情境<br />进行实战语言学习', desc: '选择机场、酒店、餐厅等场景，AI生成学习句子并语音播放，进行实战发音练习，学习真实使用的语言。', tag: '✓ 场景/情境别语言学习' },
    ],
    appLabel: '探索应用',
    appTitle: '这些功能等着你',
    appCards: [
      { badge: '发音分析结果', title: 'AI精确分析到<br />每个音素', desc: '说完立即得分。以红绿灯颜色直观显示每个单词和音素的准确度，还可获得AI教练的个性化反馈。', img: '/mockup_pronunciation.png', imgAlt: '发音分析结果界面' },
      { badge: '语言与目标设置', title: '设置你的语言<br />和目标分数', desc: '从8种语言中最多选择3种，设定目标分数后AI会提供个性化辅导。随时更改设置。', img: '/mockup_multilang.png', imgAlt: '多语言设置界面' },
      { badge: '场景练习', title: 'AI生成场景句子<br />并语音播放', desc: '选择机场、酒店、餐厅等场景，AI生成句子并语音播放。跟读获得评分，掌握真实语境中的地道表达。', img: '/mockup_scene.svg', imgAlt: '场景练习界面' },
    ],
    ctaTitle: '立即开始。',
    ctaHighlight: '免费。即时。',
    ctaSub: '30秒完成注册。8种语言的AI发音教练已准备好为你服务。',
    footerNote: 'PronunFit · AI发音教练 · 注册即免费使用',
    installPopup: '📲 安装应用，\n随时即可访问',
  },
  vi: {
    login: 'Đăng nhập',
    signUp: 'Đăng ký',
    otherLogin: 'Phương thức đăng nhập khác',
    usps: [
      { title: 'Cách nhanh nhất để luyện\nphát âm chuẩn bản ngữ — miễn phí', sub: 'AI dịch, chấm điểm và huấn luyện bạn. 8 ngôn ngữ, hoàn toàn miễn phí.' },
      { title: 'Nghe · Lặp lại · Nhận điểm\nvà hoàn thiện phát âm', sub: 'Xem độ chính xác, sự trôi chảy và ngữ điệu qua 5 chỉ số để biết khoảng cách với người bản ngữ.' },
      { title: 'Kho từ vựng thông minh —\nlưu và luyện tập lại', sub: 'Một chạm để lưu, lấy ra luyện phát âm bất cứ lúc nào.' },
      { title: 'AI gợi ý câu theo tình huống\ncho luyện ngôn ngữ thực tế', sub: 'AI tạo câu theo địa điểm và tình huống, đọc to để hướng dẫn luyện phát âm.' },
    ],
    tagline: 'Huấn luyện phát âm AI · 8 ngôn ngữ · Miễn phí',
    heroTitle: 'Cách nhanh nhất để luyện\nphát âm chuẩn bản ngữ',
    heroSub: 'AI dịch, chấm điểm và huấn luyện bạn. ',
    heroSubEm: '8 ngôn ngữ, hoàn toàn miễn phí.',
    ctaStart: 'Bắt đầu với Google',
    stats: [{ num: '8', label: 'Ngôn ngữ' }, { num: '100', label: 'Thang điểm' }, { num: 'Miễn phí', label: 'Luôn miễn phí' }],
    sectionLabel: 'Tính năng chính',
    sectionTitle: 'Tại sao chọn PronunFit?',
    features: [
      { icon: '🆓', num: '01 · Hoàn toàn miễn phí', title: 'Ứng dụng phát âm AI 8 ngôn ngữ,<br />không tốn chi phí', desc: 'Tiếng Anh · Hàn · Nhật · Trung · Việt · Pháp · Đức · Tây Ban Nha. Không quảng cáo, không phí ẩn — đăng ký là dùng được toàn bộ tính năng miễn phí.', tag: '✓ Không cần thẻ tín dụng' },
      { icon: '🎙️', num: '02 · Huấn luyện phát âm AI', title: 'Nghe → Lặp lại →<br />Nhận điểm', desc: 'AI đọc câu — bạn lặp lại. Phân tích thời gian thực về độ chính xác, sự trôi chảy và ngữ điệu qua 5 chiều, hiển thị dạng biểu đồ.', tag: '✓ Hỗ trợ bởi Azure AI Speech' },
      { icon: '📚', num: '03 · Kho từ vựng thông minh', title: 'Lưu, xem lại,<br />và luyện tập lại', desc: 'Gắn sao bất kỳ câu dịch nào để lưu ngay lập tức. Mở thư viện bất cứ lúc nào và luyện phát âm ngay.', tag: '✓ Tự động lưu lịch sử học' },
      { icon: '🌍', num: '04 · Luyện theo tình huống', title: 'Học ngôn ngữ thực tế<br />theo địa điểm và tình huống', desc: 'Chọn cảnh như sân bay, khách sạn, nhà hàng. AI tạo câu học và phát âm thanh. Luyện phát âm trong bối cảnh thực tế.', tag: '✓ Học ngôn ngữ theo tình huống' },
    ],
    appLabel: 'Khám phá ứng dụng',
    appTitle: 'Đây là những gì đang chờ bạn',
    appCards: [
      { badge: 'Kết quả phân tích phát âm', title: 'AI chấm điểm đến từng<br />âm vị', desc: 'Nhận điểm ngay sau khi nói. Xem độ chính xác theo từng từ và âm vị với màu sắc đèn giao thông, cùng gợi ý coaching cá nhân từ AI.', img: '/mockup_pronunciation.png', imgAlt: 'Màn hình phân tích phát âm' },
      { badge: 'Cài đặt ngôn ngữ & mục tiêu', title: 'Đặt ngôn ngữ<br />và điểm mục tiêu', desc: 'Chọn tối đa 3 trong 8 ngôn ngữ và đặt điểm mục tiêu — AI điều chỉnh coaching phù hợp. Thay đổi cài đặt bất cứ lúc nào.', img: '/mockup_multilang.png', imgAlt: 'Màn hình cài đặt đa ngôn ngữ' },
      { badge: 'Luyện theo tình huống', title: 'AI tạo câu theo tình huống<br />và đọc to cho bạn nghe', desc: 'Chọn sân bay, khách sạn, nhà hàng và nhiều hơn nữa. AI tạo câu và đọc to. Lặp lại, nhận điểm và thành thạo phát âm thực tế.', img: '/mockup_scene.svg', imgAlt: 'Màn hình luyện theo tình huống' },
    ],
    ctaTitle: 'Bắt đầu ngay bây giờ.',
    ctaHighlight: 'Miễn phí. Ngay lập tức.',
    ctaSub: '30 giây để đăng ký. Huấn luyện viên phát âm AI 8 ngôn ngữ đã sẵn sàng.',
    footerNote: 'PronunFit · Huấn luyện phát âm AI · Miễn phí từ ngày đầu',
    installPopup: '📲 Cài đặt ứng dụng\nđể truy cập ngay',
  },
  fr: {
    login: 'Connexion',
    signUp: "S'inscrire",
    otherLogin: 'Autres options de connexion',
    usps: [
      { title: 'La façon la plus rapide de maîtriser\nla prononciation native — gratuit', sub: "L'IA traduit, note et vous entraîne. 8 langues, entièrement gratuit." },
      { title: 'Écouter · Répéter · Obtenir une note\net perfectionner votre accent', sub: "Voyez la précision, la fluidité et la prosodie sur 5 métriques pour identifier l'écart avec les locuteurs natifs." },
      { title: 'Votre carnet de vocabulaire intelligent —\nenregistrer et pratiquer encore', sub: "Un tap pour enregistrer, puis reprenez-le pour des exercices de prononciation." },
      { title: "L'IA propose des phrases selon la scène\npour une pratique réelle", sub: "L'IA génère des phrases selon le lieu et la situation, les lit à voix haute pour guider votre pratique de prononciation." },
    ],
    tagline: 'Coach de prononciation IA · 8 langues · Gratuit',
    heroTitle: 'La façon la plus rapide de maîtriser\nla prononciation native',
    heroSub: "L'IA traduit, note et vous entraîne. ",
    heroSubEm: '8 langues, entièrement gratuit.',
    ctaStart: 'Commencer avec Google',
    stats: [{ num: '8', label: 'Langues' }, { num: '100', label: 'Points' }, { num: 'Gratuit', label: 'Toujours gratuit' }],
    sectionLabel: 'Fonctionnalités clés',
    sectionTitle: 'Pourquoi PronunFit ?',
    features: [
      { icon: '🆓', num: '01 · Entièrement gratuit', title: 'Prononciation IA en 8 langues,<br />zéro coût', desc: 'Anglais · Coréen · Japonais · Chinois · Vietnamien · Français · Allemand · Espagnol. Pas de pubs, pas de frais cachés — inscrivez-vous et accédez à tout gratuitement.', tag: '✓ Pas de carte de crédit requise' },
      { icon: '🎙️', num: "02 · Coach de prononciation IA", title: "Écouter → Répéter →<br />Obtenir votre note", desc: "L'IA lit la phrase à voix haute — vous la répétez. Analyse en temps réel de la précision, de la fluidité et de la prosodie sur 5 dimensions, visualisées en graphique.", tag: '✓ Propulsé par Azure AI Speech' },
      { icon: '📚', num: '03 · Carnet de vocabulaire intelligent', title: 'Enregistrer, réviser,<br />et pratiquer encore', desc: "Mettez une étoile sur n'importe quelle phrase traduite pour la sauvegarder instantanément. Ouvrez votre bibliothèque et commencez à pratiquer la prononciation.", tag: "✓ Historique d'apprentissage auto-sauvegardé" },
      { icon: '🌍', num: '04 · Pratique par scène', title: "Apprentissage vivant<br />par lieu et situation", desc: "Choisissez une scène — aéroport, hôtel, restaurant et plus encore. L'IA génère et lit les phrases à voix haute pour guider votre pratique de prononciation.", tag: '✓ Apprentissage par scènes' },
    ],
    appLabel: "Explorer l'application",
    appTitle: 'Voici ce qui vous attend',
    appCards: [
      { badge: 'Analyse de prononciation', title: "L'IA vous note jusqu'aux<br />phonèmes individuels", desc: "Obtenez votre score immédiatement après avoir parlé. Voyez la précision par mot et par phonème codée en couleurs comme un feu de circulation, plus des conseils personnalisés de l'IA.", img: '/mockup_pronunciation.png', imgAlt: "Écran d'analyse de prononciation" },
      { badge: 'Paramètres de langue et objectif', title: 'Définissez vos langues<br />et votre score cible', desc: "Choisissez jusqu'à 3 langues parmi 8 et définissez votre score cible — l'IA adapte son coaching. Modifiez vos paramètres à tout moment.", img: '/mockup_multilang.png', imgAlt: 'Écran de paramètres multilingues' },
      { badge: 'Pratique par scène', title: "L'IA génère des phrases<br />adaptées à la scène", desc: "Choisissez aéroport, hôtel, restaurant et plus. L'IA crée des phrases et les lit à voix haute. Répétez, notez-vous et maîtrisez la prononciation en contexte réel.", img: '/mockup_scene.svg', imgAlt: 'Écran de pratique par scène' },
    ],
    ctaTitle: 'Commencez maintenant.',
    ctaHighlight: 'Gratuit. Instantané.',
    ctaSub: "30 secondes pour s'inscrire. Votre coach de prononciation IA en 8 langues est prêt.",
    footerNote: "PronunFit · Coach de prononciation IA · Gratuit dès le premier jour",
    installPopup: "📲 Installez l'application\npour un accès instantané",
  },
  de: {
    login: 'Anmelden',
    signUp: 'Registrieren',
    otherLogin: 'Andere Anmeldemethoden',
    usps: [
      { title: 'Der schnellste Weg zur muttersprachlichen\nAussprache — kostenlos', sub: 'KI übersetzt, bewertet und coacht Sie. 8 Sprachen, völlig kostenlos.' },
      { title: 'Hören · Nachsprechen · Punkte sammeln\nund Akzent perfektionieren', sub: 'Sehen Sie Genauigkeit, Flüssigkeit und Prosodie in 5 Metriken, um den Unterschied zu Muttersprachlern zu erkennen.' },
      { title: 'Ihr smartes Vokabelheft —\nspeichern und wieder üben', sub: 'Ein Tipp zum Speichern, dann jederzeit für Ausspracheübungen wieder aufrufen.' },
      { title: 'KI empfiehlt Sätze je nach Szene\nfür echte Sprachpraxis', sub: 'KI generiert Sätze nach Ort und Situation und liest sie vor — üben Sie Aussprache im Alltag.' },
    ],
    tagline: 'KI-Aussprache-Coach · 8 Sprachen · Kostenlos',
    heroTitle: 'Der schnellste Weg zur\nmuttersprachlichen Aussprache',
    heroSub: 'KI übersetzt, bewertet und coacht Sie. ',
    heroSubEm: '8 Sprachen, völlig kostenlos.',
    ctaStart: 'Mit Google starten',
    stats: [{ num: '8', label: 'Sprachen' }, { num: '100', label: 'Punkte' }, { num: 'Gratis', label: 'Immer kostenlos' }],
    sectionLabel: 'Kernfunktionen',
    sectionTitle: 'Warum PronunFit?',
    features: [
      { icon: '🆓', num: '01 · Völlig kostenlos', title: 'KI-Aussprache in 8 Sprachen,<br />null Kosten', desc: 'Englisch · Koreanisch · Japanisch · Chinesisch · Vietnamesisch · Französisch · Deutsch · Spanisch. Keine Werbung, keine versteckten Kosten — registrieren Sie sich und erhalten Sie alles kostenlos.', tag: '✓ Keine Kreditkarte erforderlich' },
      { icon: '🎙️', num: '02 · KI-Aussprache-Coach', title: 'Hören → Nachsprechen →<br />Punkte erhalten', desc: 'KI liest den Satz vor — Sie sprechen nach. Echtzeit-Analyse von Genauigkeit, Flüssigkeit und Prosodie in 5 Dimensionen, visualisiert als Diagramm.', tag: '✓ Unterstützt von Azure AI Speech' },
      { icon: '📚', num: '03 · Smartes Vokabelheft', title: 'Speichern, überprüfen,<br />und wieder üben', desc: 'Markieren Sie einen beliebigen übersetzten Satz mit einem Stern zum sofortigen Speichern. Öffnen Sie Ihre Bibliothek und üben Sie direkt Aussprache.', tag: '✓ Lernverlauf automatisch gespeichert' },
      { icon: '🌍', num: '04 · Szenen-Übungen', title: 'Lebendiges Sprachlernen<br />nach Ort und Situation', desc: 'Wählen Sie eine Szene — Flughafen, Hotel, Restaurant und mehr. KI generiert Sätze und liest sie vor. Üben Sie Aussprache im realen Kontext.', tag: '✓ Szenbasiertes Sprachlernen' },
    ],
    appLabel: 'App erkunden',
    appTitle: 'Das erwartet Sie',
    appCards: [
      { badge: 'Ausspracheanalyse', title: 'KI bewertet Sie bis zu<br />einzelnen Phonemen', desc: 'Erhalten Sie Ihren Score sofort nach dem Sprechen. Sehen Sie Wort- und Phonemgenauigkeit farbcodiert wie eine Ampel, plus personalisierte Coaching-Tipps der KI.', img: '/mockup_pronunciation.png', imgAlt: 'Bildschirm Ausspracheanalyse' },
      { badge: 'Sprach- und Zieleinstellung', title: 'Legen Sie Ihre Sprachen<br />und Zielpunkte fest', desc: 'Wählen Sie bis zu 3 von 8 Sprachen und legen Sie Ihren Zielscore fest — KI passt das Coaching an. Einstellungen jederzeit änderbar.', img: '/mockup_multilang.png', imgAlt: 'Mehrsprachiger Einstellungsbildschirm' },
      { badge: 'Szenen-Übungen', title: 'KI generiert szenbasierte<br />Sätze und liest vor', desc: 'Wählen Sie Flughafen, Hotel, Restaurant und mehr. KI erstellt Sätze und liest sie vor. Wiederholen, bewerten lassen und alltagstaugliche Aussprache meistern.', img: '/mockup_scene.svg', imgAlt: 'Bildschirm Szenen-Übungen' },
    ],
    ctaTitle: 'Jetzt sofort anfangen.',
    ctaHighlight: 'Kostenlos. Sofort.',
    ctaSub: '30 Sekunden zur Anmeldung. Ihr KI-Aussprache-Coach in 8 Sprachen ist bereit.',
    footerNote: 'PronunFit · KI-Aussprache-Coach · Ab dem ersten Tag kostenlos',
    installPopup: '📲 Installieren Sie die App\nfür sofortigen Zugang',
  },
  es: {
    login: 'Iniciar sesión',
    signUp: 'Registrarse',
    otherLogin: 'Otras opciones de inicio de sesión',
    usps: [
      { title: 'La forma más rápida de dominar\nla pronunciación nativa — gratis', sub: 'La IA traduce, puntúa y te entrena. 8 idiomas, completamente gratis.' },
      { title: 'Escuchar · Repetir · Recibir puntos\ny perfeccionar tu acento', sub: 'Ve la precisión, fluidez y prosodia en 5 métricas para identificar la brecha con los hablantes nativos.' },
      { title: 'Tu vocabulario inteligente —\nguardar y practicar de nuevo', sub: 'Un toque para guardar, luego sácalo para practicar pronunciación cuando quieras.' },
      { title: 'La IA propone frases según la escena\npara una práctica real', sub: 'La IA genera frases según el lugar y la situación, las lee en voz alta para guiar tu práctica de pronunciación.' },
    ],
    tagline: 'Coach de pronunciación IA · 8 idiomas · Gratis',
    heroTitle: 'La forma más rápida de dominar\nla pronunciación nativa',
    heroSub: 'La IA traduce, puntúa y te entrena. ',
    heroSubEm: '8 idiomas, completamente gratis.',
    ctaStart: 'Empezar con Google',
    stats: [{ num: '8', label: 'Idiomas' }, { num: '100', label: 'Puntuación' }, { num: 'Gratis', label: 'Siempre gratis' }],
    sectionLabel: 'Características clave',
    sectionTitle: '¿Por qué PronunFit?',
    features: [
      { icon: '🆓', num: '01 · Completamente gratis', title: 'Pronunciación IA en 8 idiomas,<br />cero costo', desc: 'Inglés · Coreano · Japonés · Chino · Vietnamita · Francés · Alemán · Español. Sin anuncios, sin tarifas ocultas — regístrate y accede a todo gratis.', tag: '✓ No se requiere tarjeta de crédito' },
      { icon: '🎙️', num: '02 · Coach de pronunciación IA', title: 'Escuchar → Repetir →<br />Recibir puntuación', desc: 'La IA lee la frase en voz alta — tú la repites. Análisis en tiempo real de precisión, fluidez y prosodia en 5 dimensiones, visualizadas en un gráfico.', tag: '✓ Desarrollado con Azure AI Speech' },
      { icon: '📚', num: '03 · Vocabulario inteligente', title: 'Guardar, revisar,<br />y practicar de nuevo', desc: 'Marca cualquier frase traducida para guardarla al instante. Abre tu biblioteca y comienza a practicar pronunciación directamente.', tag: '✓ Historial de aprendizaje guardado automáticamente' },
      { icon: '🌍', num: '04 · Práctica por escena', title: 'Aprendizaje real<br />por lugar y situación', desc: 'Elige una escena — aeropuerto, hotel, restaurante y más. La IA genera frases y las lee en voz alta. Practica pronunciación en contextos reales.', tag: '✓ Aprendizaje por escenas' },
    ],
    appLabel: 'Explorar la app',
    appTitle: 'Esto es lo que te espera',
    appCards: [
      { badge: 'Análisis de pronunciación', title: 'La IA te puntúa hasta los<br />fonemas individuales', desc: 'Obtén tu puntuación inmediatamente después de hablar. Ve la precisión por palabra y fonema codificada por colores como un semáforo, más consejos de coaching personalizados de la IA.', img: '/mockup_pronunciation.png', imgAlt: 'Pantalla de análisis de pronunciación' },
      { badge: 'Configuración de idioma y objetivo', title: 'Configura tus idiomas<br />y puntuación objetivo', desc: 'Elige hasta 3 de 8 idiomas y establece tu puntuación objetivo — la IA adapta su coaching. Cambia la configuración en cualquier momento.', img: '/mockup_multilang.png', imgAlt: 'Pantalla de configuración multilingüe' },
      { badge: 'Práctica por escena', title: 'La IA genera frases<br />según la escena y las lee', desc: 'Elige aeropuerto, hotel, restaurante y más. La IA crea frases y las lee en voz alta. Repite, recibe puntuación y domina la pronunciación en la vida real.', img: '/mockup_scene.svg', imgAlt: 'Pantalla de práctica por escena' },
    ],
    ctaTitle: 'Empieza ahora mismo.',
    ctaHighlight: 'Gratis. Instantáneo.',
    ctaSub: '30 segundos para registrarse. Tu coach de pronunciación IA en 8 idiomas está listo.',
    footerNote: 'PronunFit · Coach de pronunciación IA · Gratis desde el primer día',
    installPopup: '📲 Instala la app\npara acceso instantáneo',
  },
};

const LandingPage = ({ onGoogleLogin, onLogin, onSignup, onInstall, showInstall }) => {
  const titleRef = useRef(null);
  const subRef = useRef(null);
  const bottomRef = useRef(null);
  const [showInstallPopup, setShowInstallPopup] = useState(false);

  const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  const c = (() => {
    if (browserLang.startsWith('ko')) return CONTENT.ko;
    if (browserLang.startsWith('ja')) return CONTENT.ja;
    if (browserLang.startsWith('zh')) return CONTENT['zh-CN'];
    if (browserLang.startsWith('vi')) return CONTENT.vi;
    if (browserLang.startsWith('fr')) return CONTENT.fr;
    if (browserLang.startsWith('de')) return CONTENT.de;
    if (browserLang.startsWith('es')) return CONTENT.es;
    return CONTENT.en;
  })();

  const usps = c.usps;

  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      if (!titleRef.current || !subRef.current) return;
      titleRef.current.style.opacity = '0';
      subRef.current.style.opacity = '0';
      setTimeout(() => {
        idx = (idx + 1) % usps.length;
        if (!titleRef.current || !subRef.current) return;
        titleRef.current.innerText = usps[idx].title;
        subRef.current.innerText = usps[idx].sub;
        titleRef.current.style.transition = 'opacity 0.5s ease';
        subRef.current.style.transition = 'opacity 0.5s ease';
        titleRef.current.style.opacity = '1';
        subRef.current.style.opacity = '1';
      }, 500);
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 스크롤 끝 감지 → 설치 팝업
  useEffect(() => {
    if (!showInstall || !bottomRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setShowInstallPopup(true); },
      { threshold: 0.5 }
    );
    observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [showInstall]);

  return (
    <div className="lp-root">
      {/* 배경 앰비언트 조명 */}
      <div className="lp-ambient lp-ambient-1" />
      <div className="lp-ambient lp-ambient-2" />

      {/* ── 네비게이션 ── */}
      <nav className="lp-nav">
        <div className="lp-logo">PronunFit</div>
        <div className="lp-nav-actions">
          <button className="lp-install-btn" onClick={onInstall}>📲 Download</button>
          <button className="lp-login-btn" onClick={onSignup}>{c.signUp}</button>
        </div>
      </nav>

      {/* ── HERO 섹션 ── */}
      <header className="lp-hero">
        <div className="lp-tagline-wrap">
          <div className="lp-hero-free-badge">FREE</div>
          <div className="lp-tagline">
            <span className="lp-tagline-dot" />
            {c.tagline}
          </div>
        </div>

        <h1 className="lp-hero-title" ref={titleRef}>
          {c.heroTitle}
        </h1>

        <p className="lp-hero-subtitle" ref={subRef}>
          {c.heroSub}
          <span className="lp-hero-sub-em">{c.heroSubEm}</span>
        </p>

        <div className="lp-cta-group">
          <button className="lp-btn lp-btn-primary" onClick={onGoogleLogin}>
            {c.ctaStart}
          </button>
          <button className="lp-btn lp-btn-secondary" onClick={onLogin}>
            {c.otherLogin}
          </button>
        </div>

        {/* 신뢰 지표 */}
        <div className="lp-hero-stats">
          {c.stats.map((s, i) => (
            <div className="lp-stat" key={i}>
              <span className="lp-stat-num">{s.num}</span>
              <span className="lp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── USP Feature Cards ── */}
      <section className="lp-usp-section">
        <p className="lp-section-label">{c.sectionLabel}</p>
        <h2 className="lp-section-title">{c.sectionTitle}</h2>

        <div className="lp-features-grid">
          {c.features.map((f, i) => (
            <div className="lp-feature-card" key={i}>
              <div className="lp-feature-icon-wrap">{f.icon}</div>
              <span className="lp-feature-number">{f.num}</span>
              <h3 className="lp-feature-title" dangerouslySetInnerHTML={{ __html: f.title }} />
              <p className="lp-feature-desc">{f.desc}</p>
              <span className="lp-feature-tag">{f.tag}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 앱 스크린샷 섹션 ── */}
      <section className="lp-app-section">
        <p className="lp-section-label">{c.appLabel}</p>
        <h2 className="lp-section-title">{c.appTitle}</h2>

        <div className="lp-app-grid">
          {c.appCards.map((card, i) => (
            <div className="lp-app-card" key={i}>
              <div className="lp-app-card-body">
                <span className="lp-app-card-badge">{card.badge}</span>
                <h3 className="lp-app-card-title" dangerouslySetInnerHTML={{ __html: card.title }} />
                <p className="lp-app-card-desc">{card.desc}</p>
              </div>
              <img src={card.img} alt={card.imgAlt} className="lp-app-card-img" />
            </div>
          ))}
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className="lp-cta-section">
        <h2 className="lp-cta-title">
          {c.ctaTitle}<br />
          <span className="lp-highlight">{c.ctaHighlight}</span>
        </h2>
        <p className="lp-cta-sub">{c.ctaSub}</p>
        <div className="lp-cta-btn-wrap">
          <button className="lp-btn lp-btn-primary" onClick={onGoogleLogin}>
            {c.ctaStart}
          </button>
          <button className="lp-btn lp-btn-secondary" onClick={onLogin}>
            {c.otherLogin}
          </button>
        </div>
        <p className="lp-footer-note">{c.footerNote}</p>
        {/* 스크롤 감지 sentinel */}
        <div ref={bottomRef} style={{ height: 1 }} />
      </section>

      {/* ── 설치 팝업 ── */}
      {showInstall && showInstallPopup && (
        <div className="lp-install-popup" style={{ position: 'fixed' }}>
          <button className="lp-popup-close" onClick={() => setShowInstallPopup(false)}>✕</button>
          <p className="lp-popup-msg">{c.installPopup.split('\n').map((line, i) => (
            <span key={i}>{line}{i === 0 && <br />}</span>
          ))}</p>
          <button className="lp-popup-install-btn" onClick={() => { onInstall(); setShowInstallPopup(false); }}>
            Download
          </button>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
