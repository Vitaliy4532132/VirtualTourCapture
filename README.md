# VirtualTourCapture — Этап 0 (Capture Prototype)

iOS-приложение захвата данных для виртуальных 3D-туров: ARKit + RoomPlan,
кадры с точными позами камеры, экспорт в стандартизированный бандл.

В Debug-сборке включён облегчённый тестовый профиль: 36 направлений вместо 168,
обычные видеокадры и более мягкие пороги. Release-сборка возвращает полный
high-res захват.

При серьёзном нагреве автозахват автоматически приостанавливается и продолжится
после охлаждения телефона.
Прототип для внутреннего использования, не App Store. Полное ТЗ — см. документ
«ТЗ: iOS-приложение захвата для виртуальных туров (Этап 0)».

## Требования

- Xcode 15+ (проект создан в Xcode 26), iOS 17.0+
- Только реальный iPhone Pro / Pro Max с LiDAR (симулятор не поддерживается)
- Подпись: Personal Team (free provisioning, живёт 7 дней)
- Внешних зависимостей нет — только системные фреймворки

## Сборка

1. Открыть `VirtualTourCapture.xcodeproj`
2. В Signing & Capabilities выбрать свою Personal Team
3. Запустить на устройстве

## Структура

- `Domain/` — Project / Station / CapturedFrame (модель бандла)
- `Capture/` — ARSession + RoomPlan, лок камеры, автозахват, покрытие сферы, качество
- `Storage/` — проекты на диске, асинхронная запись HEIC, сборка и zip бандла
- `UI/` — список проектов, экран съёмки (ARView + HUD + оверлей покрытия), экспорт
- `Utils/` — SIMD-хелперы, Metal-шейдер резкости (Laplacian variance), логгер
- `tools/stitch_station.py` — офлайн-проверка бандла: сшивка одной станции
  в equirectangular-панораму чисто по позам (момент истины этапа 0)

## Проверка бандла

```bash
pip install numpy opencv-python pillow pillow-heif
unzip tour_<uuid>.zip
python tools/stitch_station.py tour_<uuid>/stations/station_01 -o pano.jpg
```

Формат бандла (`manifest.json`, `room/`, `stations/`) — контракт с будущим
сервером; соглашения по координатам описаны в `README.txt` внутри бандла.
