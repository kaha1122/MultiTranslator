글export const uiTranslations = {
    ko: {
        savedSuccess: "저장 완료!",
        savedToLibrary: "보관함에 저장되었습니다!",
        alreadyInLibrary: "이미 보관함에 있습니다!",
        audioSaved: "발음 기록과 오디오가 성공적으로 저장되었습니다!"
    },
    en: {
        savedSuccess: "Saved successfully!",
        savedToLibrary: "Saved to Library!",
        alreadyInLibrary: "Already in Library!",
        audioSaved: "Pronunciation record and audio saved successfully!"
    },
    ja: {
        savedSuccess: "保存完了！",
        savedToLibrary: "ライブラリに保存されました！",
        alreadyInLibrary: "すでにライブラリにあります！",
        audioSaved: "発音記録と音声が正常に保存されました！"
    },
    'zh-CN': {
        savedSuccess: "保存成功！",
        savedToLibrary: "已保存到媒体库！",
        alreadyInLibrary: "已在媒体库中！",
        audioSaved: "发音记录和音频已成功保存！"
    },
    vi: {
        savedSuccess: "Đã lưu!",
        savedToLibrary: "Đã lưu vào Thư viện!",
        alreadyInLibrary: "Đã có trong Thư viện!",
        audioSaved: "Bản ghi phát âm và âm thanh đã được lưu thành công!"
    },
    fr: {
        savedSuccess: "Enregistré!",
        savedToLibrary: "Enregistré dans la bibliothèque !",
        alreadyInLibrary: "Déjà dans la bibliothèque !",
        audioSaved: "Enregistrement de prononciation et audio réussis !"
    },
    de: {
        savedSuccess: "Gespeichert!",
        savedToLibrary: "In der Bibliothek gespeichert!",
        alreadyInLibrary: "Bereits in der Bibliothek!",
        audioSaved: "Aussprachedatensatz und Audio erfolgreich gespeichert!"
    },
    es: {
        savedSuccess: "¡Guardado con éxito!",
        savedToLibrary: "¡Guardado en la biblioteca!",
        alreadyInLibrary: "¡Ya en la biblioteca!",
        audioSaved: "¡Registro de pronunciación y audio guardados con éxito!"
    }
};

export const getUiTranslation = (langCode, key) => {
    // If language is not found, fallback to English
    const translations = uiTranslations[langCode] || uiTranslations['en'];
    return translations[key] || uiTranslations['en'][key];
};
