"""
TabTutorial 콘텐츠 갱신 (vocab v2 + listening 신설)

- vocab1Title/Desc + vocab2Title/Desc → 새 슬라이더+모달+생성 흐름 반영
- listening1Title/Desc + listening2Title/Desc → 신설 (Vocab과 동일 흐름 + 에세이/대화)
- CJK 3개(ko/ja/zh-CN)는 사용자 요청대로 "세부항목이 Pop up으로" 표현
- 그 외 7개(en/de/es/fr/pt-BR/ru/vi)는 영어 캐논("Tap a card to open the topic modal")의 번역

기존 다른 키는 보존. 동일 키 존재 시 덮어쓰기 (재실행 시 최신 텍스트 갱신).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "src" / "locales"

# CJK 3개: "세부항목이 Pop up으로" 표현
CJK_TRANSLATIONS = {
    "ko": {
        "vocab1Title": "카드를 스와이프해서 카테고리를 골라보세요",
        "vocab1Desc": "7개 시네마 카테고리 카드 중 마음에 드는 것을 탭하면 세부항목이 Pop up으로 뜹니다. 토픽 선택 후 ✨ 단어 생성 버튼을 누르면 AI가 단어 5개를 만들어 줍니다.",
        "vocab2Title": "🔊 듣고 🎙️ 발음 받고 ☆ 저장하기",
        "vocab2Desc": "단어 카드에서 🔊 버튼으로 원어민 발음을 듣고, 🎙️ 마이크로 발음 점수를 받으세요. ☆를 누르면 단어장에 저장돼 언제든 복습할 수 있어요.",
        "listening1Title": "카드를 스와이프해서 듣기 주제를 골라보세요",
        "listening1Desc": "7개 시네마 카테고리 카드 중 마음에 드는 것을 탭하면 세부항목이 Pop up으로 뜹니다. 토픽 선택 후 에세이/대화 형식을 고르고 ✨ 지문 생성 버튼을 누르면 AI가 듣기 지문을 만들어 줍니다.",
        "listening2Title": "▶ 재생 + 핵심 단어 발음 연습",
        "listening2Desc": "▶ 버튼으로 지문을 들어보고, 아래 핵심 단어 5개 카드에서 🎙️ 마이크로 발음 점수까지 받으세요. ☆로 저장하면 단어장에 추가됩니다.",
    },
    "ja": {
        "vocab1Title": "カードをスワイプしてカテゴリを選びましょう",
        "vocab1Desc": "7枚のシネマカテゴリカードからお好みのものをタップすると、詳細項目がポップアップで表示されます。トピック選択後 ✨ 単語生成 ボタンを押すと、AIが単語を5個作ってくれます。",
        "vocab2Title": "🔊 聞いて 🎙️ 発音採点して ☆ 保存",
        "vocab2Desc": "単語カードの 🔊 ボタンでネイティブ発音を聞き、🎙️ マイクで発音スコアを受け取りましょう。☆ を押すと単語帳に保存され、いつでも復習できます。",
        "listening1Title": "カードをスワイプしてリスニング主題を選びましょう",
        "listening1Desc": "7枚のシネマカテゴリカードからお好みのものをタップすると、詳細項目がポップアップで表示されます。トピック選択後、エッセイ/会話の形式を選び ✨ 文章生成 を押すと、AIがリスニング文章を作ってくれます。",
        "listening2Title": "▶ 再生 + 重要単語の発音練習",
        "listening2Desc": "▶ ボタンで文章を聞いて、下の重要単語5個カードで 🎙️ マイクから発音スコアまで受け取りましょう。☆ で保存すると単語帳に追加されます。",
    },
    "zh-CN": {
        "vocab1Title": "滑动卡片来选择分类",
        "vocab1Desc": "在7张电影感分类卡片中点击喜欢的一张，详细项目会以弹窗形式出现。选择主题后点击 ✨ 生成单词，AI会为你创建5个单词。",
        "vocab2Title": "🔊 听 + 🎙️ 发音 + ☆ 保存",
        "vocab2Desc": "在单词卡片上点击 🔊 听原生发音，🎙️ 麦克风评分发音。按 ☆ 保存到你的单词本，随时复习。",
        "listening1Title": "滑动卡片来选择听力主题",
        "listening1Desc": "在7张电影感分类卡片中点击喜欢的一张，详细项目会以弹窗形式出现。选择主题后选择短文/对话形式，点击 ✨ 生成文本，AI会创建听力文本。",
        "listening2Title": "▶ 播放 + 核心单词发音练习",
        "listening2Desc": "▶ 按钮播放文本后，在下方核心5个单词卡片中用 🎙️ 麦克风获得发音评分。按 ☆ 保存到单词本。",
    },
}

# 영어 캐논 (영어 + 5개 라틴/키릴 언어가 의미 동일하게 따름)
NON_CJK_TRANSLATIONS = {
    "en": {
        "vocab1Title": "Swipe through cards to pick a category",
        "vocab1Desc": "Swipe to find one of 7 cinematic category cards. Tap a card to open the topic modal, pick a topic, then tap ✨ Generate Words — AI will create 5 words for you.",
        "vocab2Title": "Listen 🔊, score 🎙️, save ☆",
        "vocab2Desc": "On each word card, tap 🔊 to hear native pronunciation, 🎙️ to get your score, and ☆ to save it to your library for review anytime.",
        "listening1Title": "Swipe through cards to pick a listening topic",
        "listening1Desc": "Swipe to find one of 7 cinematic category cards. Tap a card to open the topic modal, pick a topic, choose Essay or Dialogue, then tap ✨ Generate Passage — AI will create a listening passage for you.",
        "listening2Title": "▶ Play + practice key words",
        "listening2Desc": "Tap ▶ to listen to the passage, then practice the 5 key words below — tap 🎙️ to score your pronunciation. Save with ☆ to add to your library.",
    },
    "de": {
        "vocab1Title": "Wische durch die Karten, um eine Kategorie zu wählen",
        "vocab1Desc": "Wische, um eine der 7 Kino-Kategoriekarten zu finden. Tippe eine Karte an, um das Themen-Modal zu öffnen, wähle ein Thema und tippe dann auf ✨ Wörter erzeugen — die KI erstellt 5 Wörter für dich.",
        "vocab2Title": "🔊 Hören, 🎙️ bewerten, ☆ speichern",
        "vocab2Desc": "Tippe auf jeder Wortkarte 🔊 für die native Aussprache, 🎙️ für deine Bewertung, und ☆, um sie für späteres Wiederholen in deinem Wörterbuch zu speichern.",
        "listening1Title": "Wische durch die Karten, um ein Hörthema zu wählen",
        "listening1Desc": "Wische, um eine der 7 Kino-Kategoriekarten zu finden. Tippe eine Karte an, um das Themen-Modal zu öffnen, wähle ein Thema, wähle Essay oder Dialog und tippe dann auf ✨ Text erzeugen — die KI erstellt einen Hörtext für dich.",
        "listening2Title": "▶ Abspielen + Schlüsselwörter üben",
        "listening2Desc": "Tippe auf ▶, um den Text zu hören, und übe dann die 5 Schlüsselwörter darunter — tippe 🎙️ für deine Aussprachebewertung. Mit ☆ speicherst du sie in deinem Wörterbuch.",
    },
    "es": {
        "vocab1Title": "Desliza entre las tarjetas para elegir una categoría",
        "vocab1Desc": "Desliza para encontrar una de las 7 tarjetas cinematográficas de categoría. Toca una para abrir el modal de temas, elige un tema y luego toca ✨ Generar palabras — la IA creará 5 palabras para ti.",
        "vocab2Title": "Escucha 🔊, puntúa 🎙️, guarda ☆",
        "vocab2Desc": "En cada tarjeta de palabra, toca 🔊 para oír la pronunciación nativa, 🎙️ para obtener tu puntuación y ☆ para guardarla en tu biblioteca y repasarla cuando quieras.",
        "listening1Title": "Desliza entre las tarjetas para elegir un tema de escucha",
        "listening1Desc": "Desliza para encontrar una de las 7 tarjetas cinematográficas. Toca una para abrir el modal de temas, elige un tema, elige Ensayo o Diálogo y luego toca ✨ Generar texto — la IA creará un texto de escucha para ti.",
        "listening2Title": "▶ Reproduce + practica palabras clave",
        "listening2Desc": "Toca ▶ para escuchar el texto, luego practica las 5 palabras clave abajo — toca 🎙️ para puntuar tu pronunciación. Guarda con ☆ para añadir a tu biblioteca.",
    },
    "fr": {
        "vocab1Title": "Faites glisser les cartes pour choisir une catégorie",
        "vocab1Desc": "Faites glisser pour trouver l'une des 7 cartes cinématographiques de catégorie. Touchez une carte pour ouvrir la fenêtre de sujets, choisissez un sujet, puis touchez ✨ Générer mots — l'IA créera 5 mots pour vous.",
        "vocab2Title": "Écoutez 🔊, notez 🎙️, enregistrez ☆",
        "vocab2Desc": "Sur chaque carte de mot, touchez 🔊 pour entendre la prononciation native, 🎙️ pour obtenir votre note, et ☆ pour l'enregistrer dans votre carnet et la réviser à tout moment.",
        "listening1Title": "Faites glisser les cartes pour choisir un sujet d'écoute",
        "listening1Desc": "Faites glisser pour trouver l'une des 7 cartes cinématographiques. Touchez une carte pour ouvrir la fenêtre de sujets, choisissez un sujet, choisissez Essai ou Dialogue, puis touchez ✨ Générer texte — l'IA créera un texte d'écoute pour vous.",
        "listening2Title": "▶ Lire + pratiquer les mots clés",
        "listening2Desc": "Touchez ▶ pour écouter le texte, puis pratiquez les 5 mots clés en dessous — touchez 🎙️ pour noter votre prononciation. Enregistrez avec ☆ pour ajouter à votre carnet.",
    },
    "pt-BR": {
        "vocab1Title": "Deslize entre os cartões para escolher uma categoria",
        "vocab1Desc": "Deslize para encontrar um dos 7 cartões cinematográficos de categoria. Toque um cartão para abrir o modal de tópicos, escolha um tópico e toque ✨ Gerar palavras — a IA criará 5 palavras para você.",
        "vocab2Title": "Ouça 🔊, pontue 🎙️, salve ☆",
        "vocab2Desc": "Em cada cartão de palavra, toque 🔊 para ouvir a pronúncia nativa, 🎙️ para obter sua pontuação e ☆ para salvá-lo no seu caderno e revisar quando quiser.",
        "listening1Title": "Deslize entre os cartões para escolher um tópico de áudio",
        "listening1Desc": "Deslize para encontrar um dos 7 cartões cinematográficos. Toque um cartão para abrir o modal de tópicos, escolha um tópico, escolha Ensaio ou Diálogo e toque ✨ Gerar texto — a IA criará um texto de áudio para você.",
        "listening2Title": "▶ Reproduzir + praticar palavras-chave",
        "listening2Desc": "Toque ▶ para ouvir o texto, depois pratique as 5 palavras-chave abaixo — toque 🎙️ para pontuar sua pronúncia. Salve com ☆ para adicionar ao seu caderno.",
    },
    "ru": {
        "vocab1Title": "Листайте карточки, чтобы выбрать категорию",
        "vocab1Desc": "Листайте, чтобы найти одну из 7 кинематографичных карточек. Коснитесь карточки, чтобы открыть окно тем, выберите тему, затем нажмите ✨ Создать слова — ИИ создаст 5 слов для вас.",
        "vocab2Title": "🔊 Слушайте, 🎙️ оценивайте, ☆ сохраняйте",
        "vocab2Desc": "На каждой карточке слова коснитесь 🔊, чтобы услышать произношение носителя, 🎙️, чтобы получить оценку, и ☆, чтобы сохранить в словарную тетрадь для повторения в любое время.",
        "listening1Title": "Листайте карточки, чтобы выбрать тему аудирования",
        "listening1Desc": "Листайте, чтобы найти одну из 7 кинематографичных карточек. Коснитесь карточки, чтобы открыть окно тем, выберите тему, выберите Эссе или Диалог, затем нажмите ✨ Создать текст — ИИ создаст текст для аудирования.",
        "listening2Title": "▶ Воспроизведение + отработка ключевых слов",
        "listening2Desc": "Нажмите ▶, чтобы прослушать текст, затем отрабатывайте 5 ключевых слов ниже — коснитесь 🎙️, чтобы оценить произношение. Сохраните с помощью ☆, чтобы добавить в словарную тетрадь.",
    },
    "vi": {
        "vocab1Title": "Vuốt qua các thẻ để chọn chủ đề",
        "vocab1Desc": "Vuốt để tìm một trong 7 thẻ chủ đề điện ảnh. Chạm vào thẻ để mở cửa sổ chủ đề, chọn một chủ đề rồi chạm ✨ Tạo từ — AI sẽ tạo 5 từ cho bạn.",
        "vocab2Title": "Nghe 🔊, chấm điểm 🎙️, lưu ☆",
        "vocab2Desc": "Trên mỗi thẻ từ, chạm 🔊 để nghe phát âm chuẩn, 🎙️ để được chấm điểm, và ☆ để lưu vào sổ từ của bạn để ôn lại bất cứ lúc nào.",
        "listening1Title": "Vuốt qua các thẻ để chọn chủ đề nghe",
        "listening1Desc": "Vuốt để tìm một trong 7 thẻ chủ đề điện ảnh. Chạm vào thẻ để mở cửa sổ chủ đề, chọn một chủ đề, chọn Bài luận hoặc Đối thoại, rồi chạm ✨ Tạo văn bản — AI sẽ tạo văn bản nghe cho bạn.",
        "listening2Title": "▶ Phát + luyện từ khóa",
        "listening2Desc": "Chạm ▶ để nghe văn bản, sau đó luyện 5 từ khóa bên dưới — chạm 🎙️ để được chấm điểm phát âm. Lưu bằng ☆ để thêm vào sổ từ của bạn.",
    },
}


def patch_locale(loc: str, additions: dict) -> tuple[int, int]:
    p = LOCALES_DIR / f"{loc}.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    tutorial = data.setdefault("tutorial", {})
    added = updated = 0
    for k, v in additions.items():
        if k in tutorial:
            if tutorial[k] != v:
                tutorial[k] = v
                updated += 1
        else:
            tutorial[k] = v
            added += 1
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return added, updated


def main():
    all_translations = {**CJK_TRANSLATIONS, **NON_CJK_TRANSLATIONS}
    print(f"Patching tutorial.* keys across {len(all_translations)} locales\n")
    for loc, additions in all_translations.items():
        added, updated = patch_locale(loc, additions)
        family = "CJK" if loc in CJK_TRANSLATIONS else "Other"
        print(f"  {loc:<6} [{family}]  +{added} added, ~{updated} updated  ({len(additions)} keys)")
    print("\nDone.")


if __name__ == "__main__":
    main()
