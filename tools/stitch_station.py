#!/usr/bin/env python3
"""Offline-проверка бандла VirtualTourCapture (Этап 0, §7 ТЗ).

Собирает equirectangular-панораму одной станции ЧИСТО по позам ARKit —
без feature matching. Каждый пиксель панорамы берётся из кадра, чья
оптическая ось ближе всего к направлению пикселя.

Использование:
    pip install numpy opencv-python pillow pillow-heif
    python stitch_station.py path/to/tour_<uuid>/stations/station_01 \
        -o pano.jpg --width 4096

Если панорама сходится по швам — позы и интринсики в бандле корректны.
"""

import argparse
import json
import os
import sys

import numpy as np

try:
    import cv2
except ImportError:
    sys.exit("Нужен OpenCV: pip install opencv-python")

try:
    from PIL import Image
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:
    sys.exit("Нужны Pillow и pillow-heif: pip install pillow pillow-heif")


def load_frames(station_dir):
    with open(os.path.join(station_dir, "station.json"), encoding="utf-8") as f:
        station = json.load(f)
    frames = []
    for meta in station["frames"]:
        path = os.path.join(station_dir, "frames", meta["filename"])
        if not os.path.exists(path):
            print(f"  ! пропущен {meta['filename']} (файла нет)")
            continue
        # column-major → reshape с order='F'
        T = np.array(meta["transform"], dtype=np.float64).reshape(4, 4, order="F")
        K = np.array(meta["intrinsics"], dtype=np.float64).reshape(3, 3, order="F")
        w_meta, h_meta = meta["imageResolution"]
        img = np.array(Image.open(path).convert("RGB"))
        h_img, w_img = img.shape[:2]
        # интринсики соответствуют imageResolution кадра; подстрахуемся
        if abs(w_img - w_meta) > 1:
            s = w_img / w_meta
            K = K.copy()
            K[0, 0] *= s
            K[1, 1] *= s
            K[0, 2] *= s
            K[1, 2] *= s
        frames.append({"R": T[:3, :3], "K": K, "img": img, "name": meta["filename"]})
    return station, frames


def stitch(frames, width):
    height = width // 2
    # Направления пикселей панорамы в world-координатах ARKit (+Y вверх).
    xs = (np.arange(width) + 0.5) / width * 2 * np.pi - np.pi   # lon
    ys = np.pi / 2 - (np.arange(height) + 0.5) / height * np.pi  # lat
    lon, lat = np.meshgrid(xs, ys)
    d_world = np.stack(
        [np.cos(lat) * np.sin(lon), np.sin(lat), np.cos(lat) * np.cos(lon)], axis=-1
    )  # H x W x 3

    pano = np.zeros((height, width, 3), dtype=np.uint8)
    best_score = np.full((height, width), -1.0, dtype=np.float32)

    for i, fr in enumerate(frames):
        R, K, img = fr["R"], fr["K"], fr["img"]
        h_img, w_img = img.shape[:2]

        # world → camera (R — camera-to-world, ортонормальная)
        d_cam = d_world @ R  # эквивалент R.T @ d по каждому пикселю
        # ARKit-камера смотрит вдоль -Z; ось Y камеры — вверх, в пикселях v растёт вниз
        z = -d_cam[..., 2]
        valid = z > 1e-6
        with np.errstate(divide="ignore", invalid="ignore"):
            u = K[0, 0] * (d_cam[..., 0] / z) + K[0, 2]
            v = K[1, 1] * (-d_cam[..., 1] / z) + K[1, 2]
        inside = valid & (u >= 0) & (u < w_img - 1) & (v >= 0) & (v < h_img - 1)

        score = np.where(inside, z, -1).astype(np.float32)
        better = score > best_score
        if not better.any():
            continue

        sampled = cv2.remap(
            img,
            u.astype(np.float32),
            v.astype(np.float32),
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
        )
        pano[better] = sampled[better]
        best_score[better] = score[better]
        print(f"  [{i + 1}/{len(frames)}] {fr['name']}: покрыто {better.sum()} px")

    uncovered = (best_score < 0).mean()
    print(f"Не покрыто панорамы: {uncovered * 100:.1f}% (зенит/надир — ожидаемо)")
    return pano


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("station_dir", help="каталог stations/station_NN из бандла")
    parser.add_argument("-o", "--output", default="pano.jpg")
    parser.add_argument("--width", type=int, default=4096,
                        help="ширина equirectangular-панорамы (высота = ширина/2)")
    args = parser.parse_args()

    station, frames = load_frames(args.station_dir)
    if not frames:
        sys.exit("Нет кадров")
    print(f"Станция {station['index']} «{station.get('roomLabel', '')}»: "
          f"{len(frames)} кадров, покрытие {station.get('coveragePercent', 0) * 100:.0f}%")

    pano = stitch(frames, args.width)
    Image.fromarray(pano).save(args.output, quality=92)
    print(f"Сохранено: {args.output}")


if __name__ == "__main__":
    main()
