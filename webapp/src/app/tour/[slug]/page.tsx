import Script from "next/script";

export default async function TourPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <>
      <link rel="stylesheet" href="/tour/styles.css" />
      <div id="app" data-tour-slug={slug}>
        <canvas
          id="pano"
          aria-label="Панорама 360°. Перетаскивайте, чтобы осмотреться"
        />
        <div id="nogl" />
        <div id="fade" />
        <div id="hotspots" />
        <div id="zenBrand">VTOUR&nbsp;360°</div>

        <header
          id="topbar"
          className="chrome"
          role="button"
          tabIndex={0}
          aria-expanded="false"
          aria-controls="infoCard"
        >
          <div className="tb-main">
            <span className="tb-badge">
              <span className="dot" />
              3D-ТУР&nbsp;·&nbsp;360°
            </span>
            <h1 id="tbTitle">&nbsp;</h1>
            <p className="addr" id="tbAddr" />
          </div>
          <div className="price" id="tbPrice" hidden>
            <b id="tbPriceMain" />
            <svg className="ic tb-chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>
        </header>

        <div id="fabs" className="chrome">
          <button className="fab" id="mapFab" aria-label="План квартиры" aria-pressed="false">
            <svg className="ic" viewBox="0 0 24 24">
              <path d="M14.1 5.6a2 2 0 0 0 1.8 0l3.7-1.8a1 1 0 0 1 1.4.9v12.7a1 1 0 0 1-.6.9l-4.5 2.3a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.7 1.8a1 1 0 0 1-1.4-.9V6.7a1 1 0 0 1 .6-.9l4.5-2.3a2 2 0 0 1 1.8 0z" />
              <path d="M15 5.8v15" />
              <path d="M9 3.2v15" />
            </svg>
          </button>
        </div>

        <div id="roomPanel" className="chrome collapsed">
          <button id="roomPanelTab" aria-expanded="false" aria-controls="roomPanelBody">
            <svg className="ic" viewBox="0 0 24 24">
              <path d="M3 9.5 12 3l9 6.5" />
              <path d="M5 9v11h14V9" />
              <path d="M9 20v-6h6v6" />
            </svg>
            <span>Комнаты</span>
          </button>
          <div id="roomPanelBody">
            <div className="rp-head">
              <b>ПЛОЩАДЬ ПО КОМНАТАМ</b>
              <button id="roomPanelClose" aria-label="Свернуть панель">
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M18 6 6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ul id="roomList" />
            <div className="rp-sum" id="roomSum" />
          </div>
        </div>

        <div id="mapCard" className="chrome hidden" role="dialog" aria-label="План квартиры — станции съёмки">
          <div className="map-head">
            <b>СТАНЦИИ СЪЁМКИ</b>
            <span id="mapCount" />
          </div>
          <svg id="plan" viewBox="0 0 224 160" aria-hidden="true">
            <rect className="planbg" x="4" y="4" width="216" height="152" rx="10" />
            <g id="grid" />
            <g id="stations-g" />
          </svg>
        </div>

        <div id="infoCardBackdrop" hidden />
        <section id="infoCard" hidden role="dialog" aria-label="Карточка объекта" aria-hidden="true">
          <div className="ic-head">
            <span className="sec-label">ОБЪЕКТ</span>
            <button id="infoCardClose" aria-label="Закрыть">
              <svg className="ic" viewBox="0 0 24 24">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="ic-body">
            <div className="ic-price">
              <b id="icPriceMain" />
              <span id="icPricePerSqm" />
            </div>
            <div className="chips" id="icSpecs" />
            <div id="icBuildingBlock" hidden>
              <p className="sec-label">ДОМ</p>
              <p className="desc" id="icBuildingText" />
            </div>
            <div id="icMapBlock" hidden>
              <p className="sec-label">РАЙОН</p>
              <div id="icMap" />
              <p className="ic-map-note">Точный адрес — у риелтора</p>
            </div>
            <div className="ag-actions">
              <a className="btn btn-call" id="icAgentCall">
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" />
                </svg>
                Позвонить
              </a>
              <a className="btn btn-msg" id="icAgentMsg" target="_blank" rel="noopener">
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
                </svg>
                Написать
              </a>
            </div>
          </div>
        </section>

        <section id="sheet">
          <button id="sheetHandle" aria-expanded="false" aria-controls="sheetBody">
            <span className="grip" />
            <span className="sh-row">
              <span className="chips" id="chips" />
              <span className="sh-more">
                Детали
                <svg className="ic" viewBox="0 0 24 24">
                  <path d="m18 15-6-6-6 6" />
                </svg>
              </span>
            </span>
          </button>
          <div className="sheet-body" id="sheetBody">
            <div id="descBlock" hidden>
              <p className="sec-label">ОПИСАНИЕ</p>
              <p className="desc" id="descText" />
            </div>
            <div id="specsBlock" hidden>
              <p className="sec-label">ХАРАКТЕРИСТИКИ</p>
              <div className="specs" id="specs" />
            </div>
            <div>
              <p className="sec-label">СТАНЦИИ</p>
              <div className="thumbs" id="thumbs" />
            </div>
            <div className="agent" id="agentBlock" hidden>
              <div className="ava" id="agentAva" aria-hidden="true" />
              <div className="ag-info">
                <b id="agentName" />
                <span id="agentMeta" />
              </div>
              <div className="ag-actions">
                <a className="btn btn-call" id="agentCall">
                  <svg className="ic" viewBox="0 0 24 24">
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z" />
                  </svg>
                  Позвонить
                </a>
                <a className="btn btn-msg" id="agentMsg" target="_blank" rel="noopener">
                  <svg className="ic" viewBox="0 0 24 24">
                    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
                  </svg>
                  Написать
                </a>
                <button className="btn btn-share" id="shareBtn" aria-label="Поделиться ссылкой на тур">
                  <svg className="ic" viewBox="0 0 24 24">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <path d="m16 6-4-4-4 4" />
                    <path d="M12 2v13" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="made">
              <span className="vmark">V</span>
              Сделано в <b>VTOUR</b> · создайте 3D-тур своей квартиры
            </div>
          </div>
        </section>

        <div id="toast" role="status" aria-live="polite" />

        <div id="loader">
          <div className="ld-bg" id="ldBg" />
          <div className="ld-card">
            <div className="ld-mark">V</div>
            <div className="ld-name">VTOUR</div>
            <p className="ld-sub" id="ldSub">Загрузка тура…</p>
            <p className="ld-addr" id="ldAddr" />
            <div className="ld-bar">
              <i id="ldFill" />
            </div>
            <div className="ld-pct" id="ldPct">0%</div>
          </div>
        </div>

        <div id="errBox" hidden>
          <div className="err-card">
            <p className="err-title">Не удалось загрузить тур</p>
            <p className="err-msg" id="errMsg" />
          </div>
        </div>

        <div id="taintBox" hidden>
          <div className="err-card">
            <p className="err-title">Браузер блокирует локальный файл для 3D-просмотра</p>
            <p className="err-msg">
              Chrome не даёт WebGL читать изображение, открытое напрямую с диска, даже из той же папки.
              Выберите тот же файл вручную — так браузер разрешит его использовать, и панорама откроется в полном 360°.
            </p>
            <button className="btn btn-call" id="taintPickBtn">Выбрать фото станции</button>
            <input type="file" id="filePicker" accept="image/*" hidden />
          </div>
        </div>
      </div>

      <Script src="/tour/app.js" strategy="afterInteractive" />
    </>
  );
}
